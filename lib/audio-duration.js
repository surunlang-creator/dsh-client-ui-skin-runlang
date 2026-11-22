// Audio duration probing for the music library.
//
// Chromium's <audio> reports a wrong (short) or unknown duration for OGG/Vorbis
// while only the first range of the file is buffered, which is exactly the state a
// restored player is in after a restart (preload="metadata"). Parsing the container
// here gives the library an authoritative length up front, so the time label and the
// progress bar are right before the user presses play.
//
// Only the container headers are read: a small head for the codec/rate and, for Ogg,
// the seekable tail for the last granule position. Unsupported/unreadable files
// return 0 and the client falls back to the element's own duration.

import { closeSync, openSync, readSync, statSync } from 'node:fs'

const HEAD_BYTES = 256 * 1024
const TAIL_BYTES = 96 * 1024
/** in-memory cache keyed by path+mtime+size (one library listing looks the same). */
const cache = new Map()

function readRange(path, start, length) {
  let fd = null
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(length)
    const read = readSync(fd, buffer, 0, length, start)
    return buffer.subarray(0, read)
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
  }
}

function readHead(path, size) {
  return readRange(path, 0, Math.min(HEAD_BYTES, size))
}

function readTail(path, size, length = TAIL_BYTES) {
  const take = Math.min(length, size)
  return readRange(path, size - take, take)
}

/** bytes 0..1 big-endian */
const be16 = (b, o) => (b[o] << 8) | b[o + 1]
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
const le32 = (b, o) => b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + ((b[o + 3] << 24) >>> 0)

/** Ogg: last page granule / sample rate. Handles Vorbis and Opus (48 kHz granules). */
function oggDuration(path, size) {
  const head = readHead(path, size)
  if (head === null || head.subarray(0, 4).toString('latin1') !== 'OggS') return 0
  // first page body starts after the 27-byte header + segment table
  const segments = head[26]
  const body = 27 + segments
  let rate = 0
  if (head.subarray(body, body + 8).toString('latin1') === 'OpusHead') rate = 48000
  else if (head.subarray(body + 1, body + 7).toString('latin1') === 'vorbis') rate = le32(head, body + 12)
  if (!Number.isFinite(rate) || rate <= 0) return 0
  const tail = readTail(path, size, Math.min(TAIL_BYTES, size))
  if (tail === null) return 0
  for (let i = tail.length - 27; i >= 0; i -= 1) {
    if (tail[i] !== 0x4f || tail[i + 1] !== 0x67 || tail[i + 2] !== 0x67 || tail[i + 3] !== 0x53) continue
    const granule = Number(tail.readBigInt64LE(i + 6))
    if (Number.isFinite(granule) && granule > 0) return granule / rate
  }
  return 0
}

/** FLAC: STREAMINFO carries sample rate and total samples. */
function flacDuration(path, size) {
  const head = readHead(path, size)
  if (head === null || head.subarray(0, 4).toString('latin1') !== 'fLaC') return 0
  let offset = 4
  while (offset + 4 <= head.length) {
    const type = head[offset] & 0x7f
    const length = (head[offset + 1] << 16) | (head[offset + 2] << 8) | head[offset + 3]
    offset += 4
    if (type === 0 && offset + 34 <= head.length) {
      const rate = (head[offset + 10] << 12) | (head[offset + 11] << 4) | (head[offset + 12] >> 4)
      const total = (head[offset + 13] & 0x0f) * 2 ** 32 + be32(head, offset + 14)
      return rate > 0 && total > 0 ? total / rate : 0
    }
    offset += length
    if ((head[offset - length - 4] & 0x80) !== 0) break
  }
  return 0
}

/** WAV: data chunk size / byte rate. */
function wavDuration(path, size) {
  const head = readHead(path, size)
  if (head === null || head.length < 44) return 0
  if (head.subarray(0, 4).toString('latin1') !== 'RIFF' || head.subarray(8, 12).toString('latin1') !== 'WAVE') return 0
  let offset = 12
  let byteRate = 0
  while (offset + 8 <= head.length) {
    const id = head.subarray(offset, offset + 4).toString('latin1')
    const length = le32(head, offset + 4)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= head.length) byteRate = le32(head, body + 8)
    if (id === 'data') return byteRate > 0 ? length / byteRate : 0
    offset = body + length + (length % 2)
  }
  return 0
}

/** MP3: Xing/Info frame count, else a CBR estimate from the first frame bitrate. */
function mp3Duration(path, size) {
  const head = readHead(path, size)
  if (head === null) return 0
  let offset = 0
  if (head.subarray(0, 3).toString('latin1') === 'ID3') {
    offset = 10 + ((head[6] & 0x7f) << 21) + ((head[7] & 0x7f) << 14) + ((head[8] & 0x7f) << 7) + (head[9] & 0x7f)
  }
  while (offset + 4 < head.length) {
    if (head[offset] !== 0xff || (head[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1
      continue
    }
    const versionBits = (head[offset + 1] >> 3) & 0x03
    const layerBits = (head[offset + 1] >> 1) & 0x03
    const bitrateIndex = (head[offset + 2] >> 4) & 0x0f
    const rateIndex = (head[offset + 2] >> 2) & 0x03
    const padding = (head[offset + 2] >> 1) & 0x01
    const mpeg1 = versionBits === 0x03
    const bitrates = mpeg1
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
    const rates = mpeg1 ? [44100, 48000, 32000] : [22050, 24000, 16000]
    const bitrate = bitrates[bitrateIndex] * 1000
    const rate = rates[rateIndex]
    if (!bitrate || !rate) {
      offset += 1
      continue
    }
    const samplesPerFrame = layerBits === 0x03 ? 384 : layerBits === 0x02 ? 1152 : 1152
    const xing = head.subarray(offset + 4 + 32, offset + 4 + 32 + 4).toString('latin1')
    const info = head.subarray(offset + 4 + 36, offset + 4 + 36 + 4).toString('latin1')
    if (xing === 'Xing' || xing === 'Info' || info === 'Xing' || info === 'Info') {
      const base = (xing === 'Xing' || xing === 'Info' ? 8 : 12) + offset
      const frames = be32(head, base + 4)
      if (frames > 0) return (frames * samplesPerFrame) / rate
    }
    const frameLength = Math.floor(((samplesPerFrame / 8) * bitrate) / rate) + padding
    if (frameLength > 0) return ((size - offset) * 8) / bitrate
    return 0
  }
  return 0
}

/** M4A/MP4: mvhd timescale and duration (moov may sit at either end). */
function m4aDuration(path, size) {
  const scan = (buffer) => {
    if (buffer === null) return 0
    for (let i = 0; i + 8 <= buffer.length; i += 1) {
      if (buffer[i] !== 0x6d || buffer[i + 1] !== 0x76 || buffer[i + 2] !== 0x68 || buffer[i + 3] !== 0x64) continue
      const version = buffer[i + 4]
      const base = i + 4
      if (version === 0 && base + 20 <= buffer.length) {
        const timescale = be32(buffer, base + 12)
        const duration = be32(buffer, base + 16)
        if (timescale > 0 && duration > 0) return duration / timescale
      }
      if (version === 1 && base + 32 <= buffer.length) {
        const timescale = be32(buffer, base + 20)
        const high = be32(buffer, base + 24)
        const low = be32(buffer, base + 28)
        const duration = high * 2 ** 32 + low
        if (timescale > 0 && duration > 0) return duration / timescale
      }
    }
    return 0
  }
  return scan(readHead(path, size)) || scan(readTail(path, size, Math.min(512 * 1024, size)))
}

/**
 * Duration in seconds for one library file, or 0 when the container is unknown or
 * unreadable. Cached per (path, mtime, size) so a listing does not reparse.
 */
export function probeAudioDuration(path, name = '') {
  let info = null
  try {
    info = statSync(path)
    if (info.isFile() === false) return 0
  } catch {
    return 0
  }
  const key = path + '|' + info.mtimeMs + '|' + info.size
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const ext = String(name || path).slice(String(name || path).lastIndexOf('.')).toLowerCase()
  let duration = 0
  try {
    if (ext === '.ogg' || ext === '.oga' || ext === '.opus') duration = oggDuration(path, info.size)
    else if (ext === '.flac') duration = flacDuration(path, info.size)
    else if (ext === '.wav') duration = wavDuration(path, info.size)
    else if (ext === '.mp3') duration = mp3Duration(path, info.size)
    else if (ext === '.m4a' || ext === '.mp4') duration = m4aDuration(path, info.size)
  } catch {
    duration = 0
  }
  if (!Number.isFinite(duration) || duration < 0) duration = 0
  duration = Math.round(duration * 1000) / 1000
  if (cache.size > 2048) cache.clear()
  cache.set(key, duration)
  return duration
}

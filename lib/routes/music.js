// Host routes: the music library and the audio streaming prefix.
//
// The player is the only consumer. It needs three things the wallpaper routes cannot
// provide: a list of audio files (the wallpaper catalog filters them out on purpose),
// audio MIME types (`media-types.js` owns those), and a URL that Range-requests like a
// `<video>` so seeking does not re-download the file.
//
// Sources, in display order:
//   1. `uploads/`  — audio the user added through the panel (persistent profile data),
//   2. `music/`    — audio found at the top level of each configured music directory
//                    (default `~/Music`; the folders are stored in `music-roots.json`).
//
// The listing is a catalog, not a filesystem browser: only audio extensions inside a
// configured root are reported, names may not contain a separator, and the streaming
// prefix re-checks containment with `realpath` on every GET (a symlink cannot escape).

import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { ROUTE, SAFE_NAME, fileSize, audioKindFromName } from '../media-types.js'
import { MUSIC_ROOTS_FILE, UPLOAD_DIR } from '../host-paths.js'
import { sendJson, sendText, servePath } from '../http-media.js'
import { uploadStatus } from '../upload.js'
import { probeAudioDuration } from '../audio-duration.js'

/** A library, not a disk scan: both caps only ever shrink the answer. */
const MAX_ROOTS = 12
const MAX_TRACKS = 400

function isAudioName(name) {
  return audioKindFromName(name) === 'audio'
}

/** One path segment the music prefix will accept: no separators, no traversal. */
function isPlainName(name) {
  return (
    typeof name === 'string' &&
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    name[0] !== '.' &&
    name.includes('/') === false &&
    name.includes('\\') === false &&
    name.includes('\0') === false &&
    isAudioName(name)
  )
}

/** `"Artist - Title.mp3"` -> `{ artist, title }`; anything else -> the bare stem. */
function splitTrackName(name) {
  const stem = String(name ?? '').replace(/\.[A-Za-z0-9]{1,8}$/, '')
  const dash = stem.indexOf(' - ')
  if (dash > 0) {
    return { artist: stem.slice(0, dash).trim().slice(0, 120), title: stem.slice(dash + 3).trim().slice(0, 160) }
  }
  return { artist: '', title: stem.slice(0, 160) }
}

function statBytes(path) {
  try {
    const info = statSync(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

/**
 * `null` means "never configured" (no file / unreadable), which arms the `~/Music`
 * default. An explicitly saved empty array stays empty: removing the last folder in
 * the panel must not silently bring the default back.
 */
function readSavedRoots() {
  try {
    const value = JSON.parse(readFileSync(MUSIC_ROOTS_FILE, 'utf8'))
    if (!Array.isArray(value)) return null
    return value
      .filter((entry) => typeof entry === 'string' && entry.trim() !== '' && isAbsolute(entry.trim()))
      .map((entry) => resolve(entry.trim()))
      .slice(0, MAX_ROOTS)
  } catch {
    return null
  }
}

/** The default music directory, when it exists; '' otherwise. */
function defaultRoot() {
  const candidate = join(homedir(), 'Music')
  try {
    return statSync(candidate).isDirectory() ? candidate : ''
  } catch {
    return ''
  }
}

/**
 * The effective roots. An explicitly saved list wins even when it is shorter than the
 * default: removing `~/Music` from the panel must not silently bring it back.
 */
export function musicRoots() {
  const saved = readSavedRoots()
  if (saved !== null) return saved
  const fallback = defaultRoot()
  return fallback === '' ? [] : [fallback]
}

/** Audio the user added through the panel. Wallpaper uploads are filtered by kind. */
function listUploadedAudio() {
  let names = []
  try {
    names = readdirSync(UPLOAD_DIR)
  } catch {
    return []
  }
  const items = []
  for (const name of names) {
    if (SAFE_NAME.test(name) === false || name.includes('.part-') || isAudioName(name) === false) continue
    items.push({
      id: 'upload:' + name,
      name,
      url: ROUTE + '/uploads/' + name,
      bytes: fileSize(join(UPLOAD_DIR, name)),
      // Container duration up front: the player shows the right total before playback
      // (Chromium reports a short duration for a partially buffered Ogg/Vorbis file).
      duration: probeAudioDuration(join(UPLOAD_DIR, name), name),
      source: 'upload',
      ...splitTrackName(name),
    })
  }
  items.sort((a, b) => a.name.localeCompare(b.name))
  return items
}

/**
 * Top level only. Recursing into album folders would need a relative-path URL
 * segment; the panel instead tells the user to add the album folder as a root, which
 * keeps every track URL a single safe name.
 */
function collectRootTracks(root, rootIndex, out) {
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_TRACKS) return
    if (entry.isFile() === false || entry.name.startsWith('.') || isAudioName(entry.name) === false) continue
    const full = join(root, entry.name)
    const bytes = statBytes(full)
    if (bytes <= 0) continue
    out.push({
      id: 'root:' + rootIndex + ':' + entry.name,
      name: entry.name,
      url: ROUTE + '/music/' + rootIndex + '/' + encodeURIComponent(entry.name),
      bytes,
      duration: probeAudioDuration(full, entry.name),
      source: 'root',
      ...splitTrackName(entry.name),
    })
  }
}

function musicCatalog() {
  const roots = musicRoots()
  const uploaded = listUploadedAudio()
  const external = []
  roots.forEach((root, index) => collectRootTracks(root, index, external))
  external.sort((a, b) => a.name.localeCompare(b.name))
  const items = [...uploaded, ...external].slice(0, MAX_TRACKS)
  return { items, roots, defaultRoot: defaultRoot(), truncated: uploaded.length + external.length > MAX_TRACKS }
}

/**
 * Stores the music directories. Same contract as `_we-roots`: absolute paths that
 * currently resolve to a directory, capped, JSON only. An empty array is a valid
 * write (it means "fall back to ~/Music").
 */
function writeRoots(req, res) {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  if (contentType.includes('application/json') === false) {
    sendText(res, 415, 'expected application/json')
    req.resume()
    return
  }
  const chunks = []
  let size = 0
  let oversized = false
  req.on('data', (chunk) => {
    if (oversized) return
    size += chunk.length
    if (size > 8192) {
      oversized = true
      sendText(res, 413, 'roots payload too large')
      req.resume()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (oversized) return
    let roots
    let skipped = 0
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!Array.isArray(value)) throw new Error('expected an array')
      const accepted = []
      for (const entry of value) {
        if (typeof entry !== 'string' || entry.trim() === '') continue
        const candidate = entry.trim()
        if (isAbsolute(candidate) === false) {
          skipped += 1
          continue
        }
        try {
          if (statSync(candidate).isDirectory()) accepted.push(resolve(candidate))
          else skipped += 1
        } catch {
          skipped += 1
        }
      }
      roots = [...new Set(accepted)].slice(0, MAX_ROOTS)
      writeFileSync(MUSIC_ROOTS_FILE, JSON.stringify(roots, null, 2), 'utf8')
    } catch {
      sendText(res, 400, 'invalid roots payload')
      return
    }
    sendJson(res, 200, { roots, skipped })
  })
  req.on('error', () => {
    try {
      res.destroy()
    } catch {
      // ignore
    }
  })
}

/** Resolve one root file for streaming, or null when anything about it is wrong. */
function resolveTrack(root, name) {
  if (isPlainName(name) === false) return null
  let realRoot = ''
  let realFile = ''
  try {
    realRoot = realpathSync(root)
    realFile = realpathSync(resolve(realRoot, name))
  } catch {
    return null
  }
  if (realFile !== realRoot && realFile.startsWith(realRoot + sep) === false) return null
  try {
    if (statSync(realFile).isFile() === false) return null
  } catch {
    return null
  }
  return realFile
}

export const exact = {
  '_music-roots': (ctx, req, res) => {
    if (req.method === 'POST') writeRoots(req, res)
    else sendJson(res, 200, { roots: musicRoots(), defaultRoot: defaultRoot() })
  },
  _music: (ctx, req, res) => {
    sendJson(res, 200, { ...musicCatalog(), upload: uploadStatus(), maxTracks: MAX_TRACKS })
  },
}

export const prefix = [
  [
    'music/',
    (ctx, req, res, rest) => {
      // The URL keeps `music/<rootIndex>/<encodedFileName>`.
      let parts
      try {
        parts = rest.split('/').map((part) => decodeURIComponent(part))
      } catch {
        sendText(res, 404, 'not found')
        return
      }
      const index = Number(parts[1])
      const roots = musicRoots()
      if (
        parts.length !== 3 ||
        Number.isInteger(index) === false ||
        index < 0 ||
        index >= roots.length ||
        isAudioName(parts[2]) === false
      ) {
        sendText(res, 404, 'not found')
        return
      }
      const filePath = resolveTrack(roots[index], parts[2])
      if (filePath === null) {
        sendText(res, 404, 'not found')
        return
      }
      servePath(req, res, filePath, parts[2])
    },
  ],
]

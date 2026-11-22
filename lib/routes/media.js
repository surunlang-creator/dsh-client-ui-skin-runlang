// Host routes: the `assets/` manifest, upload intake (POST `_upload`), the
// `uploads/` media prefix and the final asset fallback.
//
// Extracted from lib/index.js in v2.1.8. The fallback is exported separately because
// it is the last resort of the dispatch table, not a prefix route.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ASSET_DIR, SAFE_NAME } from '../media-types.js'
import { sendJson, sendText, servePath } from '../http-media.js'
import { receiveUpload, uploadPath } from '../upload.js'
import { listAssets } from './wallpaper.js'

export const exact = {
  _manifest: (ctx, req, res) => {
    sendJson(res, 200, { assets: listAssets() })
  },
  // Upload is the one write endpoint that is not JSON. It runs before the generic
  // GET/HEAD gate and owns its own body limits and response framing.
  _upload: (ctx, req, res, url) => {
    if (req.method !== 'POST') {
      sendText(res, 405, 'method not allowed')
      return
    }
    receiveUpload(req, res, url.searchParams.get('name'), sendJson)
  },
}

export const prefix = [
  [
    'uploads/',
    (ctx, req, res, rest) => {
      // User uploads: uploads/<fileName>, served through the same Range pipeline.
      const parts = rest.split('/')
      if (parts.length !== 2) {
        sendText(res, 404, 'not found')
        return
      }
      const filePath = uploadPath(parts[1])
      if (filePath === null) {
        sendText(res, 404, 'not found')
        return
      }
      servePath(req, res, filePath, parts[1])
    },
  ],
]

/** Package-local assets: identical serving, path rooted at assets/. */
export function fallback(req, res, rest) {
  if (rest === '' || rest.includes('/') || SAFE_NAME.test(rest) === false) {
    sendText(res, 404, 'not found')
    return
  }
  let filePath = join(ASSET_DIR, rest)
  // v1.4.0 renamed the bundled loop (qinglan-loop.mp4 -> runlang-loop.mp4). A wallpaper
  // choice saved by 1.3.x still names the old file, so serve the renamed one instead of
  // breaking the user's wallpaper after the upgrade.
  if (existsSync(filePath) === false && rest === 'qinglan-loop.mp4') {
    const renamed = join(ASSET_DIR, 'runlang-loop.mp4')
    if (existsSync(renamed)) filePath = renamed
  }
  servePath(req, res, filePath, rest)
}

// Filesystem locations owned by the host half.
//
// Package media (`assets/`) ships with the code. User data must NOT live under the
// plugin directory: DSH removes that directory on uninstall/upgrade of a tarball
// install, so settings and uploaded wallpapers would disappear. From v2.0.1 the host
// half keeps its data in a DSH-managed, persistent location:
//
//   <profile dir>/runlang/          profileContext.dir from the DSH host
//     state/                          settings.json, frame cache, WE state + caches, import staging
//     uploads/                        wallpapers uploaded through the panel
//     derived/                        optional ffmpeg transcodes
//     we-roots.json                   extra wallpaper directories (WE projects etc.)
//     migration.json                  one-time legacy-copy record (v2.0.1)
//     migration-from-qinglan.json     one-time copy from the pre-rename data root (v1.4.0)
//
// Evidence (DSH 0.2.0 / 0.2.1 / 0.2.2): the host provides `profileContext` on the
// plugin context (`hostCtx.provide("profileContext", …)` in dsh's profile-boot) with a
// `dir` field, and official packages keep persistent plugin data under that directory
// (e.g. dsh-creation-recommendations' `<profile>/created-plugins`, dsh-plugin-manager's
// `<profile>/.plugin-manager`). The profile directory survives plugin uninstall and
// upgrade, which is exactly the guarantee we need.
//
// Legacy (<= v2.0.0) locations inside the plugin directory are still read once for a
// COPY migration: the copy never deletes the old files, so a downgrade keeps working.
// Until `configureHostPaths()` is called every binding points at the legacy location,
// which keeps the test harnesses (no DSH host) byte-for-byte compatible.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { ASSET_DIR } from './media-types.js'

/** Plugin root (`lib/` is one level below it); internal only. */
const PLUGIN_ROOT = resolve(ASSET_DIR, '..')
/** Legacy (<= v2.0.0) data locations inside the plugin directory; read-only after migration. */
export const LEGACY_STATE_DIR = join(PLUGIN_ROOT, 'state')
export const LEGACY_UPLOAD_DIR = join(ASSET_DIR, 'uploads')
export const LEGACY_DERIVED_DIR = join(ASSET_DIR, 'derived')
export const LEGACY_WE_ROOTS_FILE = join(PLUGIN_ROOT, 'we-roots.json')
/** Legacy location for the music roots (v1.1.0 added the feature; no older copy exists). */
export const LEGACY_MUSIC_ROOTS_FILE = join(PLUGIN_ROOT, 'music-roots.json')

/**
 * v1.4.0: the persistent data directory was renamed from `qinglan` to `runlang` with
 * the plugin identity. The old root is copied once (never moved) so a downgrade to
 * 1.3.x keeps working; `migration-from-qinglan.json` records what was copied.
 */
export const DATA_DIR_NAME = 'runlang'
export const PREVIOUS_DATA_DIR_NAME = 'qinglan'

/** Persistent data root resolved from DSH's profileContext; null while legacy mode. */
export let DATA_ROOT = null
/** Symbolic, machine-path-free label for diagnostics. */
export let DATA_ROOT_DISPLAY = 'legacy:plugin-directory'

// Live bindings on purpose: importing modules read these at call time, so one
// configureHostPaths() call in apply() moves every route/module to the new root.
export let STATE_DIR = LEGACY_STATE_DIR
export let SETTINGS_FILE = join(STATE_DIR, 'settings.json')
export let FRAME_CACHE_DIR = join(STATE_DIR, 'frame-cache')
export let UPLOAD_DIR = LEGACY_UPLOAD_DIR
export let DERIVED_DIR = LEGACY_DERIVED_DIR
export let WE_ROOTS_FILE = LEGACY_WE_ROOTS_FILE
/** v1.1.0 music player: the extra music directories, next to the WE roots file. */
export let MUSIC_ROOTS_FILE = LEGACY_MUSIC_ROOTS_FILE

/** Migration record filename inside the persistent root. */
export const MIGRATION_RECORD_FILE = 'migration.json'

/** Pure: the persistent data root for one DSH profile directory. */
export function dataRootForProfile(profileDir) {
  if (typeof profileDir !== 'string' || profileDir.trim() === '') return null
  return join(resolve(profileDir), DATA_DIR_NAME)
}

/**
 * Point every exported path at `<profileDir>/qinglan`. The profile directory comes
 * from DSH's `profileContext` service (see the header evidence); callers must pass it.
 * @param profileDir - absolute directory of the running DSH profile.
 * @returns the resolved persistent root, or null for an invalid input (bindings stay legacy).
 */
export function configureHostPaths(profileDir) {
  const root = dataRootForProfile(profileDir)
  if (root === null) return null
  DATA_ROOT = root
  DATA_ROOT_DISPLAY = '$DSH_HOME/profiles/' + basename(resolve(profileDir)) + '/' + DATA_DIR_NAME
  STATE_DIR = join(root, 'state')
  SETTINGS_FILE = join(STATE_DIR, 'settings.json')
  FRAME_CACHE_DIR = join(STATE_DIR, 'frame-cache')
  UPLOAD_DIR = join(root, 'uploads')
  DERIVED_DIR = join(root, 'derived')
  WE_ROOTS_FILE = join(root, 'we-roots.json')
  MUSIC_ROOTS_FILE = join(root, 'music-roots.json')
  return root
}

/** Recursively count files + bytes (diagnostic only; never throws). */
function treeStats(path) {
  const stats = { files: 0, bytes: 0 }
  const visit = (current) => {
    let entries = []
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      try {
        if (entry.isDirectory()) visit(full)
        else if (entry.isFile()) {
          stats.files += 1
          stats.bytes += statSync(full).size
        }
      } catch {
        // a file that vanished mid-walk is not a migration failure
      }
    }
  }
  visit(path)
  return stats
}

/**
 * Copy the pre-rename `<profile>/qinglan` root into `<profile>/runlang` once.
 *
 * Same contract as the legacy copy: copy, never move or delete, so rolling back to
 * 1.3.x still finds its data; an existing destination is merged (force:false), never
 * overwritten. Returns `{ previous, actions }` or null when there is nothing to do.
 */
export function migratePreviousDataRoot(options = {}) {
  const root = typeof options.root === 'string' ? options.root : DATA_ROOT
  if (typeof root !== 'string' || root === '') return null
  const previous =
    typeof options.previous === 'string' ? options.previous : join(dirname(root), PREVIOUS_DATA_DIR_NAME)
  if (previous === root || existsSync(previous) === false) return null
  // Copy once: the record is the marker, so later starts do not re-copy/re-report.
  const recordPath = join(root, 'migration-from-' + PREVIOUS_DATA_DIR_NAME + '.json')
  if (existsSync(recordPath)) return null
  const actions = []
  try {
    mkdirSync(root, { recursive: true })
  } catch {
    return null
  }
  for (const item of ['state', 'uploads', 'derived']) {
    const from = join(previous, item)
    if (existsSync(from) === false) continue
    try {
      cpSync(from, join(root, item), { recursive: true, force: false, errorOnExist: false })
      const stats = treeStats(join(root, item))
      actions.push({ item, files: stats.files, bytes: stats.bytes })
    } catch {
      // a read-only/odd source must not break startup; the next start retries
    }
  }
  for (const file of ['we-roots.json', 'music-roots.json']) {
    const from = join(previous, file)
    const to = join(root, file)
    if (existsSync(from) === false || existsSync(to)) continue
    try {
      cpSync(from, to, { force: false, errorOnExist: false })
      actions.push({ item: file, files: 1, bytes: statSync(to).size })
    } catch {
      // ignore
    }
  }
  if (actions.length === 0) return null
  const record = {
    schema: 1,
    migratedAt: new Date().toISOString(),
    from: PREVIOUS_DATA_DIR_NAME,
    root: options.display ?? DATA_ROOT_DISPLAY,
    note: 'One-time copy from the pre-rename data root; the old files were kept untouched.',
    actions,
  }
  try {
    writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', 'utf8')
  } catch {
    // the copy already happened; a missing record is not fatal
  }
  return { previous, actions }
}

/**
 * Copy the legacy (<= v2.0.0) user data into the persistent root ONCE.
 *
 * Rules (the acceptance contract):
 *   - copy only when the legacy source exists AND the new destination does not;
 *   - never delete, rename or modify the legacy files (a downgrade must keep working);
 *   - write `migration.json` with what was copied, so the copy is auditable;
 *   - a second run is a no-op (destinations now exist).
 *
 * @param options.root - persistent root (defaults to DATA_ROOT).
 * @param options.legacy / options.target - injectable path maps for tests.
 * @returns {{root: string, actions: Array<object>} | null} null when no root is known.
 */
export function migrateLegacyHostData(options = {}) {
  const root = typeof options.root === 'string' ? options.root : DATA_ROOT
  if (root === null || typeof root !== 'string' || root === '') return null
  const legacy =
    options.legacy !== null && typeof options.legacy === 'object'
      ? options.legacy
      : { state: LEGACY_STATE_DIR, uploads: LEGACY_UPLOAD_DIR, derived: LEGACY_DERIVED_DIR, rootsFile: LEGACY_WE_ROOTS_FILE }
  const target =
    options.target !== null && typeof options.target === 'object'
      ? options.target
      : { state: STATE_DIR, uploads: UPLOAD_DIR, derived: DERIVED_DIR, rootsFile: WE_ROOTS_FILE }
  const actions = []
  try {
    mkdirSync(root, { recursive: true })
  } catch {
    return null
  }
  for (const item of ['state', 'uploads', 'derived']) {
    const from = legacy[item]
    const to = target[item]
    if (typeof from !== 'string' || typeof to !== 'string') continue
    if (existsSync(from) === false || existsSync(to)) continue
    try {
      cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
      const stats = treeStats(to)
      actions.push({ item, files: stats.files, bytes: stats.bytes })
    } catch {
      // a read-only/odd source must not break startup; it simply is not copied
    }
  }
  if (typeof legacy.rootsFile === 'string' && typeof target.rootsFile === 'string') {
    if (existsSync(legacy.rootsFile) && existsSync(target.rootsFile) === false) {
      try {
        cpSync(legacy.rootsFile, target.rootsFile, { force: false, errorOnExist: false })
        actions.push({ item: 'we-roots.json', files: 1, bytes: statSync(target.rootsFile).size })
      } catch {
        // ignore
      }
    }
  }
  if (actions.length > 0) {
    const record = {
      schema: 1,
      migratedAt: new Date().toISOString(),
      root: options.display ?? DATA_ROOT_DISPLAY,
      note: 'One-time copy from the v2.0.0 plugin-directory data locations; the old files were kept untouched.',
      actions,
    }
    try {
      writeFileSync(join(root, MIGRATION_RECORD_FILE), JSON.stringify(record, null, 2) + '\n', 'utf8')
    } catch {
      // an unwritable root is reported by the caller's diagnostics, not fatal here
    }
  }
  return { root, actions }
}

/** True when a legacy data location still holds anything worth migrating. */
export function hasLegacyData() {
  for (const path of [LEGACY_STATE_DIR, LEGACY_UPLOAD_DIR, LEGACY_DERIVED_DIR]) {
    if (existsSync(path) === false) continue
    try {
      if (readdirSync(path).length > 0) return true
    } catch {
      // unreadable is not "has data"
    }
  }
  return existsSync(LEGACY_WE_ROOTS_FILE)
}

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');

/**
 * RGB node version compatibility guard — Phase 2 refactor.
 *
 * rgb-lightning-node ships breaking changes to its on-disk state between
 * versions (LDK channel monitor format, bdk_db schema, rgb_lib_db schema,
 * etc.). If the packaged binary is newer than the data left over from a
 * previous install, spawning it against the old data dir can hang, crash,
 * or — worst case — corrupt state that has real funds behind it.
 *
 * This module no longer shows dialogs. It has been split into three
 * functions that the welcome page (src/ui/welcome/) calls via IPC:
 *
 *   inspectOnly()                  → { state, stored, expected, … }
 *   performLdkResetWithBackup()    → { ok, backupDir }
 *   acknowledgeVersionMismatch()   → { ok }
 *
 * inspectOnly() drives the welcome-page banner. It does side-effect
 * stamp the version file for the "fresh" and "non-breaking" states
 * (matching the old checker's quiet-path behavior), but otherwise is
 * read-only. performLdkResetWithBackup() is the destructive action the
 * user confirms from the welcome banner; it backs up .rgb/.ldk before
 * wiping and refuses to wipe if backup fails. acknowledgeVersionMismatch
 * is used by the "Start Anyway" escape hatch on the unknown-state
 * banner — it writes the version stamp so the banner does not come
 * back every launch, without touching on-disk state.
 *
 * "Reset" here wipes ONLY the LDK channel-state subtree (`.rgb/.ldk`),
 * because the currently-listed breaking boundary only changed the LDK
 * channel monitor format. Wallet mnemonic, rgb_lib_db and BDK on-chain
 * state are preserved. If a future breaking upgrade affects a different
 * subsystem, extend rgb-compat.json into a per-version wipe manifest
 * rather than broadening the blast radius here.
 *
 * The version stamp lives at `<userData>/.rgb_node_version` rather than
 * inside `.rgb/` so it survives a reset and can detect subsequent
 * upgrades.
 */

// File lives at userData root so it outlives a .rgb/ wipe.
const VERSION_STAMP_FILE = '.rgb_node_version';

/* ----------------------------- json readers ----------------------------- */

/**
 * Read a JSON file bundled at the project root. Uses __dirname-relative
 * resolution so it works identically in dev (`<project>/<name>`) and in
 * the packaged app (`<resources>/app.asar/<name>`, assuming package.json
 * files config includes it).
 */
function readBundledJson(filename) {
  // src/services/rgb-version-checker.js -> ../../<filename>
  const candidates = [
    path.join(__dirname, '..', '..', filename),
    path.join(app.getAppPath(), filename),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        log.info(`[rgb-version] reading ${filename} from: ${candidate}`);
        return JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      }
    } catch (e) {
      log.warn(`[rgb-version] failed to parse ${candidate}: ${e.message}`);
    }
  }
  log.warn(`[rgb-version] ${filename} not found at any candidate path`);
  return null;
}

function readBinariesJson() {
  return readBundledJson('binaries.json');
}

function readCompatJson() {
  return readBundledJson('rgb-compat.json');
}

/**
 * Extract the bundled rgb-lightning-node version for the current platform.
 * Returns the GitHub release tag (e.g. "v0.2.1-rc.6") parsed from the
 * download URL in binaries.json, or null if it cannot be determined.
 */
function getExpectedRgbVersion() {
  const binaries = readBinariesJson();
  if (!binaries) return null;

  const platform = os.platform();            // darwin | win32 | linux
  const arch = os.arch();                    // arm64 | x64
  const key = `${platform}-${arch}`;
  const binaryName = platform === 'win32' ? 'rgb-lightning-node.exe' : 'rgb-lightning-node';

  const url = binaries[key] && binaries[key][binaryName];
  if (!url || typeof url !== 'string') return null;

  // URL format: .../releases/download/<tag>/<asset>
  const match = url.match(/\/download\/([^/]+)\//);
  return match ? match[1] : null;
}

/* ------------------------ version parsing + classify ------------------------ */

/**
 * Parse a rgb-lightning-node release tag like "v0.2.1-rc.6" into a struct
 * that can be ordered. Returns null if the tag doesn't match the expected
 * shape — callers must treat null as "unknown, fall back to safe path".
 *
 * Shape: `v<major>.<minor>.<patch>[-<pre>[.<preNum>]]`
 */
function parseVersion(tag) {
  if (typeof tag !== 'string') return null;
  const t = tag.trim();
  // Full semver: v0.2.1-rc.6
  const m = t.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9]+)(?:\.(\d+))?)?$/);
  if (m) {
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      pre: m[4] || null,
      preNum: m[5] != null ? Number(m[5]) : null,
      raw: tag,
    };
  }
  // Short-form: v2 or v2.1 (legacy stamps from older builds) — pad with zeros
  const s = t.match(/^v?(\d+)(?:\.(\d+))?$/);
  if (s) {
    return {
      major: Number(s[1]),
      minor: s[2] != null ? Number(s[2]) : 0,
      patch: 0,
      pre: null,
      preNum: null,
      raw: tag,
    };
  }
  return null;
}

/**
 * Order two parsed versions. Returns -1 / 0 / 1 like Array.sort.
 * Follows semver-style pre-release ordering: a final release is GREATER
 * than any pre-release of the same x.y.z (v0.2.1 > v0.2.1-rc.6).
 * Among pre-releases, compares pre identifier lexicographically then
 * preNum numerically.
 */
function compareVersions(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  // Same x.y.z. Final release (pre == null) wins over any pre-release.
  if (a.pre == null && b.pre != null) return 1;
  if (a.pre != null && b.pre == null) return -1;
  if (a.pre == null && b.pre == null) return 0;
  if (a.pre !== b.pre) return a.pre < b.pre ? -1 : 1;
  const an = a.preNum ?? 0;
  const bn = b.preNum ?? 0;
  if (an !== bn) return an < bn ? -1 : 1;
  return 0;
}

/**
 * Decide whether upgrading from `stored` to `expected` crosses any known
 * breaking boundary. A breaking version `v` marks the release at (or
 * after) which the on-disk format changed, so the upgrade is breaking iff
 *   stored < v && v <= expected
 * for at least one entry in `breakingVersions`.
 *
 * Returns:
 *   { breaking: true,  crossed: <tag> }  if any boundary is crossed
 *   { breaking: false }                  if none are crossed
 *   { breaking: null,  reason: <string> } if we can't tell (parse failure,
 *                                          missing compat file, etc.) —
 *                                          callers should treat null as
 *                                          "unknown" and fall back to the
 *                                          safety dialog.
 */
function classifyUpgrade(storedTag, expectedTag, breakingVersions) {
  if (!Array.isArray(breakingVersions)) {
    return { breaking: null, reason: 'compat file missing or malformed' };
  }
  const stored = parseVersion(storedTag);
  const expected = parseVersion(expectedTag);
  if (!expected) {
    return { breaking: null, reason: `cannot parse expected tag "${expectedTag}"` };
  }
  if (!stored) {
    // Stored tag is unrecognisable (corrupt stamp, or written by a very
    // old build that used a different format). Assume worst case.
    return { breaking: null, reason: `cannot parse stored tag "${storedTag}"` };
  }

  // Downgrade guard: running an older binary against state written by a
  // newer one is exactly the scenario we're trying to protect against —
  // older RLN cannot read a newer on-disk format and will hang or
  // corrupt. The breakingVersions list is written from the perspective
  // of forward upgrades and won't catch this, so we force the unknown
  // path and let the user choose explicitly.
  if (compareVersions(stored, expected) > 0) {
    return {
      breaking: null,
      reason: `downgrade detected (${storedTag} -> ${expectedTag})`,
    };
  }

  for (const bv of breakingVersions) {
    const parsed = parseVersion(bv);
    if (!parsed) {
      log.warn(`[rgb-version] ignoring unparseable breakingVersions entry: ${bv}`);
      continue;
    }
    // stored < parsed <= expected  ⇒  upgrade crosses this boundary
    if (compareVersions(stored, parsed) < 0 && compareVersions(parsed, expected) <= 0) {
      return { breaking: true, crossed: bv };
    }
  }
  return { breaking: false };
}

/* ---------------------------- stamp I/O ---------------------------- */

function getVersionStampPath() {
  return path.join(pathManager.getDataPath(), VERSION_STAMP_FILE);
}

function getStoredRgbVersion() {
  const stamp = getVersionStampPath();
  if (!fs.existsSync(stamp)) return null;
  try {
    const content = fs.readFileSync(stamp, 'utf-8').trim();
    return content || null;
  } catch (e) {
    log.warn(`[rgb-version] failed to read stamp: ${e.message}`);
    return null;
  }
}

function writeStoredRgbVersion(version) {
  const stamp = getVersionStampPath();
  try {
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, version, 'utf-8');
  } catch (e) {
    log.warn(`[rgb-version] failed to write stamp: ${e.message}`);
  }
}

/**
 * Treat the RGB data dir as "in use" if it contains anything except logs.
 * A fresh install or a freshly-reset state has either no dir at all or only
 * a logs/ subdirectory, in which case there's nothing to warn about.
 */
function rgbDataIsMeaningful() {
  const rgbDir = path.join(pathManager.getDataPath(), '.rgb');
  if (!fs.existsSync(rgbDir)) return false;
  try {
    const entries = fs.readdirSync(rgbDir);
    return entries.some((name) => name !== 'logs');
  } catch {
    return false;
  }
}

/* ---------------------------- public API ---------------------------- */

/**
 * Inspect the current RGB node version situation and return a result
 * the welcome page can render. Has minimal, idempotent side effects for
 * states where the resolution is obviously "just refresh the stamp":
 *
 *   state === 'ok'           expected === stored, no-op
 *   state === 'fresh'        no meaningful .rgb/ yet, stamp is written
 *   state === 'non-breaking' mismatch but compat.json says safe, stamp
 *                            is refreshed silently
 *   state === 'breaking'     mismatch AND crosses a known breaking
 *                            boundary AND there is existing data — user
 *                            must run performLdkResetWithBackup() or
 *                            quit. stored/expected/crossed are returned.
 *   state === 'unknown'      compat info is unavailable or tags can't be
 *                            parsed. reason is returned. Start Anyway is
 *                            a valid escape hatch via
 *                            acknowledgeVersionMismatch().
 *   state === 'expected-unknown'
 *                            binaries.json could not be read. Treat as
 *                            degraded but non-blocking — welcome page
 *                            surfaces a yellow warning but allows Start.
 */
function inspectOnly() {
  const expected = getExpectedRgbVersion();
  if (!expected) {
    log.warn('[rgb-version] expected version unknown (binaries.json read failed?)');
    return { state: 'expected-unknown' };
  }

  const stored = getStoredRgbVersion();
  log.info(`[rgb-version] expected=${expected} stored=${stored ?? '(none)'}`);

  if (stored === expected) {
    return { state: 'ok', stored, expected };
  }

  if (!rgbDataIsMeaningful()) {
    writeStoredRgbVersion(expected);
    log.info('[rgb-version] fresh install, stamped version and continuing');
    return { state: 'fresh', stored, expected };
  }

  // Stamp file missing but .rgb data exists — the stamp was lost (Clear All
  // Data, or an older build that never wrote one). We cannot know which
  // version created the data, so assume it matches the current binary and
  // stamp it. The data was clearly working before the stamp disappeared.
  if (stored == null) {
    writeStoredRgbVersion(expected);
    log.info(
      `[rgb-version] stamp missing with existing .rgb data, ` +
        `assuming current version ${expected} and stamping`,
    );
    return { state: 'non-breaking', stored: null, expected };
  }

  const compat = readCompatJson();
  const classification = classifyUpgrade(
    stored,
    expected,
    compat && compat.breakingVersions,
  );

  if (classification.breaking === false) {
    log.info(
      `[rgb-version] non-breaking upgrade ${stored} -> ${expected}, ` +
        'refreshing stamp silently',
    );
    writeStoredRgbVersion(expected);
    return { state: 'non-breaking', stored, expected };
  }

  if (classification.breaking === true) {
    log.warn(
      `[rgb-version] BREAKING upgrade ${stored} -> ${expected} ` +
        `(crossed ${classification.crossed}) with existing data`,
    );
    return {
      state: 'breaking',
      stored,
      expected,
      crossed: classification.crossed,
    };
  }

  // breaking === null  →  unknown (compat missing / parse failure / downgrade)
  log.warn(
    `[rgb-version] UNKNOWN upgrade safety ${stored ?? '(none)'} -> ${expected}: ` +
      classification.reason,
  );
  return {
    state: 'unknown',
    stored,
    expected,
    reason: classification.reason,
  };
}

/**
 * Take a timestamped backup of <userData>/.rgb/.ldk and then wipe it.
 * Refuses to wipe if the backup fails — the thrown error exposes the
 * (never-reached) backup path via `.backupDir` for consistency with the
 * startup-actions helpers, but in practice the thrown error means no
 * wipe happened so there is nothing to recover.
 *
 * Also refreshes the version stamp on success so that the next launch
 * sees the current expected version and does not re-warn.
 *
 * If .ldk does not exist (nothing to wipe), we still refresh the stamp
 * and return ok with backupDir: null. This covers the edge case where
 * the user somehow ends up in the "breaking" state without any channel
 * monitor data yet.
 */
function performLdkResetWithBackup() {
  const expected = getExpectedRgbVersion();
  const rgbDir = path.join(pathManager.getDataPath(), '.rgb');
  const ldkDir = path.join(rgbDir, '.ldk');

  if (!fs.existsSync(ldkDir)) {
    log.warn(`[rgb-version] ${ldkDir} not present, nothing to wipe`);
    if (expected) writeStoredRgbVersion(expected);
    return { ok: true, backupDir: null };
  }

  // Backup
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(
    pathManager.getDataPath(),
    'backups',
    `ldk-${stamp}`,
  );
  try {
    fs.mkdirSync(path.dirname(backupDir), { recursive: true });
    fs.cpSync(ldkDir, backupDir, { recursive: true });
    log.warn(`[rgb-version] backed up ${ldkDir} -> ${backupDir}`);
  } catch (backupErr) {
    log.error(
      `[rgb-version] backup failed, ABORTING reset: ${backupErr.message}`,
    );
    throw new Error(`backup failed: ${backupErr.message}`);
  }

  // Wipe
  try {
    log.warn(`[rgb-version] wiping ${ldkDir}`);
    fs.rmSync(ldkDir, { recursive: true, force: true });
  } catch (wipeErr) {
    log.error(
      `[rgb-version] wipe failed after successful backup: ${wipeErr.message}`,
    );
    const err = new Error(`wipe failed: ${wipeErr.message}`);
    err.backupDir = backupDir;
    throw err;
  }

  if (expected) writeStoredRgbVersion(expected);
  log.info('[rgb-version] reset complete');
  return { ok: true, backupDir };
}

/**
 * Acknowledge a mismatch and continue without resetting. Used by the
 * "Start Anyway" escape hatch on the unknown-state welcome banner.
 * Writes the expected version to the stamp file so the next launch
 * does not warn again. Does not touch on-disk state.
 */
function acknowledgeVersionMismatch() {
  const expected = getExpectedRgbVersion();
  if (!expected) {
    return { ok: false, error: 'expected version unknown, cannot stamp' };
  }
  writeStoredRgbVersion(expected);
  log.warn(
    `[rgb-version] user acknowledged version mismatch and chose to continue; ` +
      `stamped ${expected}`,
  );
  return { ok: true, expected };
}

module.exports = {
  // New Phase 2 API (called from welcome IPC handlers).
  inspectOnly,
  performLdkResetWithBackup,
  acknowledgeVersionMismatch,
  // Lower-level helpers kept for diagnostics / tests.
  getExpectedRgbVersion,
  getStoredRgbVersion,
  parseVersion,
  compareVersions,
  classifyUpgrade,
};

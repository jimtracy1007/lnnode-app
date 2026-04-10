const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');

/**
 * Pre-express startup actions: backup, clear, and version info.
 *
 * Every destructive function in this module assumes it is called BEFORE
 * any rgb-lightning-node / litd / tor process has been spawned, so
 * nothing is holding file locks or writing mid-transaction. The welcome
 * page is the intended caller; see src/ipc/welcome-handlers.js.
 */

// Top-level entries under the data dir that we never copy into a backup:
//   backups/ -> prevents recursive backup-of-backups
//   logs/    -> noisy, not state, large, not worth preserving across wipe
const BACKUP_SKIP = new Set(['backups', 'logs']);

function getDataEntriesForBackup() {
  const dataRoot = pathManager.getDataPath();
  if (!fs.existsSync(dataRoot)) {
    return { dataRoot, entries: [] };
  }
  const entries = fs.readdirSync(dataRoot).filter((n) => !BACKUP_SKIP.has(n));
  return { dataRoot, entries };
}

/**
 * Copy all top-level user data entries (except backups/ and logs/) into
 *   <dataRoot>/backups/<prefix>-<iso-timestamp>/
 *
 * Throws on copy failure — callers must treat a throw as "backup did NOT
 * complete, DO NOT proceed to any destructive step".
 */
function performBackup(prefix) {
  const { dataRoot, entries } = getDataEntriesForBackup();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataRoot, 'backups', `${prefix}-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const name of entries) {
    const src = path.join(dataRoot, name);
    const dst = path.join(backupDir, name);
    fs.cpSync(src, dst, { recursive: true });
  }
  log.info(
    `[startup-actions] backup written to ${backupDir} ` +
      `(${entries.length} top-level entries)`,
  );
  return { backupDir, copiedCount: entries.length };
}

/**
 * Wipe all top-level user data entries (except backups/ and logs/).
 * Does NOT take its own backup — the caller must have done so first.
 * Use performBackupAndWipe() if you want both steps atomically.
 */
function performWipe() {
  const { dataRoot, entries } = getDataEntriesForBackup();
  for (const name of entries) {
    const target = path.join(dataRoot, name);
    fs.rmSync(target, { recursive: true, force: true });
  }
  log.warn(
    `[startup-actions] wiped ${entries.length} entries under ${dataRoot}`,
  );
  return { dataRoot, wipedCount: entries.length };
}

/**
 * "Backup and clear" atomic convenience. Takes a pre-clear backup and
 * only then executes the wipe. Aborts and throws if the backup fails —
 * NEVER wipes without a successful copy. If the wipe fails AFTER a
 * successful backup, the thrown error carries a `.backupDir` property
 * so callers can surface the path to the user for manual recovery.
 */
function performBackupAndWipe() {
  const backup = performBackup('pre-clear');
  try {
    const wipe = performWipe();
    return { backup, wipe };
  } catch (e) {
    log.error(
      `[startup-actions] wipe failed AFTER successful backup: ${e.message}`,
    );
    const err = new Error(`Wipe failed: ${e.message}`);
    err.backupDir = backup.backupDir;
    throw err;
  }
}

/* ----------------------------- version info ----------------------------- */

function readBinariesJson() {
  const candidates = [
    path.join(__dirname, '..', '..', 'binaries.json'),
    path.join(app.getAppPath(), 'binaries.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      }
    } catch (e) {
      log.warn(`[startup-actions] failed to parse ${candidate}: ${e.message}`);
    }
  }
  return null;
}

function tagFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/\/download\/([^/]+)\//);
  return m ? m[1] : null;
}

/**
 * Pick the bundled rgb-lightning-node and litd tags for the current
 * platform. Returns tags where known, or 'unknown' otherwise.
 */
function getBundledVersions() {
  const bin = readBinariesJson();
  const fallback = { rgb: 'unknown', litd: 'unknown' };
  if (!bin) return fallback;
  const platform = os.platform();
  const arch = os.arch();
  const key = `${platform}-${arch}`;
  const group = bin[key] || {};
  const rgbKey = platform === 'win32' ? 'rgb-lightning-node.exe' : 'rgb-lightning-node';
  const litdKey = platform === 'win32' ? 'litd.exe' : 'litd';
  return {
    rgb: tagFromUrl(group[rgbKey]) || 'unknown',
    litd: tagFromUrl(group[litdKey]) || 'unknown',
  };
}

/**
 * Full app info bundle: app/runtime/bundled versions + data directory.
 * Safe to call from main or from IPC-exposed handlers.
 */
function getAppInfo() {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: `${os.platform()}-${os.arch()}`,
    dataDir: pathManager.getDataPath(),
    ...getBundledVersions(),
  };
}

module.exports = {
  performBackup,
  performWipe,
  performBackupAndWipe,
  getBundledVersions,
  getAppInfo,
};

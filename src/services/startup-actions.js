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
// Chromium singleton-lock files live in userData and are managed entirely
// by the Electron/Chromium runtime — never back them up or delete them.
// Chromium/Electron runtime entries in userData — never back up or wipe these.
const BACKUP_SKIP = new Set([
  'backups',
  'app-config.json',
  'SingletonCookie', 'SingletonLock', 'SingletonSocket',
  'Local Storage', 'Session Storage', 'GPUCache', 'Code Cache',
  'Network', 'blob_storage', 'Partitions',
]);

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

/**
 * Pick the bundled rgb-lightning-node and litd tags for the current
 * platform from PROVENANCE.json in the @nodeflow-network/bin-<plat>-<arch>
 * sub-package. Returns 'unknown' for any component that cannot be resolved.
 */
function getBundledVersions() {
  const subpkg = `@nodeflow-network/bin-${os.platform()}-${os.arch()}`;
  try {
    const subpkgDir = path.dirname(require.resolve(`${subpkg}/package.json`));
    const provenancePath = path.join(subpkgDir, 'PROVENANCE.json');
    if (!fs.existsSync(provenancePath)) {
      log.warn(`[startup-actions] PROVENANCE.json not found at ${provenancePath}`);
      return { rgb: 'unknown', litd: 'unknown' };
    }
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf-8'));
    return {
      rgb: (provenance.rgb && provenance.rgb.tag) || 'unknown',
      // provenance.terminal.tag = litd tag (from the `lightning-terminal` repo, hence "terminal")
      litd: (provenance.terminal && provenance.terminal.tag) || 'unknown',
    };
  } catch (e) {
    log.warn(`[startup-actions] getBundledVersions failed (subpkg=${subpkg}): ${e.message}`);
    return { rgb: 'unknown', litd: 'unknown' };
  }
}

/**
 * Full app info bundle: app/runtime/bundled versions + data directory.
 * Safe to call from main or from IPC-exposed handlers.
 */
function getAppInfo() {
  let logDir = null;
  try {
    const electronLog = require('../utils/logger');
    const logFile = electronLog.transports.file.getFile();
    if (logFile && logFile.path) {
      logDir = require('path').dirname(logFile.path);
    }
  } catch {
    // non-fatal
  }
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: `${os.platform()}-${os.arch()}`,
    dataDir: pathManager.getDataPath(),
    logDir,
    lnlinkLogDir: path.join(pathManager.getDataPath(), '.logs'),
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

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, dialog } = require('electron');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');

/**
 * RGB node version compatibility guard.
 *
 * rgb-lightning-node ships breaking changes to its on-disk state between
 * versions (LDK channel monitor format, bdk_db schema, rgb_lib_db schema,
 * etc.). If the packaged binary is newer than the data left over from a
 * previous install, spawning it against the old data dir can hang, crash,
 * or — worst case — corrupt state that has real funds behind it.
 *
 * This module inspects the version embedded in the bundled binaries.json,
 * compares it to a version stamp stored alongside the user's data, and
 * prompts the user before touching anything:
 *   - First install:     stamp the current version, no dialog.
 *   - Same version:      no-op.
 *   - Different version: modal dialog. User can either
 *       a) reset .rgb/ and continue, or
 *       b) exit the app so they can back up data manually.
 *
 * The version stamp lives at `<userData>/.rgb_node_version` rather than
 * inside `.rgb/` so it survives a reset and can detect subsequent upgrades.
 */

// File lives at userData root so it outlives a .rgb/ wipe.
const VERSION_STAMP_FILE = '.rgb_node_version';

/**
 * Read the bundled binaries.json. Uses __dirname-relative resolution so it
 * works identically in dev (`<project>/binaries.json`) and in the packaged
 * app (`<resources>/app.asar/binaries.json`, because package.json files
 * config includes `"binaries.json"`).
 */
function readBinariesJson() {
  // src/services/rgb-version-checker.js -> ../../binaries.json
  const candidates = [
    path.join(__dirname, '..', '..', 'binaries.json'),
    path.join(app.getAppPath(), 'binaries.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        log.info(`[rgb-version] reading binaries.json from: ${candidate}`);
        return JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      }
    } catch (e) {
      log.warn(`[rgb-version] failed to parse ${candidate}: ${e.message}`);
    }
  }
  log.warn(`[rgb-version] binaries.json not found at any candidate path`);
  return null;
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

/**
 * Main entry point. Call this from express-server.start() before any
 * lnlink-server code has had a chance to spawn rgb-lightning-node.
 *
 * @returns {Promise<{ok: boolean, action: 'none'|'stamp-only'|'reset'|'exit', expected?: string, stored?: string|null, error?: string}>}
 */
async function checkAndMaybeReset() {
  const expected = getExpectedRgbVersion();
  if (!expected) {
    log.warn('[rgb-version] expected version unknown, skipping check');
    return { ok: true, action: 'none' };
  }

  const stored = getStoredRgbVersion();
  log.info(`[rgb-version] expected=${expected} stored=${stored ?? '(none)'}`);

  if (stored === expected) {
    return { ok: true, action: 'none', expected, stored };
  }

  // Fresh install (or very old install that never stamped a version) with no
  // meaningful RGB state. Just record the version and continue silently.
  if (!rgbDataIsMeaningful()) {
    writeStoredRgbVersion(expected);
    log.info('[rgb-version] fresh install, stamped version and continuing');
    return { ok: true, action: 'stamp-only', expected, stored };
  }

  // Version mismatch AND existing RGB state. Ask the user what to do.
  log.warn(`[rgb-version] mismatch: ${stored ?? '(unknown)'} -> ${expected} with existing data`);

  let parentWindow;
  try {
    parentWindow = require('../ui/window-manager').getMainWindow?.();
  } catch {
    parentWindow = undefined;
  }

  const rgbDir = path.join(pathManager.getDataPath(), '.rgb');
  const dialogOptions = {
    type: 'warning',
    buttons: ['Reset RGB Node Data', 'Quit'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'RGB Node Version Incompatible',
    message: `RGB node upgraded from ${stored ?? 'unknown'} to ${expected}`,
    detail:
      'The new RGB node binary may not be able to read the existing data. ' +
      'Continuing as-is can crash the node or corrupt state.\n\n' +
      '"Reset RGB Node Data" will permanently delete:\n' +
      '  • Wallet mnemonic and derived keys\n' +
      '  • All existing Lightning channels and LDK monitors\n' +
      '  • All issued RGB assets and rgb_lib_db\n' +
      '  • BDK on-chain wallet state\n\n' +
      '⚠️ Back up this directory first if you need the data:\n' +
      rgbDir + '\n\n' +
      'Choose "Quit" to exit without changes so you can handle it manually.',
  };

  let response;
  try {
    const result = parentWindow
      ? await dialog.showMessageBox(parentWindow, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);
    response = result.response;
  } catch (e) {
    log.error(`[rgb-version] dialog failed: ${e.message}`);
    return { ok: false, action: 'exit', error: e.message };
  }

  if (response !== 0) {
    log.warn('[rgb-version] user chose to exit');
    app.exit(0);
    return { ok: false, action: 'exit', expected, stored };
  }

  // User confirmed reset. Wipe .rgb/ entirely and stamp the new version.
  try {
    log.warn(`[rgb-version] wiping ${rgbDir}`);
    fs.rmSync(rgbDir, { recursive: true, force: true });
    writeStoredRgbVersion(expected);
    log.info('[rgb-version] reset complete');
    return { ok: true, action: 'reset', expected, stored };
  } catch (e) {
    log.error(`[rgb-version] reset failed: ${e.message}`);
    return { ok: false, action: 'reset', error: e.message, expected, stored };
  }
}

module.exports = {
  checkAndMaybeReset,
  getExpectedRgbVersion,
  getStoredRgbVersion,
};

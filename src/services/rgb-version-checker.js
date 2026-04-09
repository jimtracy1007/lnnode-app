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
 * Read the bundled binaries.json. In dev it sits at the project root; in
 * the packaged app it's at the root of app.asar (because package.json
 * files config includes `"binaries.json"`).
 */
function readBinariesJson() {
  const candidates = [
    path.join(app.getAppPath(), 'binaries.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      }
    } catch (e) {
      log.warn(`[rgb-version] failed to parse ${candidate}: ${e.message}`);
    }
  }
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
    buttons: ['重置 RGB 节点数据', '退出应用'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'RGB 节点版本不兼容',
    message: `RGB 节点从 ${stored ?? '未知版本'} 升级到 ${expected}`,
    detail:
      '新版 RGB 节点可能无法读取旧版数据，继续运行可能导致节点崩溃或数据损坏。\n\n' +
      '选择「重置 RGB 节点数据」将清空以下内容:\n' +
      '  • 钱包助记词和派生密钥\n' +
      '  • 已建立的 Lightning 通道和 LDK monitor\n' +
      '  • 已 issue 的 RGB 资产和 rgb_lib_db\n' +
      '  • BDK 链上钱包数据\n\n' +
      '⚠️ 请先手动备份:\n' +
      rgbDir + '\n\n' +
      '如果取消（或关闭此窗口）应用将退出，方便你手动处理。',
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

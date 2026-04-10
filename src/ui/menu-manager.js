const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, Menu, dialog, shell, BrowserWindow } = require('electron');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');

/**
 * Application menu, backup / clear actions, and a version-info dialog.
 *
 * The main process calls buildAppMenu() once after the main window exists
 * (Menu.setApplicationMenu must run after app is ready). All menu-driven
 * destructive actions take a timestamped backup under
 *   <userData>/backups/<kind>-<iso-timestamp>/
 * before touching anything. For a wallet we never destroy without a copy.
 */

/* ----------------------------- version info ----------------------------- */

/**
 * Read bundled binaries.json. Same resolution strategy as the rgb version
 * checker — __dirname-relative in dev, app.asar in packaged builds. Kept
 * local to this file so menu-manager does not depend on the checker.
 */
function readBinariesJson() {
  // src/ui/menu-manager.js -> ../../binaries.json
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
      log.warn(`[menu] failed to parse ${candidate}: ${e.message}`);
    }
  }
  log.warn('[menu] binaries.json not found');
  return null;
}

/** Extract the release tag out of a GitHub download URL. */
function tagFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/\/download\/([^/]+)\//);
  return m ? m[1] : null;
}

/**
 * Pick the rgb-lightning-node and litd tags for the current platform.
 * Returns `{ rgb, litd }`, each either a tag string or 'unknown'.
 */
function getBundledVersions() {
  const bin = readBinariesJson();
  if (!bin) return { rgb: 'unknown', litd: 'unknown' };
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

async function showVersions() {
  const versions = getBundledVersions();
  const parent = BrowserWindow.getFocusedWindow();
  await dialog.showMessageBox(parent || undefined, {
    type: 'info',
    title: 'NodeFlow Versions',
    message: 'Bundled component versions',
    detail:
      `NodeFlow:            ${app.getVersion()}\n` +
      `Electron:            ${process.versions.electron}\n` +
      `Node.js:             ${process.versions.node}\n` +
      `rgb-lightning-node:  ${versions.rgb}\n` +
      `litd:                ${versions.litd}`,
    buttons: ['OK'],
    defaultId: 0,
  });
}

/* ------------------------------- backups -------------------------------- */

// Top-level entries under the data dir that we never copy into a backup:
//   backups/ -> prevents recursive backup-of-backups
//   logs/    -> noisy, not state, large
const BACKUP_SKIP = new Set([
  'backups',
  'SingletonCookie', 'SingletonLock', 'SingletonSocket',
  'Local Storage', 'Session Storage', 'GPUCache', 'Code Cache',
  'Network', 'blob_storage', 'Partitions',
]);

function getDataEntriesForBackup() {
  const dataRoot = pathManager.getDataPath();
  if (!fs.existsSync(dataRoot)) return { dataRoot, entries: [] };
  const entries = fs.readdirSync(dataRoot).filter((n) => !BACKUP_SKIP.has(n));
  return { dataRoot, entries };
}

/**
 * Copy all top-level user data entries (except backups/ and logs/) into
 * <dataRoot>/backups/<prefix>-<timestamp>/. Throws on any copy failure —
 * callers must treat a throw as "backup did NOT complete, do not proceed
 * to destructive step".
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
  return { backupDir, copiedCount: entries.length };
}

/**
 * Manual "Backup Node Data Now" menu flow.
 *
 * Caveat: the node is still running during the copy. LDK monitor files are
 * written atomically by LDK (write new file + rename), so individual channel
 * monitors are safe, but the SQLite user DB could be mid-write and produce
 * a slightly inconsistent snapshot. We surface this in the confirm dialog
 * so users who want a perfectly consistent backup can quit first and copy
 * the data dir manually.
 */
async function backupNow() {
  const parent = BrowserWindow.getFocusedWindow();
  const confirm = await dialog.showMessageBox(parent || undefined, {
    type: 'question',
    title: 'Backup Node Data',
    message: 'Create a backup of all NodeFlow data now?',
    detail:
      'This will copy the contents of your data directory (wallet state, ' +
      'Lightning channels, RGB assets, user database) to a timestamped ' +
      'folder under <userData>/backups/.\n\n' +
      'Note: the node is still running during the backup, so for a ' +
      'perfectly consistent snapshot you should quit NodeFlow first and ' +
      'copy the data directory manually. For routine backups this live ' +
      'copy is usually fine — LDK writes channel monitor files atomically.',
    buttons: ['Backup Now', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (confirm.response !== 0) return;

  let result;
  try {
    result = performBackup('manual');
    log.info(
      `[menu/backup] wrote backup to ${result.backupDir} ` +
        `(${result.copiedCount} top-level entries)`,
    );
  } catch (e) {
    log.error(`[menu/backup] failed: ${e.message}`);
    await dialog.showMessageBox(parent || undefined, {
      type: 'error',
      title: 'Backup Failed',
      message: 'Could not create backup',
      detail: e.message,
      buttons: ['OK'],
    });
    return;
  }

  const done = await dialog.showMessageBox(parent || undefined, {
    type: 'info',
    title: 'Backup Complete',
    message: 'Backup created successfully',
    detail:
      `Saved ${result.copiedCount} top-level entries to:\n\n` +
      `${result.backupDir}`,
    buttons: ['Open in Finder', 'OK'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (done.response === 0) shell.showItemInFolder(result.backupDir);
}

/**
 * "Clear All Data and Restart" menu flow. Destructive:
 *   1. confirm with the user (default: Cancel),
 *   2. stop the express server so file locks are released,
 *   3. take a pre-clear backup (abort on failure — never wipe without a copy),
 *   4. wipe all top-level entries except backups/ and logs/,
 *   5. relaunch.
 */
async function clearAndRestart() {
  const parent = BrowserWindow.getFocusedWindow();
  const confirm = await dialog.showMessageBox(parent || undefined, {
    type: 'warning',
    title: 'Clear All Data and Restart',
    message: 'This will permanently delete all node data.',
    detail:
      'Wallet mnemonic, Lightning channels (and their LDK monitors), ' +
      'issued RGB assets, BDK on-chain wallet state, and the user database ' +
      'will all be removed.\n\n' +
      'A timestamped backup will be created first at:\n' +
      '  <userData>/backups/pre-clear-<timestamp>/\n\n' +
      'After clearing, NodeFlow will restart. This action is IRREVERSIBLE ' +
      'without restoring from the backup.',
    buttons: ['Backup and Clear', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (confirm.response !== 0) return;

  // Lazy-require to avoid any circular-dep surprises between menu-manager
  // and express-server during module init.
  const expressServer = require('../services/express-server');

  // 1. Stop the server so rgb-lightning-node / litd / tor release their
  //    file locks. Without this, rmSync on Windows will fail on EBUSY and
  //    on macOS may leave files behind.
  try {
    log.warn('[menu/clear] stopping express server before wipe');
    await Promise.race([
      expressServer.stop(),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
  } catch (e) {
    log.error(`[menu/clear] expressServer.stop failed: ${e.message}`);
    // continue — we still want to try the backup + wipe
  }

  // 2. Backup — abort the whole flow if this fails.
  let backup;
  try {
    backup = performBackup('pre-clear');
    log.warn(`[menu/clear] backup written to ${backup.backupDir}`);
  } catch (e) {
    log.error(`[menu/clear] backup failed, ABORTING wipe: ${e.message}`);
    await dialog.showMessageBox(parent || undefined, {
      type: 'error',
      title: 'Clear Aborted',
      message: 'Backup failed — data was NOT cleared',
      detail:
        'A backup could not be created, so NodeFlow refused to delete ' +
        'anything. Your data is intact.\n\n' +
        `Error: ${e.message}\n\n` +
        'Please resolve the underlying issue (free disk space, fix ' +
        'permissions, etc.) and try again.',
      buttons: ['OK'],
    });
    return;
  }

  // 3. Wipe top-level entries (except backups/ and logs/).
  try {
    const { dataRoot, entries } = getDataEntriesForBackup();
    for (const name of entries) {
      fs.rmSync(path.join(dataRoot, name), { recursive: true, force: true });
    }
    log.warn(`[menu/clear] wiped ${entries.length} entries under ${dataRoot}`);
  } catch (e) {
    log.error(`[menu/clear] wipe failed after backup: ${e.message}`);
    await dialog.showMessageBox(parent || undefined, {
      type: 'error',
      title: 'Clear Partially Failed',
      message: 'Some data could not be deleted',
      detail:
        `Error: ${e.message}\n\n` +
        `A backup was successfully created at:\n${backup.backupDir}\n\n` +
        'You may need to quit NodeFlow and remove the data directory ' +
        'manually.',
      buttons: ['OK'],
    });
    return;
  }

  // 4. Tell the user, relaunch.
  await dialog.showMessageBox(parent || undefined, {
    type: 'info',
    title: 'Data Cleared',
    message: 'All node data has been cleared. NodeFlow will restart.',
    detail: `Backup saved at:\n${backup.backupDir}`,
    buttons: ['Restart'],
  });
  app.relaunch();
  app.exit(0);
}

/* -------------------------- return to welcome --------------------------- */

/**
 * Stop all services and navigate back to the welcome page.
 * The welcome page is the safe pre-express entry point for Backup / Clear.
 */
async function returnToWelcome() {
  const parent = BrowserWindow.getFocusedWindow();
  const confirm = await dialog.showMessageBox(parent || undefined, {
    type: 'question',
    title: 'Return to Welcome Page',
    message: 'Stop all services and return to the welcome page?',
    detail:
      'rgb-lightning-node, litd, and Tor will be stopped. ' +
      'You can use the welcome page to back up or clear your data, ' +
      'then restart services.',
    buttons: ['Return to Welcome', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (confirm.response !== 0) return;

  const expressServer = require('../services/express-server');
  const windowManager = require('./window-manager');
  const processManager = require('../services/process-manager');

  // Snapshot service PIDs before stop so processManager can force-kill
  // any orphans if lnLink.stop() times out.
  try {
    processManager.snapshotServicePids(expressServer.getServicePids());
  } catch (e) {
    log.warn(`[menu/return-to-welcome] could not snapshot PIDs: ${e.message}`);
  }

  try {
    log.info('[menu/return-to-welcome] stopping express server');
    await Promise.race([
      expressServer.stop(),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
  } catch (e) {
    log.error(`[menu/return-to-welcome] expressServer.stop failed: ${e.message}`);
    // Continue — load the welcome page anyway.
  }

  // Force-kill any remaining litd/rgb/tor processes to avoid orphans that
  // would conflict when the user clicks Start again.
  try {
    processManager.killAllProcesses();
    // Reset the shutdown flag after a short delay so Start works again.
    setTimeout(() => { processManager.isShuttingDown = false; }, 3500);
  } catch (e) {
    log.warn(`[menu/return-to-welcome] killAllProcesses failed: ${e.message}`);
  }

  try {
    await windowManager.loadWelcomePage();
    log.info('[menu/return-to-welcome] welcome page loaded');
  } catch (e) {
    log.error(`[menu/return-to-welcome] loadWelcomePage failed: ${e.message}`);
    await dialog.showMessageBox(parent || undefined, {
      type: 'error',
      title: 'Navigation Failed',
      message: 'Could not load the welcome page',
      detail: e.message,
      buttons: ['OK'],
    });
  }
}

/* -------------------------------- menu ---------------------------------- */

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  // Use app.getName() so the first-menu label tracks whatever the app
  // identifies as. In dev we set this to 'NodeFlow' via app.setName()
  // from main.js; in packaged builds it comes from package.json.
  const appName = app.getName();

  const template = [
    // macOS application menu (first menu — label is driven by app name).
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              { role: 'about', label: `About ${appName}` },
              { type: 'separator' },
              {
                label: 'Version Info…',
                click: () => {
                  showVersions();
                },
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: `Hide ${appName}` },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: `Quit ${appName}` },
            ],
          },
        ]
      : []),

    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Data Directory',
          click: () => {
            shell.openPath(pathManager.getDataPath());
          },
        },
        { type: 'separator' },
        {
          label: 'Return to Welcome Page…',
          click: () => returnToWelcome(),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // Edit (standard)
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
            ]
          : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' },
            ]),
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },

    // Help
    {
      role: 'help',
      submenu: [
        {
          label: 'Version Info…',
          click: () => {
            showVersions();
          },
        },
        { type: 'separator' },
        {
          label: 'Open Data Directory',
          click: () => {
            shell.openPath(pathManager.getDataPath());
          },
        },
        {
          label: 'Open Logs Directory',
          click: () => {
            try {
              const electronLog = require('../utils/logger');
              const logFile = electronLog.transports.file.getFile();
              if (logFile && logFile.path) {
                shell.showItemInFolder(logFile.path);
              }
            } catch (e) {
              log.error(`[menu] failed to open logs dir: ${e.message}`);
            }
          },
        },
        {
          label: 'Open lnlink Logs Directory',
          click: () => {
            const lnlinkLogDir = path.join(pathManager.getDataPath(), '.logs');
            shell.openPath(lnlinkLogDir).catch((e) => {
              log.error(`[menu] failed to open lnlink logs dir: ${e.message}`);
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  log.info(`[menu] application menu built (app name: ${appName})`);
}

module.exports = {
  buildAppMenu,
  showVersions,
  backupNow,
  clearAndRestart,
  // exported for diagnostics / tests
  getBundledVersions,
};

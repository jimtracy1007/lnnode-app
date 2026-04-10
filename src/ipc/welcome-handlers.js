const { ipcMain, app, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../utils/logger');
const startupActions = require('../services/startup-actions');
const pathManager = require('../utils/path-manager');

/**
 * NodeFlow stores every service's state inside a dot-prefixed directory
 * (.rgb, .lnd, .litd, .tor, .link, .tapd, …). On macOS Finder hides
 * dot-entries by default, so a user who clicks "Open Data Folder" will
 * see an apparently empty window even though the data is all there.
 *
 * This helper makes sure the directory ALSO contains one visible entry
 * (a README.txt) before Finder is opened, so the user has a signpost
 * and can't confuse "Finder hid my files" with "the app never wrote
 * anything here." The README is idempotent — we only write it if the
 * directory currently has no non-hidden entry.
 */
function ensureVisibleDataDirMarker(dataRoot) {
  try {
    if (!fs.existsSync(dataRoot)) {
      fs.mkdirSync(dataRoot, { recursive: true });
    }
    const entries = fs.readdirSync(dataRoot);
    const hasVisible = entries.some((name) => !name.startsWith('.'));
    if (hasVisible) return;

    const readmePath = path.join(dataRoot, 'README.txt');
    const contents =
      'NodeFlow Data Directory\n' +
      '========================\n\n' +
      'This folder holds NodeFlow\'s on-disk state. Most of it lives in\n' +
      'dot-prefixed subdirectories which macOS Finder hides by default:\n\n' +
      '  .rgb/     rgb-lightning-node state (LDK monitors, rgb_lib_db, BDK)\n' +
      '  .lnd/     lnd / litd Lightning state\n' +
      '  .litd/    lightning-terminal state\n' +
      '  .tor/     Tor state and torrc\n' +
      '  .link/    lnlink-server user database (SQLite)\n' +
      '  .tapd/    Taproot assets daemon state\n' +
      '  .logs/    Application logs\n' +
      '  backups/  Timestamped backups created by NodeFlow\n\n' +
      'To see the hidden entries in Finder press  ⌘ + ⇧ + .  (Command, Shift, Dot).\n' +
      'On Windows / Linux file managers, enable "Show hidden files".\n\n' +
      'Do NOT delete or edit files inside this directory while NodeFlow is\n' +
      'running — doing so can corrupt wallet state. Use the NodeFlow welcome\n' +
      'screen ("Backup Data Now" / "Clear All Data") for safe maintenance.\n';
    fs.writeFileSync(readmePath, contents, 'utf-8');
    log.info(`[welcome] wrote data dir signpost: ${readmePath}`);
  } catch (e) {
    // Non-fatal: if we can't write the README we still open the folder.
    log.warn(`[welcome] could not write data dir README: ${e.message}`);
  }
}

/**
 * IPC handlers that back the Electron-native welcome page.
 *
 * Every handler here runs BEFORE expressServer.start() on the normal
 * launch path, so rgb-lightning-node / litd / tor are not yet spawned
 * and the data directory is at rest — no file locks, no in-flight
 * SQLite writes, no live LDK monitor updates. This is the safe window
 * for destructive operations. The one exception is `welcome:start`
 * itself, which intentionally transitions out of this safe state.
 *
 * The handlers pull expressServer and windowManager lazily (inside the
 * function body, not at require time) to keep this module free of a
 * require-time dependency on modules that initialize Electron app state.
 */
function registerWelcomeHandlers() {
  // Clear any previously-registered handlers (dev/reload safety).
  const channels = [
    'welcome:start',
    'welcome:backup',
    'welcome:clear',
    'welcome:info',
    'welcome:open-data-dir',
    'welcome:confirm',
    'welcome:quit',
    'welcome:version-check',
    'welcome:reset-ldk',
    'welcome:acknowledge-version',
    'welcome:port-check',
  ];
  channels.forEach((c) => ipcMain.removeHandler(c));

  // User clicked "Start Node" on the welcome page. Bring services up
  // and navigate the window to the local express URL. On failure the
  // welcome page stays visible and either shows a generic error toast
  // or, for classified high-stakes failures (currently only 'migration'),
  // forwards the classification + context so the renderer can render a
  // dedicated persistent banner with recovery actions.
  ipcMain.handle('welcome:start', async () => {
    try {
      log.info('[welcome] user requested services start');
      // Lazy require: avoid circular init order between welcome-handlers
      // and express-server / window-manager.
      const expressServer = require('../services/express-server');
      const windowManager = require('../ui/window-manager');
      await expressServer.start();
      await windowManager.loadAppUrl();
      return { ok: true };
    } catch (e) {
      log.error(`[welcome] start failed: ${e.message}`);
      return {
        ok: false,
        error: e.message,
        classification: e.classification || null,
        failedMigration: e.failedMigration || null,
        dbPath: e.dbPath || null,
      };
    }
  });

  // Manual backup. Pre-express so the copy is guaranteed consistent.
  ipcMain.handle('welcome:backup', async () => {
    try {
      const result = startupActions.performBackup('manual');
      log.info(`[welcome] backup written to ${result.backupDir}`);
      return { ok: true, ...result };
    } catch (e) {
      log.error(`[welcome] backup failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  // Destructive: backup then wipe. performBackupAndWipe() aborts before
  // any rmSync if backup fails, so the "no delete without backup" rule
  // is enforced at the function-boundary level.
  ipcMain.handle('welcome:clear', async () => {
    try {
      const result = startupActions.performBackupAndWipe();
      log.warn(
        `[welcome] data cleared (backup=${result.backup.backupDir}, ` +
          `wiped=${result.wipe.wipedCount})`,
      );
      return {
        ok: true,
        backupDir: result.backup.backupDir,
        wipedCount: result.wipe.wipedCount,
      };
    } catch (e) {
      log.error(`[welcome] clear failed: ${e.message}`);
      return {
        ok: false,
        error: e.message,
        // If wipe failed after a successful backup, the error carries
        // the backup path so the renderer can show it to the user.
        backupDir: e.backupDir || null,
      };
    }
  });

  // Read-only info used by the welcome page to render its version card
  // and data-directory footer.
  ipcMain.handle('welcome:info', async () => {
    try {
      return { ok: true, ...startupActions.getAppInfo() };
    } catch (e) {
      log.error(`[welcome] info failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  // Open the data directory in the system file manager.
  //
  // macOS Finder hides dot-entries by default and the data dir is full
  // of them (.rgb, .lnd, .litd, …), so without a signpost the user
  // sees an apparently empty folder. ensureVisibleDataDirMarker writes
  // a README.txt (idempotent) that explains the layout and tells the
  // user the ⌘⇧. shortcut to reveal hidden files.
  ipcMain.handle('welcome:open-data-dir', async () => {
    try {
      const p = pathManager.getDataPath();
      ensureVisibleDataDirMarker(p);
      await shell.openPath(p);
      return { ok: true, path: p, platform: os.platform() };
    } catch (e) {
      log.error(`[welcome] open-data-dir failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  // Native confirm dialog bridge. We use the OS-native dialog rather
  // than building a custom modal in welcome.html — native dialogs give
  // correct focus trap, keyboard handling, and "X-to-dismiss" behavior
  // for free, and they match the rest of the app's dialogs.
  ipcMain.handle('welcome:confirm', async (_event, opts) => {
    const { title, message, detail, destructive } = opts || {};
    // Lazy require to avoid load-order gymnastics.
    const windowManager = require('../ui/window-manager');
    const parent = windowManager.getMainWindow();
    const buttons = destructive
      ? ['Cancel', 'Yes, Continue']
      : ['Cancel', 'OK'];
    const result = await dialog.showMessageBox(parent || undefined, {
      type: destructive ? 'warning' : 'question',
      title: title || 'Confirm',
      message: message || 'Are you sure?',
      detail: detail || '',
      buttons,
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return { confirmed: result.response === 1 };
  });

  // User clicked the Quit button on the welcome page.
  ipcMain.handle('welcome:quit', async () => {
    log.info('[welcome] user requested quit');
    app.quit();
    return { ok: true };
  });

  // RGB node version compatibility check. Runs BEFORE any RLN spawn so
  // the welcome page can render the result as a banner and (if breaking)
  // gate the Start button until the user chooses to reset or quit.
  ipcMain.handle('welcome:version-check', async () => {
    try {
      const rgbVersionChecker = require('../services/rgb-version-checker');
      return { ok: true, ...rgbVersionChecker.inspectOnly() };
    } catch (e) {
      log.error(`[welcome] version-check failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  // Destructive: back up <userData>/.rgb/.ldk and wipe it. Invoked when
  // the user clicks "Back Up & Reset Channel State" on the version
  // banner. Backup-first discipline is enforced inside
  // rgb-version-checker.performLdkResetWithBackup — it refuses to wipe
  // if the backup fails.
  ipcMain.handle('welcome:reset-ldk', async () => {
    try {
      const rgbVersionChecker = require('../services/rgb-version-checker');
      const result = rgbVersionChecker.performLdkResetWithBackup();
      return { ok: true, ...result };
    } catch (e) {
      log.error(`[welcome] reset-ldk failed: ${e.message}`);
      return {
        ok: false,
        error: e.message,
        backupDir: e.backupDir || null,
      };
    }
  });

  // "Start Anyway" escape hatch on the unknown-state banner. Stamps the
  // expected version so the warning does not come back every launch.
  ipcMain.handle('welcome:acknowledge-version', async () => {
    try {
      const rgbVersionChecker = require('../services/rgb-version-checker');
      return rgbVersionChecker.acknowledgeVersionMismatch();
    } catch (e) {
      log.error(`[welcome] acknowledge-version failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  // Port pre-check. Probes all expected service ports and identifies any
  // occupying processes so the welcome page can surface a clear warning
  // before the user clicks Start. Non-blocking: ln-link's
  // assignAvailablePorts() handles single-port conflicts at startup, but
  // users deserve to know if port 9735 is taken by another Lightning node
  // rather than seeing a cryptic crash message.
  ipcMain.handle('welcome:port-check', async () => {
    try {
      const portChecker = require('../services/port-checker');
      return portChecker.checkPorts();
    } catch (e) {
      log.error(`[welcome] port-check failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  log.info('[welcome] IPC handlers registered');
}

module.exports = { registerWelcomeHandlers };

// 加载 .env 文件中的环境变量
const path = require('path');
const { app } = require('electron');

// 确定 .env 文件路径（开发和打包环境）
const envPath = app.isPackaged 
  ? path.join(process.resourcesPath, 'app.asar', '.env')
  : path.join(__dirname, '..', '.env');

require('dotenv').config({ path: envPath });
// DO NOT REMOVE: some downstream code (Nostr heartbeat path and likely
// nostr-tools internals) uses a bare `crypto.<method>` reference expecting
// the Node `crypto` module to be available as a global. Node 19+ ships
// `globalThis.crypto` as Web Crypto, which lacks `createHash` /
// `randomBytes` / etc., so removing this override causes runtime errors
// like "crypto is not defined" on the Nostr heartbeat. If you need to
// clean this up, first grep deps for bare `crypto.` references and
// convert them to explicit `require('crypto')` before removing.
global.crypto = require('crypto');
const { ipcMain, shell } = require('electron');
const log = require('./utils/logger');

const processManager = require('./services/process-manager');
const expressServer = require('./services/express-server');
const windowManager = require('./ui/window-manager');
const menuManager = require('./ui/menu-manager');
const { registerNostrHandlers } = require('./ipc/nostr-handlers');
const { registerWelcomeHandlers } = require('./ipc/welcome-handlers');

// Brand the app as "NodeFlow" in the macOS menu bar during development.
//
// Why only in dev: calling app.setName() changes what app.getPath('userData')
// resolves to, which would move packaged users' data from
//   ~/Library/Application Support/LN-Link/
// to
//   ~/Library/Application Support/NodeFlow/
// and silently orphan existing wallets. path-manager.js uses a hardcoded
// local ./data path in dev (see src/utils/path-manager.js:38) so the
// rename is harmless there, but in packaged mode it would be catastrophic.
//
// To fully rebrand the packaged build, change `build.productName` in
// package.json to "NodeFlow" AND add a migration step that moves the old
// userData dir to the new name on first launch. That's a separate piece
// of work from this dev-side menu rename.
if (!app.isPackaged) {
  app.setName('NodeFlow');
}

// Single-instance lock. Running two LN-Link instances against the same
// user data directory would:
//   - race Prisma migrations on the SQLite user DB,
//   - double-bind ports (express, RLN peer, litd, tor),
//   - and most dangerously, corrupt LDK channel monitor state since two
//     rgb-lightning-node processes would write to the same .ldk/ tree.
// Refuse to start a second instance; focus the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  log.warn('Another LN-Link instance is already running — quitting this one');
  app.quit();
  return;
}
app.on('second-instance', () => {
  log.info('Second instance attempted — focusing existing window');
  try {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  } catch (e) {
    log.error('Failed to focus existing window on second-instance:', e.message);
  }
});

let isShuttingDown = false;
let exitAllowed = false; // Only true after cleanup completes — prevents premature quit

// Register additional IPC handlers
function registerServerHandlers() {
  // Remove existing handlers first (for development mode)
  ipcMain.removeHandler('restart-server');
  ipcMain.removeHandler('get-server-status');
  ipcMain.removeHandler('navigate-to-welcome');
  
  // Restart server handler
  ipcMain.handle('restart-server', async () => {
    try {
      log.info('Restarting Express server via IPC...');

      // Stop current server
      expressServer.stop();

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Start server again
      await expressServer.start();

      log.info('Express server restarted successfully');
      return { success: true, message: 'Server restarted successfully' };
    } catch (error) {
      log.error('Failed to restart server:', error);
      return { success: false, message: error.message };
    }
  });

  // Get server status
  ipcMain.handle('get-server-status', async () => {
    try {
      return {
        isRunning: expressServer.isRunning(),
        port: expressServer.getPort()
      };
    } catch (error) {
      log.error('Failed to get server status:', error);
      return { isRunning: false, port: null };
    }
  });

  // Get app version
  ipcMain.handle('get-app-version', async () => {
    return app.getVersion();
  });

  // Navigate back to the local welcome page (bridge for external sites like devoflnnode.unift.xyz)
  ipcMain.handle('navigate-to-welcome', async () => {
    try {
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        const url = `http://127.0.0.1:${expressServer.getPort()}`;
        log.info(`Navigating back to welcome page: ${url}`);
        await mainWindow.loadURL(url);
        return { success: true };
      }
      return { success: false, message: 'Main window not available' };
    } catch (error) {
      log.error('Failed to navigate to welcome:', error);
      return { success: false, message: error.message };
    }
  });

  // Open external URL in default browser
  ipcMain.handle('open-external', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      log.error('Failed to open external URL:', error);
      return { success: false, message: error.message };
    }
  });

  log.info('Server IPC handlers registered');
}

// Handle uncaught exceptions. The previous handler logged and CONTINUED,
// which left the app in a half-dead state — window alive, services maybe
// zombied, no clear error shown to the user. For a wallet-managing app
// that is unacceptable. Log, notify the renderer, run the SYNCHRONOUS
// force-kill of child processes (async cleanup is unsafe because the
// event loop may itself be compromised), and exit non-zero.
process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception:', err);
  try {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uncaughtException', err.message);
    }
  } catch (e) {
    log.error('Failed to notify renderer of uncaughtException:', e.message);
  }
  try {
    processManager.forceKillAllSync();
  } catch (e) {
    log.error('forceKillAllSync during uncaughtException failed:', e.message);
  }
  process.exit(1);
});

// Same fatal-quit policy for unhandled promise rejections. Without this
// handler, a rejection inside the spawn path, the Prisma migrator, or any
// IPC handler can zombify the main process (black window, children still
// alive, no error surfaced). Force-kill children and exit non-zero.
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled Rejection:', reason);
  try {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const msg = reason instanceof Error ? reason.message : String(reason);
      mainWindow.webContents.send('uncaughtException', msg);
    }
  } catch (e) {
    log.error('Failed to notify renderer of unhandledRejection:', e.message);
  }
  try {
    processManager.forceKillAllSync();
  } catch (e) {
    log.error('forceKillAllSync during unhandledRejection failed:', e.message);
  }
  process.exit(1);
});

// Check for and track any remaining processes (cross-platform).
//
// This function walks the system process table looking for litd /
// rgb-lightning-node / tor processes that our own bookkeeping does NOT
// currently know about, and adopts them so they get killed at cleanup
// time. Historically it matched by name alone, which is a foot-gun:
// `tor` also matches a user's Tor Browser, `litd` also matches a
// separate lightning-terminal instance the user runs outside NodeFlow.
//
// The safer filter below adopts a candidate iff AT LEAST ONE of:
//
//   1. The candidate is a descendant of this Electron main process in
//      the system pid tree. That is, walking up from candidate.pid
//      via the ppid chain reaches our own process.pid. This catches
//      live children and grandchildren that are not yet in our own
//      tracking (e.g. spawned by lnlink-server but not reported back
//      yet) without touching unrelated user processes.
//
//   2. The candidate's command line references our bundled bin/
//      directory. This catches orphans left over from a previous
//      NodeFlow instance that crashed before it could reap them —
//      the parent is now init (ppid === 1) but the binary on disk
//      is still under our install path, so we can be sure it's ours.
//
// Anything else is left alone.
async function checkForRemainingProcesses() {
  let list;
  try {
    const { default: psList } = await import('ps-list');
    list = await psList();
  } catch (e) {
    log.error(`Failed to list processes: ${e.message}`);
    return;
  }

  // Build a pid -> ppid map once, so the descendant check is O(depth)
  // instead of re-scanning the list.
  const pidMap = new Map();
  for (const p of list) pidMap.set(p.pid, p.ppid);

  const ourPid = process.pid;
  const ourBinPath = pathManager.getBinaryPath();

  // Walk up from `candidatePid` via ppid until we either find
  // `ancestorPid`, reach pid 1, or hit a guard limit. Guards against
  // cycles / broken ppid data.
  function isDescendantOf(candidatePid, ancestorPid) {
    let cur = candidatePid;
    let guard = 0;
    while (cur && cur !== 1 && guard < 64) {
      if (cur === ancestorPid) return true;
      const parent = pidMap.get(cur);
      if (parent == null || parent === cur) return false;
      cur = parent;
      guard += 1;
    }
    return false;
  }

  // Does `proc.cmd` reference a binary under our bundled bin/ tree?
  // ps-list sometimes returns a truncated or empty cmd on macOS — when
  // it does we return false and miss the orphan case, which is the
  // safe failure mode (leave foreign processes alone).
  function isOurBinary(proc) {
    const cmd = proc && proc.cmd;
    if (!cmd || !ourBinPath) return false;
    return cmd.indexOf(ourBinPath) !== -1;
  }

  function shouldAdopt(proc) {
    if (!proc || !proc.pid) return false;
    if (isDescendantOf(proc.pid, ourPid)) return true;
    if (isOurBinary(proc)) return true;
    return false;
  }

  // Factory: build a minimal child-process-shaped object that exposes
  // just the .pid / .kill() / .on() surface processManager cares about.
  function makeMock(name, pid) {
    return {
      pid,
      kill: (signal) => {
        try {
          process.kill(pid, signal);
          return true;
        } catch (e) {
          log.error(`Error killing ${name} process: ${e.message}`);
          return false;
        }
      },
      on: () => {},
    };
  }

  // Single place to describe each service we care about: the name
  // regex used as a first-pass filter, the "already tracked?" check
  // on processManager, and the setter used to adopt the found PID.
  const services = [
    {
      name: 'litd',
      nameRegex: /\blitd\b/,
      isTracked: () => !!processManager.getLitdProcess(),
      adopt: (mock) => processManager.setLitdProcess(mock),
    },
    {
      name: 'rgb-lightning-node',
      nameRegex: /rgb-lightning-node/,
      isTracked: () => !!processManager.getRgbNodeProcess(),
      adopt: (mock) => processManager.setRgbNodeProcess(mock),
    },
    {
      name: 'tor',
      nameRegex: /\btor\b/,
      isTracked: () => !!processManager.getTorProcess(),
      adopt: (mock) => processManager.setTorProcess(mock),
    },
  ];

  for (const svc of services) {
    if (svc.isTracked()) continue;
    const candidate = list.find((p) => {
      if (!svc.nameRegex.test(`${p.name} ${p.cmd || ''}`)) return false;
      return shouldAdopt(p);
    });
    if (candidate) {
      log.info(
        `Adopting untracked ${svc.name} process PID=${candidate.pid} ` +
          `(ppid=${candidate.ppid}, reason=${
            isDescendantOf(candidate.pid, ourPid) ? 'descendant' : 'our-binary'
          })`,
      );
      svc.adopt(makeMock(svc.name, candidate.pid));
    }
  }
}

// Centralized cleanup function
async function performCleanup() {
  if (isShuttingDown) {
    log.info('Cleanup already in progress, skipping duplicate cleanup');
    return;
  }

  isShuttingDown = true;
  log.info('Performing application cleanup...');

  // Snapshot fresh PIDs from ln-link BEFORE stopping — ensures forceKillAllSync
  // has valid PIDs even if lnLink.stop() hangs on server.close().
  processManager.snapshotServicePids(expressServer.getServicePids());

  // Check for any remaining processes before cleanup
  await checkForRemainingProcesses();

  // Stop Express server (lnLink.stop() will gracefully stop child processes)
  // Timeout prevents hanging if server.close() blocks on active connections.
  try {
    const stopTimeout = new Promise(resolve => setTimeout(() => {
      log.warn('expressServer.stop() timed out after 8s, continuing cleanup...');
      resolve();
    }, 8000));
    await Promise.race([expressServer.stop(), stopTimeout]);
  } catch (e) {
    log.error('expressServer.stop() failed:', e);
  }

  // Fallback: kill any remaining child processes that lnLink.stop() missed.
  // Child processes are spawned with detached:true, so they survive parent exit.
  // This ensures litd/rgb/tor are cleaned up even if lnLink.stop() times out.
  processManager.killAllProcesses();
}

// Main application initialization
async function initApp() {
  try {
    log.info('Starting Lightning Network Node application');

    // Create the main application window
    await windowManager.createMainWindow();

    // Install the custom application menu. Note: backup/clear items
    // have been removed from the menu in Phase 1 — the welcome page is
    // the single entry point for those actions (see src/ui/welcome/).
    menuManager.buildAppMenu();

    // Register IPC handlers (Nostr + runtime server controls + welcome
    // page handlers). welcome:* handlers are registered up-front so the
    // welcome page can call them the moment it loads.
    registerNostrHandlers();
    registerServerHandlers();
    registerWelcomeHandlers();

    // Navigate from the initial loading screen to the Electron-native
    // welcome page. Express is NOT started here any more — the welcome
    // page has a Start button that the user clicks when they are ready
    // to bring services up. This gives the user a safe pre-express
    // window to run backup / clear / version info / open-data-dir.
    await windowManager.loadWelcomePage();

    // Open DevTools in development mode
    if (!app.isPackaged) {
      windowManager.openDevTools();
      log.info('DevTools opened in development mode');
    }

  } catch (error) {
    log.error('Failed to initialize application:', error);
    app.quit();
  }
}

// Create window when Electron initialization is complete
app.whenReady().then(initApp).catch(err => {
  log.error('Failed to start application:', err);
  app.quit();
});

// Quit the application when all windows are closed.
//
// Previously on macOS we stayed in the dock (the Electron default) and
// only quit on Cmd+Q, but users found this confusing: clicking the red
// close button left a zombie Electron icon running in the dock, and a
// second click was needed to actually quit. For a wallet-managing app
// that is worse than confusing — it leaves rgb-lightning-node / litd /
// tor running in the background even though the user thinks they
// closed the app.
//
// New policy: on ALL platforms, closing the last window quits the app.
// The window-close confirmation dialog in window-manager.js guarantees
// the user explicitly approved quit before we got here, so we can run
// cleanup unconditionally.
app.on('window-all-closed', async () => {
  log.info('All windows closed');
  await performCleanup();
  // Give killAllProcesses's setTimeout(3000) time to fire
  setTimeout(() => {
    exitAllowed = true;
    app.exit(0);
  }, 3500);
});

// Re-create window on macOS when dock icon is clicked
app.on('activate', () => {
  if (!windowManager.isWindowActive()) {
    // Reset shutdown flags so re-activation from dock can restart services
    isShuttingDown = false;
    exitAllowed = false;
    initApp();
  }
});

// Handle SIGHUP (terminal closed) — without this, the process dies immediately
// and process.on('exit') does NOT fire, leaving child processes orphaned.
process.on('SIGHUP', () => {
  log.info('Received SIGHUP (terminal closed), force killing child processes...');
  processManager.forceKillAllSync();
  process.exit(0);
});

// Handle SIGINT (Ctrl+C in terminal / yarn dev) — intercept before Node.js default exit
process.on('SIGINT', async () => {
  log.info('Received SIGINT, performing cleanup before exit...');
  try {
    await performCleanup();
  } catch (e) {
    log.error('Cleanup on SIGINT failed:', e);
  }
  // Give killAllProcesses's setTimeout(3000) time to fire
  setTimeout(() => {
    exitAllowed = true;
    app.exit(0);
  }, 3500);
});

// Add before-quit event handler (graceful quit via menu / Cmd+Q)
// CRITICAL: Always preventDefault() unless exitAllowed is true.
// Without this, SIGINT handler sets isShuttingDown=true, then Electron's
// internal SIGINT handling triggers before-quit which would allow quit
// before async cleanup completes.
app.on('before-quit', async (event) => {
  if (exitAllowed) {
    log.info('Exit allowed, proceeding with quit');
    return;
  }

  // Always block quit until cleanup is done
  event.preventDefault();

  if (isShuttingDown) {
    // Cleanup already in progress (e.g. from SIGINT handler), just block the quit
    log.info('Cleanup in progress, preventing premature quit');
    return;
  }

  log.info('Application is about to quit, starting cleanup...');

  // Perform cleanup
  await performCleanup();

  // Allow time for killAllProcesses's setTimeout(3000) fallback
  setTimeout(() => {
    log.info('Cleanup completed, now exiting application');
    exitAllowed = true;
    app.exit(0);
  }, 3500);
});

// Absolute last-resort: synchronous force kill on process exit.
// This runs even if async cleanup was interrupted or incomplete.
// process.on('exit') only allows synchronous code — forceKillAllSync uses execSync.
process.on('exit', () => {
  processManager.forceKillAllSync();
});
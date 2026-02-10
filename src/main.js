// 加载 .env 文件中的环境变量
const path = require('path');
const { app } = require('electron');

// 确定 .env 文件路径（开发和打包环境）
const envPath = app.isPackaged 
  ? path.join(process.resourcesPath, 'app.asar', '.env')
  : path.join(__dirname, '..', '.env');

require('dotenv').config({ path: envPath });
global.crypto = require('crypto'); // Add global crypto object
const { ipcMain, shell } = require('electron');
const log = require('./utils/logger');

const processManager = require('./services/process-manager');
const expressServer = require('./services/express-server');
const windowManager = require('./ui/window-manager');
const { registerNostrHandlers } = require('./ipc/nostr-handlers');

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

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception:', err);

  // Send error to main window if it exists
  const mainWindow = windowManager.getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('uncaughtException', err.message);
  }
});

// Check for and track any remaining processes (cross-platform)
async function checkForRemainingProcesses() {
  try {
    const { default: psList } = await import('ps-list');
    const list = await psList();

    // litd
    if (!processManager.getLitdProcess()) {
      const lit = list.find(p => /\blitd\b/.test(`${p.name} ${p.cmd || ''}`));
      if (lit && lit.pid) {
        const mainPid = lit.pid;
        log.info(`Found untracked litd process with PID: ${mainPid}, tracking it`);
        const mockProcess = {
          pid: mainPid,
          kill: (signal) => {
            try { process.kill(mainPid, signal); return true; } catch (e) { log.error(`Error killing litd process: ${e.message}`); return false; }
          },
          on: () => {}
        };
        processManager.setLitdProcess(mockProcess);
      }
    }

    // rgb-lightning-node
    if (!processManager.getRgbNodeProcess()) {
      const rgb = list.find(p => /rgb-lightning-node/.test(`${p.name} ${p.cmd || ''}`));
      if (rgb && rgb.pid) {
        const mainPid = rgb.pid;
        log.info(`Found untracked rgb-lightning-node process with PID: ${mainPid}, tracking it`);
        const mockProcess = {
          pid: mainPid,
          kill: (signal) => {
            try { process.kill(mainPid, signal); return true; } catch (e) { log.error(`Error killing rgb-lightning-node process: ${e.message}`); return false; }
          },
          on: () => {}
        };
        processManager.setRgbNodeProcess(mockProcess);
      }
    }

    // tor
    if (!processManager.getTorProcess()) {
      const tor = list.find(p => /\btor\b/.test(`${p.name} ${p.cmd || ''}`) && /9050/.test(p.cmd || ''));
      if (tor && tor.pid) {
        const mainPid = tor.pid;
        log.info(`Found untracked tor process with PID: ${mainPid}, tracking it`);
        const mockProcess = {
          pid: mainPid,
          kill: (signal) => {
            try { process.kill(mainPid, signal); return true; } catch (e) { log.error(`Error killing tor process: ${e.message}`); return false; }
          },
          on: () => {}
        };
        processManager.setTorProcess(mockProcess);
      }
    }
  } catch (e) {
    log.error(`Failed to list processes: ${e.message}`);
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

    // Register IPC handlers
    registerNostrHandlers();

    // Register additional IPC handlers
    registerServerHandlers();

    // Start Express server
    try {
      log.info('Starting Express server...');
      await expressServer.start();
      log.info('Express server started successfully');

      // Snapshot child process PIDs from ln-link so we can kill them on exit
      processManager.snapshotServicePids(expressServer.getServicePids());

      // Load the application URL
      await windowManager.loadAppUrl();
    } catch (error) {
      log.error('Failed to start Express server:', error);
      await windowManager.showErrorScreen(error);
    }

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

// Quit the application when all windows are closed
app.on('window-all-closed', async () => {
  log.info('All windows closed');

  if (process.platform !== 'darwin') {
    // On non-macOS platforms, clean up and quit
    await performCleanup();
    // Give killAllProcesses's setTimeout(3000) time to fire
    setTimeout(() => {
      exitAllowed = true;
      app.exit(0);
    }, 3500);
  }
  // On macOS (darwin), the app stays in the dock. Do NOT run cleanup here
  // so that re-activating from the dock can restart services normally.
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
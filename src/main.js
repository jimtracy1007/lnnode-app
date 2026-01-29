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
let processCheckInterval = null;

// Register additional IPC handlers
function registerServerHandlers() {
  // Remove existing handlers first (for development mode)
  ipcMain.removeHandler('restart-server');
  ipcMain.removeHandler('get-server-status');
  
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

  // Stop process checking interval
  if (processCheckInterval) {
    clearInterval(processCheckInterval);
    processCheckInterval = null;
  }

  // Check for any remaining processes before cleanup
  checkForRemainingProcesses();

  // Stop Express server
  await expressServer.stop();

  // Terminate all child processes
  processManager.killAllProcesses();

  // Final verification after cleanup (cross-platform best effort)
  setTimeout(async () => {
    try {
      const { default: psList } = await import('ps-list');
      const list = await psList();
      const leftovers = list.filter(p => /rgb-lightning-node|\blitd\b/.test(`${p.name} ${p.cmd || ''}`));
      for (const p of leftovers) {
        try { process.kill(p.pid, 'SIGKILL'); } catch (_) {}
      }
      log.info('Final cleanup verification completed');
    } catch (err) {
      log.error('Error in final cleanup verification:', err);
    }
  }, 2000);
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

    // Start periodic process checking (less frequent)
    processCheckInterval = setInterval(checkForRemainingProcesses, 10000); // Every 10 seconds

    // Start Express server
    try {
      log.info('Starting Express server...');
      await expressServer.start();
      log.info('Express server started successfully');

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
  await performCleanup();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Re-create window on macOS when dock icon is clicked
app.on('activate', () => {
  if (!windowManager.isWindowActive()) {
    initApp();
  }
});

// Add before-quit event handler
app.on('before-quit', async (event) => {
  if (isShuttingDown) {
    log.info('Already shutting down, allowing quit to proceed');
    return;
  }

  log.info('Application is about to quit');
  event.preventDefault();

  // Perform cleanup
  await performCleanup();

  // Allow time for cleanup then exit
  setTimeout(() => {
    log.info('Cleanup completed, now exiting application');
    app.exit(0);
  }, 3000); // Give more time for final verification
});

// Ensure server process is closed when the app exits
app.on('quit', async () => {
  log.info('Application is quitting');
  if (!isShuttingDown) {
    await performCleanup();
  }
});
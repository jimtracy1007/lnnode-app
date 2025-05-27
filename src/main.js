const { app } = require('electron');
global.crypto = require('crypto'); // Add global crypto object
const log = require('./utils/logger');
const pathManager = require('./utils/path-manager');
const processManager = require('./services/process-manager');
const expressServer = require('./services/express-server');
const windowManager = require('./ui/window-manager');
const { registerNostrHandlers } = require('./ipc/nostr-handlers');

let isShuttingDown = false;
let processCheckInterval = null;

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception:', err);
  
  // Send error to main window if it exists
  const mainWindow = windowManager.getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('uncaughtException', err.message);
  }
});

// Check for and track any remaining processes (more specific)
function checkForRemainingProcesses() {
  const { exec } = require('child_process');
  
  // Check for litd processes (only if not already tracked)
  if (!processManager.getLitdProcess()) {
    exec('pgrep -f "litd --disableui"', (err, stdout) => {
      if (!err && stdout.trim()) {
        const pids = stdout.trim().split('\n');
        const mainPid = parseInt(pids[0]); // Only track the first one
        if (mainPid) {
          log.info(`Found untracked litd process with PID: ${mainPid}, tracking it`);
          const mockProcess = {
            pid: mainPid,
            kill: (signal) => {
              try {
                process.kill(mainPid, signal);
                return true;
              } catch (e) {
                log.error(`Error killing litd process: ${e.message}`);
                return false;
              }
            },
            on: () => {}
          };
          processManager.setLitdProcess(mockProcess);
        }
      }
    });
  }
  
  // Check for rgb-lightning-node processes (only if not already tracked)
  if (!processManager.getRgbNodeProcess()) {
    exec('pgrep -f "rgb-lightning-node.*--daemon-listening-port"', (err, stdout) => {
      if (!err && stdout.trim()) {
        const pids = stdout.trim().split('\n');
        const mainPid = parseInt(pids[0]); // Only track the first one
        if (mainPid) {
          log.info(`Found untracked rgb-lightning-node process with PID: ${mainPid}, tracking it`);
          const mockProcess = {
            pid: mainPid,
            kill: (signal) => {
              try {
                process.kill(mainPid, signal);
                return true;
              } catch (e) {
                log.error(`Error killing rgb-lightning-node process: ${e.message}`);
                return false;
              }
            },
            on: () => {}
          };
          processManager.setRgbNodeProcess(mockProcess);
        }
      }
    });
  }
}

// Centralized cleanup function
function performCleanup() {
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
  expressServer.stop();
  
  // Terminate all child processes
  processManager.killAllProcesses();
  
  // Final verification after cleanup
  setTimeout(() => {
    const { execSync } = require('child_process');
    try {
      if (process.platform === 'darwin' || process.platform === 'linux') {
        execSync('pkill -9 -f "rgb-lightning-node" || true');
        execSync('pkill -9 -f "litd" || true');
        log.info('Final cleanup verification completed');
      }
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
app.on('window-all-closed', () => {
  log.info('All windows closed');
  performCleanup();
  
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
app.on('before-quit', (event) => {
  if (isShuttingDown) {
    log.info('Already shutting down, allowing quit to proceed');
    return;
  }
  
  log.info('Application is about to quit');
  event.preventDefault();
  
  // Perform cleanup
  performCleanup();
  
  // Allow time for cleanup then exit
  setTimeout(() => {
    log.info('Cleanup completed, now exiting application');
    app.exit(0);
  }, 3000); // Give more time for final verification
});

// Ensure server process is closed when the app exits
app.on('quit', () => {
  log.info('Application is quitting');
  if (!isShuttingDown) {
    performCleanup();
  }
});
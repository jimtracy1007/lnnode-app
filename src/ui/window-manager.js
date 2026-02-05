const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');
const expressServer = require('../services/express-server');

class WindowManager {
  constructor() {
    this.mainWindow = null;
  }

  // Create the main application window
  async createMainWindow() {
    try {
      // Create browser window
      this.mainWindow = new BrowserWindow({
        width: 1400,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          preload: path.join(__dirname, '..', 'preload.js'),
          webSecurity: true, 
          nodeIntegrationInSubFrames: true, // Allow preload script in subframes
          allowRunningInsecureContent: false,
          experimentalFeatures: false,
          backgroundColor: '#1e1e1e',
          partition: 'persist:lnlink-app'
        },
        icon: pathManager.getAppIcon(),
        titleBarStyle: 'default',
        show: false, // Don't show window until it's ready
        title: 'NodeFlow', // Set initial title
        backgroundColor: '#1e1e1e', // Set background color to avoid white screen
      });

      // Set timeout to ensure window is displayed within a certain time
      const showTimeout = setTimeout(() => {
        if (this.mainWindow && !this.mainWindow.isVisible()) {
          log.info('Force showing window after timeout');
          this.mainWindow.show();
        }
      }, 5000);

      // First show a loading interface
      await this._showLoadingScreen();
      
      // Wait for the loading page to be ready before showing the window
      this.mainWindow.once('ready-to-show', () => {
        clearTimeout(showTimeout); // Clear force show timeout
        this.mainWindow.show();
        log.info('Loading screen is now visible');
      });
      
      // Ensure window is shown after a certain time, even if ready-to-show event doesn't fire
      setTimeout(() => {
        if (this.mainWindow && !this.mainWindow.isVisible()) {
          log.info('Showing window after secondary timeout');
          this.mainWindow.show();
        }
      }, 1000);
      
      // Set up event handlers
      this._setupEventHandlers();

      return this.mainWindow;
    } catch (error) {
      log.error(`Failed to create window: ${error.message}`);
      throw error;
    }
  }

  // Load HTML template from file
  _loadTemplate(templateName) {
    const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
    try {
      return fs.readFileSync(templatePath, 'utf-8');
    } catch (error) {
      log.error(`Failed to load template ${templateName}: ${error.message}`);
      throw error;
    }
  }

  // Show loading screen
  async _showLoadingScreen() {
    const loadingHTML = this._loadTemplate('loading');
    
    // Use data URL to load HTML content, avoiding file system access delay
    await this.mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHTML)}`);
  }

  // Show error screen
  async showErrorScreen(error) {
    if (!this.mainWindow) return;
    
    let errorHTML = this._loadTemplate('error');
    
    // Inject error message into template
    const errorMessage = error.message || 'An unexpected error occurred.';
    errorHTML += `
      <script>
        document.getElementById('error-message').textContent = ${JSON.stringify(errorMessage)};
      </script>
    `;
    
    try {
      await this.mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHTML)}`);
    } catch (err) {
      log.error(`Failed to load error screen: ${err.message}`);
    }
  }

  // Show connection error screen
  async showConnectionErrorScreen(errorDescription) {
    if (!this.mainWindow) return;
    
    let connectionErrorHTML = this._loadTemplate('connection-error');
    
    // Inject error details into template
    const port = expressServer.getPort();
    connectionErrorHTML += `
      <script>
        document.getElementById('error-description').textContent = 'Error: ' + ${JSON.stringify(errorDescription)};
        document.getElementById('port-info').textContent = 'Please ensure the server is running and port ${port} is accessible.';
      </script>
    `;
    
    try {
      await this.mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(connectionErrorHTML)}`);
    } catch (err) {
      log.error(`Failed to load connection error screen: ${err.message}`);
    }
  }

  // Load application URL
  async loadAppUrl() {
    if (!this.mainWindow) return;

    const url = `http://127.0.0.1:${expressServer.getPort()}`;
    log.info(`Loading application URL: ${url}`);

    try {
      // 只清除当前 partition 的 HTTP 缓存
      await this.mainWindow.webContents.session.clearCache();
      log.info('Partition cache cleared before loading URL');

      await this.mainWindow.loadURL(url);
    } catch (error) {
      log.error(`Failed to load application URL: ${error.message}`);
      throw error;
    }
  }

  // Set up event handlers for the window
  _setupEventHandlers() {
    if (!this.mainWindow) return;

    // Add page loading event handling
    this.mainWindow.webContents.on('did-start-loading', () => {
      log.info('Application page started loading');
      // Keep title unchanged
      if (this.mainWindow) {
        this.mainWindow.setTitle('NodeFlow');
      }
    });
    
    this.mainWindow.webContents.on('did-finish-load', () => {
      log.info('Application page finished loading');
      
      // Set correct title
      if (this.mainWindow) {
        this.mainWindow.setTitle('NodeFlow');
        
        // Ensure page content is visible
        if (this.mainWindow.isMinimized()) {
          this.mainWindow.restore();
        }
        this.mainWindow.focus();
      }
    });
    
    // Handle page load failure
    this.mainWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription) => {
      log.error(`Page failed to load: ${errorDescription} (${errorCode})`);
      
      // If page fails to load due to connection issues, try to restart server
      if (errorCode === -102 || errorCode === -7) { // CONNECTION_REFUSED or TIMED_OUT
        log.info('Connection error detected, checking server status...');
        
        // Check if server is still running
        if (!expressServer.isRunning()) {
          log.info('Server is not running, attempting to restart...');
          try {
            await expressServer.start();
            log.info('Server restarted, reloading page...');
            setTimeout(() => {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.loadAppUrl();
              }
            }, 2000);
          } catch (error) {
            log.error('Failed to restart server:', error);
            await this.showConnectionErrorScreen(errorDescription);
          }
        } else {
          log.info('Server is running but page failed to load, retrying...');
          setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.loadAppUrl();
            }
          }, 3000);
        }
      } else if (errorCode !== -3) { // -3 is a load cancellation, not usually an error
        await this.showConnectionErrorScreen(errorDescription);
      }
    });
    
    // Triggered when window is closed
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  // Get the main window instance
  getMainWindow() {
    return this.mainWindow;
  }

  // Check if the main window exists and is not destroyed
  isWindowActive() {
    return this.mainWindow && !this.mainWindow.isDestroyed();
  }

  // Open DevTools
  openDevTools() {
    if (this.isWindowActive()) {
      this.mainWindow.webContents.openDevTools();
    }
  }
}

module.exports = new WindowManager(); 
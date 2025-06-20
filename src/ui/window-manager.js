const { BrowserWindow } = require('electron');
const path = require('path');
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
          webSecurity: false, 
          allowRunningInsecureContent: false,
          experimentalFeatures: false,
          backgroundColor: '#1e1e1e'
        },
        icon: pathManager.getAppIcon(),
        titleBarStyle: 'default',
        show: false, // Don't show window until it's ready
        title: 'LND NOSTR Link', // Set initial title
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

  // Show loading screen
  async _showLoadingScreen() {
    const loadingHTML = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Lnfi Network LN Node</title>
          <style>
            html, body {
              height: 100%;
              width: 100%;
              margin: 0;
              padding: 0;
              overflow: hidden;
              background-color: #1e1e1e;
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              color: #e0e0e0;
              text-align: center;
              background: linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #16213e 100%);
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
            }
            .container {
              max-width: 600px;
              background: rgba(30, 30, 30, 0.95);
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }
            h1 { 
              color: #fff; 
              margin-bottom: 20px;
            }
            .loader {
              border: 5px solid rgba(255,255,255,0.1);
              border-radius: 50%;
              border-top: 5px solid #4ecdc4;
              width: 50px;
              height: 50px;
              animation: spin 1s linear infinite;
              margin: 20px auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            .status {
              margin-top: 20px;
              font-size: 14px;
              color: #b0b0b0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>LN Node</h1>
            <p>Starting services, please wait...</p>
            <div class="loader"></div>
            <div class="status" id="status">Initializing...</div>
          </div>
          <script>
            // Simple status update animation
            const messages = [
              "Checking environment...",
              "Preparing services...",
              "Loading modules...",
              "Starting server..."
            ];
            let index = 0;
            const statusEl = document.getElementById('status');
            setInterval(() => {
              statusEl.textContent = messages[index % messages.length];
              index++;
            }, 2000);
            
            // Ensure document title is correct
            document.title = "Lnfi Network LN Node";
          </script>
        </body>
      </html>
    `;
    
    // Use data URL to load HTML content, avoiding file system access delay
    await this.mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHTML)}`);
  }

  // Show error screen
  async showErrorScreen(error) {
    if (!this.mainWindow) return;
    
    const errorHTML = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Lnfi Network LN Node - Error</title>
          <style>
            html, body {
              height: 100%;
              width: 100%;
              margin: 0;
              padding: 0;
              overflow: hidden;
              background-color: #1e1e1e;
            }
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              color: #e0e0e0;
              text-align: center;
              background: linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #16213e 100%);
              display: flex;
              justify-content: center;
              align-items: center;
            }
            .container {
              max-width: 600px;
              background: rgba(30, 30, 30, 0.95);
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }
            h1 { color: #f87171; }
            .error-details {
              background: rgba(248, 113, 113, 0.1);
              border-left: 4px solid #f87171;
              padding: 10px;
              text-align: left;
              margin: 20px 0;
              font-family: monospace;
              white-space: pre-wrap;
              overflow-x: auto;
              color: #e0e0e0;
            }
            button {
              background: #4ecdc4;
              color: #121212;
              border: none;
              padding: 10px 20px;
              border-radius: 4px;
              cursor: pointer;
              margin-top: 20px;
              font-weight: bold;
            }
            button:hover { background: #01a299; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Server Start Failed</h1>
            <p>Unable to start Lnfi Network LN Node server.</p>
            <div class="error-details">${error.message}</div>
            <p>Please check the log files for more information.</p>
            <button onclick="window.location.reload()">Retry</button>
          </div>
          <script>
            // Ensure document title is correct
            document.title = "Lnfi Network LN Node - Error";
          </script>
        </body>
      </html>
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
    
    const connectionErrorHTML = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Lnfi Network LN Node - Connection Error</title>
          <style>
            html, body {
              height: 100%;
              width: 100%;
              margin: 0;
              padding: 0;
              overflow: hidden;
              background-color: #1e1e1e;
            }
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              color: #e0e0e0;
              text-align: center;
              background: linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #16213e 100%);
              display: flex;
              justify-content: center;
              align-items: center;
            }
            .container {
              max-width: 600px;
              background: rgba(30, 30, 30, 0.95);
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }
            h1 { color: #f87171; }
            button {
              background: #4ecdc4;
              color: #121212;
              border: none;
              padding: 10px 20px;
              border-radius: 4px;
              cursor: pointer;
              margin-top: 20px;
              font-weight: bold;
            }
            button:hover { background: #01a299; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Connection Error</h1>
            <p>Unable to connect to LN Node server.</p>
            <p>Error: ${errorDescription}</p>
            <p>Please ensure the server is running and port ${expressServer.getPort()} is accessible.</p>
            <button onclick="window.location.reload()">Retry</button>
          </div>
          <script>
            // Ensure document title is correct
            document.title = "Lnfi Network LN Node - Connection Error";
          </script>
        </body>
      </html>
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
        this.mainWindow.setTitle('Lnfi Network LN Node');
      }
    });
    
    this.mainWindow.webContents.on('did-finish-load', () => {
      log.info('Application page finished loading');
      
      // Set correct title
      if (this.mainWindow) {
        this.mainWindow.setTitle('Lnfi Network LN Node');
        
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
      
      // If page fails to load, show a simple error page
      if (errorCode !== -3 && this.mainWindow) { // -3 is a load cancellation, not usually an error
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
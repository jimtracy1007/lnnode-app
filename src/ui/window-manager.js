const { BrowserWindow, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');
const expressServer = require('../services/express-server');

class WindowManager {
  constructor() {
    this.mainWindow = null;
    // "User has approved quit" — set to true once the close-confirmation
    // dialog returns Yes, or implicitly when quit was initiated via some
    // other code path (Cmd+Q, menu Quit, SIGINT, uncaughtException). The
    // close event handler uses this as an idempotency flag so that the
    // second close(), triggered from inside the confirm handler, passes
    // through without re-prompting.
    this.quitApproved = false;
    // Prevent two overlapping confirm dialogs if the user somehow triggers
    // close twice in quick succession.
    this._confirmInFlight = false;
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

  // Load the Electron-native welcome page. This is a local HTML file
  // served over file:// so the preload is attached correctly and the
  // welcome script can talk to main via window.welcomeAPI. The welcome
  // page is shown BEFORE expressServer.start() is called, giving the
  // user a safe window for backup / clear / version info actions
  // while no backend services are running.
  async loadWelcomePage() {
    if (!this.mainWindow) return;
    const welcomeFile = path.join(__dirname, 'welcome', 'welcome.html');
    log.info(`Loading welcome page: ${welcomeFile}`);
    try {
      await this.mainWindow.loadFile(welcomeFile);
      this.mainWindow.setTitle('NodeFlow');
    } catch (err) {
      log.error(`Failed to load welcome page: ${err.message}`);
      throw err;
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
    
    // User-initiated close path (red X button on macOS / Windows, Cmd+W
    // on macOS, Ctrl+W on Windows/Linux). For a wallet-managing app we
    // want an explicit confirm step before stopping the node — an
    // accidental close should NOT silently tear down Lightning services.
    //
    // Flow:
    //   1. First close event: quitApproved is false → preventDefault and
    //      show a native confirm dialog parented to this window.
    //   2. User picks "Cancel" → dialog closes, window stays open.
    //   3. User picks "Quit NodeFlow" → we set quitApproved=true and call
    //      mainWindow.close() again. The handler re-enters, sees the
    //      flag, and passes through without re-prompting.
    //   4. The window actually closes, window-all-closed fires, main.js
    //      runs performCleanup() + app.exit(0) on every platform.
    //
    // Cmd+Q / menu Quit / SIGINT / uncaughtException paths DO NOT fire
    // the window close event (they go straight to before-quit or
    // app.exit) so they bypass this dialog on purpose.
    this.mainWindow.on('close', async (event) => {
      if (this.quitApproved) return; // let the close proceed
      event.preventDefault();
      if (this._confirmInFlight) return;
      this._confirmInFlight = true;
      try {
        const iconPath = path.join(__dirname, '..', '..', 'assets', 'logo100.svg');
        const appIcon = fs.existsSync(iconPath)
          ? nativeImage.createFromPath(iconPath).resize({ width: 64, height: 64 })
          : undefined;
        const result = await dialog.showMessageBox(this.mainWindow, {
          type: 'question',
          buttons: ['Cancel', 'Quit NodeFlow'],
          defaultId: 0,
          cancelId: 0,
          title: 'Quit NodeFlow',
          message: 'Are you sure you want to quit NodeFlow?',
          detail:
            'This will stop the Lightning node and all background ' +
            'services (rgb-lightning-node, litd, tor).',
          noLink: true,
          ...(appIcon ? { icon: appIcon } : {}),
        });
        if (result.response === 1) {
          log.info('[window-manager] user confirmed quit from close dialog');
          this.quitApproved = true;
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.close();
          }
        } else {
          log.info('[window-manager] user cancelled close');
        }
      } catch (e) {
        log.error(`[window-manager] close-confirm dialog failed: ${e.message}`);
        // If the dialog itself failed, be conservative and allow the
        // close (the alternative is a window stuck open with no way to
        // shut it down except force-kill).
        this.quitApproved = true;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.close();
        }
      } finally {
        this._confirmInFlight = false;
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
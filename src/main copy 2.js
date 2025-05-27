const { app, BrowserWindow, ipcMain } = require('electron');
global.crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn, fork } = require('child_process');
const { nip19, nip04, getPublicKey, finishEvent } = require("nostr-tools")
const { getPrivateKey } = require('./store');
const log = require('electron-log');

// 配置日志
// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';


// 保持对窗口对象的全局引用，避免 JavaScript 对象被垃圾回收时窗口关闭
// Keep a global reference to the window object to prevent it from being garbage collected
let mainWindow;
let serverProcess = null;
let rgbNodeProcess = null;
let serverReady = false;
let allChildProcesses = []; // 跟踪所有子进程 // Track all child processes

// Nostr 
const nostrEnabled = true;
const sk = getPrivateKey();
const nostrPublicKey = getPublicKey(sk)
const npub = nip19.npubEncode(nostrPublicKey)
const LINK_HTTP_PORT = '8091'
log.info("Link owner:::", npub)


class PathManager {
  constructor() {
    this.isPackaged = app.isPackaged;
    this.appPath = app.getAppPath();
    
    
    if (this.isPackaged) {
      this.userDataPath = app.getPath('userData');
      this.resourcesPath = process.resourcesPath;
      this.binaryPath = path.join(process.resourcesPath, 'bin');
      this.nodeserverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'nodeserver');
    } else {
      this.userDataPath = path.join(__dirname, '..', 'data');
      this.resourcesPath = path.join(__dirname, '..', 'data');
      this.nodeserverPath = path.join(__dirname, '..', 'nodeserver');
      this.binaryPath = path.join(__dirname, '..', 'bin');
    }
    
    this.debugPaths();
  }

  getNodeServerPath() {
    return this.nodeserverPath;
  }

  getNodeServerAppJs() {
    return path.join(this.nodeserverPath, 'app.js');
  }

  getBinaryPath() {
    const platform = process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    return path.join(this.binaryPath, `${platform}-${arch}`);
  }

  getDataPath() {
    return this.userDataPath;
  }

  debugPaths() {
    log.info('=== PathManager Debug ===');
    log.info('isPackaged:', this.isPackaged);
    log.info('getNodeServerPath():', this.getNodeServerPath());
    log.info('getDataPath():', this.getDataPath());
    log.info('getBinaryPath():',this.getBinaryPath());
    log.info('nodeserver app.js exists:', fs.existsSync(this.getNodeServerAppJs()));
    // log.info('========================');
  }
}

const pathManager = new PathManager();


// Register a function to track all created child processes
function trackProcess(process) {
  if (process && process.pid) {
    allChildProcesses.push(process);
    log.info(`Tracking child process with PID: ${process.pid}`);
    

    // Remove from the list when the process ends
    process.on('close', () => {
      const index = allChildProcesses.findIndex(p => p.pid === process.pid);
      if (index !== -1) {
        allChildProcesses.splice(index, 1);
        log.info(`Process with PID ${process.pid} has been removed from tracking`);
      }
    });
  }
}


// Force terminate all child processes
function killAllChildProcesses() {
  log.info(`Attempting to kill ${allChildProcesses.length} child processes`);
  

  // Copy the array as we might modify the original during iteration
  const processes = [...allChildProcesses];
  
  processes.forEach(process => {
    if (process && process.pid) {
      try {
        log.info(`Killing process with PID: ${process.pid}`);
        
        // 在 macOS 和 Linux 上，可以使用更强力的信号
        // On macOS and Linux, we can use stronger signals
        if (process.kill) {
          process.kill('SIGKILL');
          

          // Check if the process is still running
          setTimeout(() => {
            try {

              // Try to send signal 0 to check if process exists
              const killed = process.kill(0);
              log.info(`Process ${process.pid} kill check result: ${killed}`);
              
              if (!killed) {
                log.info(`Process ${process.pid} still running, trying harder kill methods`);
                
     
                // For stubborn processes, use system commands to force termination
                if (process.pid) {

                  // Find and terminate all related rgb-lightning-node processes
                  if (process.platform === 'darwin' || process.platform === 'linux') {
                    try {
                      const { execSync } = require('child_process');
                      execSync(`pkill -9 -f "rgb-lightning-node"`);
                      log.info('Killed rgb-lightning-node processes with pkill');
                    } catch (err) {
                      log.error('Error killing rgb-lightning-node processes:', err);
                    }
                  } else if (process.platform === 'win32') {
                    // On Windows, use taskkill
                    try {
                      const { execSync } = require('child_process');
                      execSync(`taskkill /F /IM rgb-lightning-node.exe`);
                      log.info('Killed rgb-lightning-node processes with taskkill');
                    } catch (err) {
                      log.error('Error killing rgb-lightning-node processes:', err);
                    }
                  }
                }
              }
            } catch (e) {
              log.info(`Process ${process.pid} seems to be already gone`);
            }
          }, 500);
        }
      } catch (e) {
        log.error(`Error killing process ${process.pid}:`, e);
      }
    }
  });
  

  // Clear the process list
  allChildProcesses = [];
}


// Start Express server
async function startExpressServer() {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env);

    env.ELECTRON_RUN = true;
    // data path
    env.LIT_NAME = "Lnfi-Node";
    env.LIT_DATA_PATH = path.join(pathManager.getDataPath());

    env.LIT_LOCAL_BASE_PATH = `${env.LIT_DATA_PATH}/${env.LIT_NAME}`;

    env.LIT_ENABLE_TOR = false;

    //port
    env.LND_RPC_PORT = '10009';
    env.LND_LISTEN_PORT = '9735';
    env.LND_REST_PORT = '8080';

    env.PORT = LINK_HTTP_PORT;
    env.LINK_HTTP_PORT = LINK_HTTP_PORT;
    env.BINARY_PATH = path.join(pathManager.getBinaryPath()); 

    env.LINK_OWNER = npub;

    //rgb
    env.RGB_LISTENING_PORT = '3001';
    env.RGB_LDK_PEER_LISTENING_PORT = '9735';
    env.RGB_NETWORK = 'regtest';

    const nodeserverPath = pathManager.getNodeServerPath();
    const appJsPath = pathManager.getNodeServerAppJs();
    
    log.info(`Nodeserver path: ${nodeserverPath}`);
    log.info(`App.js path: ${appJsPath}`);
    log.info(`Nodeserver exists: ${fs.existsSync(nodeserverPath)}`);
    log.info(`App.js exists: ${fs.existsSync(appJsPath)}`);

    if (!fs.existsSync(appJsPath)) {
      const errMsg = `Nodeserver app.js not found at: ${appJsPath}. Cannot start server.`;
      log.error(errMsg);
      reject(new Error(errMsg));
      return;
    }


    // Check if node_modules exists, if not, install dependencies first
    const nodeModulesPath = path.join(nodeserverPath, 'node_modules');
    if (!fs.existsSync(nodeModulesPath) || !fs.existsSync(path.join(nodeModulesPath, 'body-parser'))) {
      log.info('node_modules not found in nodeserver directory, installing dependencies...');
      

      // Use npm install to install dependencies
      const npmInstallProcess = spawn('npm', ['install'], {
        cwd: nodeserverPath,
        shell: true,
        env: env
      });
      
      npmInstallProcess.stdout.on('data', (data) => {
        log.info(`npm install stdout: ${data.toString().trim()}`);
      });
      
      npmInstallProcess.stderr.on('data', (data) => {
        log.error(`npm install stderr: ${data.toString().trim()}`);
      });
      
      return new Promise((resolveInstall, rejectInstall) => {
        npmInstallProcess.on('close', (code) => {
          if (code !== 0) {
            const errMsg = `npm install process exited with code ${code}`;
            log.error(errMsg);
            rejectInstall(new Error(errMsg));
            return;
          }
          
          log.info('Dependencies installed successfully');
          

          // Start server after dependencies are successfully installed
          startServerProcess(nodeserverPath, appJsPath, env, resolve, reject);
        });
        
        npmInstallProcess.on('error', (err) => {
          const errMsg = `Failed to start npm install: ${err.message}`;
          log.error(errMsg);
          rejectInstall(new Error(errMsg));
        });
      });
    } else {
      log.info('node_modules found, starting server directly');
      startServerProcess(nodeserverPath, appJsPath, env, resolve, reject);
    }
  });
}


// Encapsulate server process startup logic
function startServerProcess(nodeserverPath, appJsPath, env, resolve, reject) {
  try {
    // Use fork to start a Node.js process running app.js
    serverProcess = fork(appJsPath, [], {
      cwd: nodeserverPath,
      env: env,
      silent: true  // Capture stdout and stderr
    });


    // Track this process
    trackProcess(serverProcess);

    log.info(`Express server forked with PID: ${serverProcess.pid}`);
    

    // Listen to stdout
    serverProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      log.info(`Express server: ${message}`);
      

      // Check if server is ready to accept connections
      if (message.includes('Server started on port') || message.includes('listening on port')) {
        log.info('Express server is ready to accept connections');
        serverReady = true;
        resolve(true);
      }
    });
    

    // Listen to stderr
    serverProcess.stderr.on('data', (data) => {
      log.error(`Express server error: ${data.toString().trim()}`);
    });
    

    // Listen for process termination
    serverProcess.on('close', (code) => {
      log.warn(`Express server process exited with code ${code}`);
      serverProcess = null;
      serverReady = false;
      

      // If window exists, notify the renderer process that the server has closed
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.openDevTools();
        mainWindow.webContents.send('server-status', {
          status: 'stopped',
          message: `Server stopped with code ${code}`
        });
      }
      
      if (code !== 0) {
        reject(new Error(`Server process exited with code ${code}`));
      }
    });
    
    // Listen for error events
    serverProcess.on('error', (err) => {
      const errMsg = `Failed to start Express server: ${err.message}`;
      log.error(errMsg);
      reject(new Error(errMsg));
    });
    
    // Set timeout - if server isn't ready within a certain time, consider startup failed
    setTimeout(() => {
      if (!serverReady) {
        log.warn('Express server did not report ready status within timeout period');
        resolve(false);// Don't reject, let the app continue trying to load
      }
    }, 5000);
    
  } catch (error) {
    log.error(`Exception when starting Express server: ${error.message}`);
    reject(error);
  }
}

// 错误处理
process.on('uncaughtException', (err) => {
  // Send error to main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('uncaughtException', err.message);
  }
  log.error('Uncaught Exception:', err);
});

function getAppIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'lnfi.png');
  log.info(`App icon path: ${iconPath}`);
  if (fs.existsSync(iconPath)) {
    return iconPath;
  }
  
  log.warn('App icon not found at:', iconPath);
  return undefined;
}

async function createWindow() {
  try {
    // 创建浏览器窗口
    // Create browser window
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          preload: path.join(__dirname, 'preload.js'),
          webSecurity: false, 
          allowRunningInsecureContent: false,
          experimentalFeatures: false
      },
      icon: getAppIcon(),
      titleBarStyle: 'default',
      show: false, // 先不显示窗口，等加载完成后再显示 // Don't show window until it's ready
      title: 'Lightning Network Node', // 设置初始标题 // Set initial title
      backgroundColor: '#1e1e1e', // 设置背景色，避免白屏 // Set background color to avoid white screen
      // 确保在创建窗口时就设置好窗口内容的背景色
      // Ensure window content background color is set during creation
      webPreferences: {
        backgroundColor: '#1e1e1e',
        // 其他 webPreferences 保持不变
        // Keep other webPreferences unchanged
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: false, 
        allowRunningInsecureContent: false,
        experimentalFeatures: false
      }
    });

    // 设置超时，确保窗口在一定时间内显示
    // Set timeout to ensure window is displayed within a certain time
    const showTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        log.info('Force showing window after timeout');
        mainWindow.show();
      }
    }, 5000);

    // 先显示一个加载界面
    // First show a loading interface
    const loadingHTML = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Lightning Network Node</title>
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
            <h1>Lightning Network Node</h1>
            <p>Starting services, please wait...</p>
            <div class="loader"></div>
            <div class="status" id="status">Initializing...</div>
          </div>
          <script>
            // 简单的状态更新动画
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
            
            // 确保文档标题正确
            // Ensure document title is correct
            document.title = "Lightning Network Node";
          </script>
        </body>
      </html>
    `;
    
    // 使用 data URL 加载 HTML 内容，避免文件系统访问延迟
    // Use data URL to load HTML content, avoiding file system access delay
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHTML)}`);
    
    // 等待加载页面准备好后再显示窗口
    // Wait for the loading page to be ready before showing the window
    mainWindow.once('ready-to-show', () => {
      clearTimeout(showTimeout); // 清除强制显示的超时 // Clear force show timeout
      mainWindow.show();
      log.info('Loading screen is now visible');
    });
    
    // 确保在一定时间后显示窗口，即使 ready-to-show 事件没有触发
    // Ensure window is shown after a certain time, even if ready-to-show event doesn't fire
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        log.info('Showing window after secondary timeout');
        mainWindow.show();
      }
    }, 1000);
    
    // 在后台启动 Express 服务器
    // Start Express server in the background
    try {
      log.info('Starting Express server...');
      await startExpressServer();
      log.info('Express server started successfully');
      
      // 服务器启动成功后，加载实际的应用 URL
      // After server starts successfully, load the actual application URL
      const url = `http://127.0.0.1:${LINK_HTTP_PORT}`;
      log.info(`Loading application URL: ${url}`);
      
      // 添加页面加载事件处理
      // Add page loading event handling
      mainWindow.webContents.on('did-start-loading', () => {
        log.info('Application page started loading');
        // 保持标题不变
        // Keep title unchanged
        if (mainWindow) {
          mainWindow.setTitle('Lightning Network Node');
        }
      });
      
      mainWindow.webContents.on('did-finish-load', () => {
        log.info('Application page finished loading');
        
        // 设置正确的标题
        // Set correct title
        if (mainWindow) {
          mainWindow.setTitle('Lightning Network Node');
          
          // 确保页面内容可见
          // Ensure page content is visible
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus();
        }
      });
      
      // 加载应用页面
      // Load application page
      if (mainWindow) {
        await mainWindow.loadURL(url);
      }
      
    } catch (error) {
      log.error('Failed to start Express Server:', error);
      
      // 如果服务器启动失败，显示错误页面
      // If server fails to start, show error page
      const errorHTML = `
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Lightning Network Node - Error</title>
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
              <p>Unable to start Lightning Network Node server.</p>
              <div class="error-details">${error.message}</div>
              <p>Please check the log files for more information.</p>
              <button onclick="window.location.reload()">Retry</button>
            </div>
            <script>
              // 确保文档标题正确
              // Ensure document title is correct
              document.title = "Lightning Network Node - Error";
            </script>
          </body>
        </html>
      `;
      
      if (mainWindow) {
        await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHTML)}`);
      }
    }
    
    // 页面加载失败时的处理
    // Handle page load failure
    mainWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription) => {
      log.error(`Page failed to load: ${errorDescription} (${errorCode})`);
      
      // 如果页面加载失败，显示一个简单的错误页面
      // If page fails to load, show a simple error page
      if (errorCode !== -3 && mainWindow) { // -3 是取消加载，通常不是错误 // -3 is a load cancellation, not usually an error
        const connectionErrorHTML = `
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Lightning Network Node - Connection Error</title>
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
                <p>Unable to connect to Lightning Network Node server.</p>
                <p>Error: ${errorDescription}</p>
                <p>Please ensure the server is running and port ${LINK_HTTP_PORT} is accessible.</p>
                <button onclick="window.location.reload()">Retry</button>
              </div>
              <script>
                // 确保文档标题正确
                // Ensure document title is correct
                document.title = "Lightning Network Node - Connection Error";
              </script>
            </body>
          </html>
        `;
        
        try {
          await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(connectionErrorHTML)}`);
        } catch (error) {
          log.error(`Failed to load error page: ${error.message}`);
        }
      }
    });
    
    // 在开发模式下打开开发者工具
    // Open DevTools in development mode
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools();
      log.info('DevTools opened in development mode');
    }

    // 当窗口关闭时触发
    // Triggered when window is closed
    mainWindow.on('closed', function() {
      mainWindow = null;
    });
  } catch (error) {
    log.error(`Failed to create window: ${error.message}`);
    app.quit();
  }
}

// Create window when Electron initialization is complete
app.whenReady().then(createWindow).catch(err => {
  log.error('Failed to create window:', err);
});

// Quit the application when all windows are closed
app.on('window-all-closed', () => {
  // 关闭 Express 服务器
  // Close Express server
  if (serverProcess) {
    log.info('Closing Express server');
    try {
      serverProcess.kill();
    } catch (e) {
      log.error('Error killing Express server process:', e);
    }
    serverProcess = null;
  }

  if (rgbNodeProcess) {
    log.info('Closing RGB Node process');
    try {
      rgbNodeProcess.kill();
    } catch (e) {
      log.error('Error killing RGB Node process:', e);
    }
    rgbNodeProcess = null;
  }
  
  // Terminate all child processes
  killAllChildProcesses();
  
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function() {
  if (mainWindow === null) createWindow();
});


// Ensure server process is closed when the app exits
app.on('quit', () => {
  log.info('Application is quitting');
  
  if (serverProcess) {
    log.info('Killing Express server on app quit');
    try {
      serverProcess.kill('SIGKILL');
    } catch (e) {
      log.error('Error killing Express server on quit:', e);
    }
  }
  
  if (rgbNodeProcess) {
    log.info('Killing RGB Node process on app quit');
    try {
      rgbNodeProcess.kill();
    } catch (e) {
      log.error('Error killing RGB Node process on quit:', e);
    }
    rgbNodeProcess = null;
  }
  
  // 终止所有子进程
  // Terminate all child processes
  killAllChildProcesses();
});


// Add before-quit event handler to ensure enough time for resource cleanup before app exit
app.on('before-quit', () => {
  log.info('Application is about to quit');
  
  // 终止所有子进程
  // Terminate all child processes
  killAllChildProcesses();
});

// Nostr IPC handlers
ipcMain.handle('nostr-get-public-key', async () => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
      return nostrPublicKey;  
      
  } catch (error) {
      throw new Error(`Failed to get public key: ${error.message}`);
  }
});

ipcMain.handle('nostr-get-npub', async () => {
  let npub = await nip19.npubEncode(nostrPublicKey);
  console.log(`Nostr NPub: ${npub}`);
  return npub;
});

ipcMain.handle('nostr-sign-event', async (event, eventData) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
      console.log("🚀 ~ ipcMain.handle ~ eventData:", sk)
      let signedEvent = await finishEvent(eventData, sk)
      return signedEvent;
  } catch (error) {
      throw new Error(`Failed to sign event: ${error.message}`);
  }
});

ipcMain.handle('nostr-get-relays', async () => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
      // 默认中继列表
      return {
          'wss://relay01.lnfi.network': { read: true, write: true },
          'wss://relay02.lnfi.network': { read: true, write: true },
          'wss://nostr-01.yakihonne.com': { read: true, write: true },
          'wss://nostr-02.yakihonne.com': { read: true, write: true },
      };
  } catch (error) {
      throw new Error(`Failed to get relays: ${error.message}`);
  }
});

ipcMain.handle('nostr-nip04-encrypt', async (event, pubkey, plaintext) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
    
      return nip04.encrypt(sk, pubkey, plaintext);
      
  } catch (error) {
      throw new Error(`Failed to encrypt: ${error.message}`);
  }
});

ipcMain.handle('nostr-nip04-decrypt', async (event, pubkey, ciphertext) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }

      return nip04.decrypt(sk, pubkey, ciphertext);
      
  } catch (error) {
      throw new Error(`Failed to decrypt: ${error.message}`);
  }
});

ipcMain.handle('nostr-nip44-encrypt', async (event, pubkey, plaintext) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
      
      return nip44.encrypt(sk, pubkey, plaintext)

  } catch (error) {
      throw new Error(`Failed to encrypt with NIP-44: ${error.message}`);
  }
});

ipcMain.handle('nostr-nip44-decrypt', async (event, pubkey, ciphertext) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
      return nip44.decrypt(sk, pubkey, ciphertext)
  } catch (error) {
      throw new Error(`Failed to decrypt with NIP-44: ${error.message}`);
  }
});

ipcMain.handle('nostr-enable', async () => {
  try {
      return true;
  } catch (error) {
      throw new Error(`Failed to enable Nostr: ${error.message}`);
  }
});

ipcMain.handle('nostr-is-enabled', async () => {
  return nostrEnabled;
});
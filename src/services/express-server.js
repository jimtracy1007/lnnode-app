const { fork, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');
const processManager = require('./process-manager');
const nostrService = require('./nostr-service');

class ExpressServer {
  constructor() {
    this.serverProcess = null;
    this.serverReady = false;
    this.port = '8091';
    this.litdTracked = false;
    this.rgbTracked = false;
  }

  getPort() {
    return this.port;
  }

  // Check for and track processes by name (more specific search)
  checkAndTrackProcess(processName, trackFunction, trackFlag) {
    if (trackFlag) {
      log.info(`${processName} already tracked, skipping`);
      return;
    }

    const { exec } = require('child_process');
    let searchPattern;
    
    // Use more specific patterns to avoid matching too many processes
    if (processName === 'litd') {
      searchPattern = 'pgrep -f "^.*litd --disableui"';
    } else if (processName === 'rgb-lightning-node') {
      searchPattern = 'pgrep -f "rgb-lightning-node.*--daemon-listening-port"';
    } else {
      searchPattern = `pgrep -f "${processName}"`;
    }

    exec(searchPattern, (err, stdout) => {
      if (!err && stdout.trim()) {
        const pids = stdout.trim().split('\n');
        // Only track the first (main) process
        const mainPid = parseInt(pids[0]);
        if (mainPid) {
          log.info(`Found main ${processName} process with PID: ${mainPid}`);
          
          // Create a mock process object to track the external process
          const mockProcess = {
            pid: mainPid,
            kill: (signal) => {
              try {
                process.kill(mainPid, signal);
                return true;
              } catch (e) {
                log.error(`Error killing ${processName} process: ${e.message}`);
                return false;
              }
            },
            on: (event, callback) => {
              // This is a simplified mock, as we can't actually attach to the real process events
              if (event === 'close') {
                // We'll handle this in the process manager's cleanup
              }
            }
          };
          
          // Register with process manager
          trackFunction(mockProcess);
          
          // Mark as tracked
          if (processName === 'litd') {
            this.litdTracked = true;
          } else if (processName === 'rgb-lightning-node') {
            this.rgbTracked = true;
          }
        }
      }
    });
  }

  // Start Express server
  async start() {
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

      env.PORT = this.port;
      env.LINK_HTTP_PORT = this.port;
      env.BINARY_PATH = path.join(pathManager.getBinaryPath()); 

      // Set LINK_OWNER to the Nostr npub
      env.LINK_OWNER = nostrService.getNpub();

      //rgb
      env.RGB_LISTENING_PORT = '3001';
      env.RGB_LDK_PEER_LISTENING_PORT = '9735';
      env.RGB_NETWORK = 'regtest';

      // 设置 NODE_PATH 来包含 nodeserver 的 node_modules
      const nodeModulesPath = pathManager.getNodeServerNodeModulesPath();
      if (env.NODE_PATH) {
        env.NODE_PATH = `${nodeModulesPath}${path.delimiter}${env.NODE_PATH}`;
      } else {
        env.NODE_PATH = nodeModulesPath;
      }

      const nodeserverPath = pathManager.getNodeServerPath();
      const appJsPath = pathManager.getNodeServerAppJs();
      
      log.info(`Nodeserver path: ${nodeserverPath}`);
      log.info(`App.js path: ${appJsPath}`);
      log.info(`Node modules path: ${nodeModulesPath}`);
      log.info(`Nodeserver exists: ${fs.existsSync(nodeserverPath)}`);
      log.info(`App.js exists: ${fs.existsSync(appJsPath)}`);
      log.info(`Node modules exists: ${fs.existsSync(nodeModulesPath)}`);

      if (!fs.existsSync(appJsPath)) {
        const errMsg = `Nodeserver app.js not found at: ${appJsPath}. Cannot start server.`;
        log.error(errMsg);
        reject(new Error(errMsg));
        return;
      }

      // Start the server process directly
      this._startServerProcess(nodeserverPath, appJsPath, env, resolve, reject);
    });
  }

  // Encapsulate server process startup logic
  _startServerProcess(nodeserverPath, appJsPath, env, resolve, reject) {
    try {
      // Use fork to start a Node.js process running app.js
      this.serverProcess = fork(appJsPath, [], {
        cwd: nodeserverPath,
        env: env,
        silent: true // Capture stdout and stderr
      });

      // Track this process
      processManager.trackProcess(this.serverProcess);

      log.info(`Express server forked with PID: ${this.serverProcess.pid}`);
      
      // Listen to stdout
      this.serverProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        log.info(`Express server: ${message}`);
        
        // Check if server is ready to accept connections
        if (message.includes('Server started on port') || message.includes('listening on port')) {
          log.info('Express server is ready to accept connections');
          this.serverReady = true;
          resolve(true);
        }
        
        // Monitor for litd process start (only once)
        if ((message.includes('starting litd') || message.includes('[litd]')) && !this.litdTracked) {
          log.info('Detected litd process starting');
          setTimeout(() => {
            this.checkAndTrackProcess('litd', (process) => processManager.setLitdProcess(process), this.litdTracked);
          }, 2000); // Give it more time to start
        }
        
        // Monitor for RGB node process start (only once)
        if ((message.includes('starting rgb') || message.includes('[rgb]') || message.includes('rgb-lightning-node')) && !this.rgbTracked) {
          log.info('Detected RGB node process starting');
          setTimeout(() => {
            this.checkAndTrackProcess('rgb-lightning-node', (process) => processManager.setRgbNodeProcess(process), this.rgbTracked);
          }, 2000); // Give it more time to start
        }
      });
      
      // Listen to stderr
      this.serverProcess.stderr.on('data', (data) => {
        log.error(`Express server error: ${data.toString().trim()}`);
      });
      
      // Listen for process termination
      this.serverProcess.on('close', (code) => {
        log.warn(`Express server process exited with code ${code}`);
        this.serverProcess = null;
        this.serverReady = false;
        
        if (code !== 0) {
          reject(new Error(`Server process exited with code ${code}`));
        }
      });
      
      // Listen for error events
      this.serverProcess.on('error', (err) => {
        const errMsg = `Failed to start Express server: ${err.message}`;
        log.error(errMsg);
        reject(new Error(errMsg));
      });
      
      // Set timeout - if server isn't ready within a certain time, consider startup failed
      setTimeout(() => {
        if (!this.serverReady) {
          log.warn('Express server did not report ready status within timeout period');
          resolve(false); // Don't reject, let the app continue trying to load
        }
      }, 5000); // 5 second timeout
      
    } catch (error) {
      log.error(`Exception when starting Express server: ${error.message}`);
      reject(error);
    }
  }

  // Stop the server
  stop() {
    if (this.serverProcess) {
      log.info('Stopping Express server');
      try {
        this.serverProcess.kill('SIGKILL');
      } catch (e) {
        log.error('Error killing Express server process:', e);
      }
      this.serverProcess = null;
      this.serverReady = false;
    }
    
    // Reset tracking flags
    this.litdTracked = false;
    this.rgbTracked = false;
  }

  // Check if server is running
  isRunning() {
    return this.serverProcess !== null && this.serverReady;
  }
}

module.exports = new ExpressServer(); 
const { fork, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');
const processManager = require('./process-manager');
const nostrService = require('./nostr-service');
const { exec } = require('node:child_process');
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

  // Check if a port is available
 async isPortAvailable(port) {
    return new Promise((resolve) => {
      exec(`lsof -i :${port}`, (_error, stdout) => {
        if (stdout && stdout.trim()) {
          return resolve(false)
        }
        const server = net.createServer()
  
        server.on("error", (_err) => {
          resolve(false)
        })
  
        server.listen(port, "0.0.0.0", () => {
          server.close(() => {
            resolve(true)
          })
        })
      })
    })
  }

  // Find next available port based on port range rules
  async findAvailablePort(basePort) {
    const portRanges = {
      8091: [8091, 8092, 8093, 8094, 8095, 8096], // LINK_HTTP_PORT: 8091 -> 8092...
    };

    // If port has specific range rules
    if (portRanges[basePort]) {
      for (const port of portRanges[basePort]) {
        if (await this.isPortAvailable(port)) {
          return port;
        }
      }
      // If all predefined ports are taken, continue with +1 increment
      let port = portRanges[basePort][portRanges[basePort].length - 1] + 1;
      while (port < 65535) {
        if (await this.isPortAvailable(port)) {
          return port;
        }
        port++;
      }
    } else {
      // For other ports, just increment by 1
      let port = basePort;
      while (port < 65535) {
        if (await this.isPortAvailable(port)) {
          return port;
        }
        port++;
      }
    }

    throw new Error(`No available port found starting from ${basePort}`);
  }

  // Check for and track processes by name (more specific search)
  checkAndTrackProcess(processName, trackFunction) {
    // Double check if already tracked (safety measure)
    if (processName === 'litd' && this.litdTracked) {
      log.debug(`${processName} already tracked, skipping check`);
      return;
    }
    if (processName === 'rgb-lightning-node' && this.rgbTracked) {
      log.debug(`${processName} already tracked, skipping check`);
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

    log.debug(`Searching for ${processName} process...`);
    exec(searchPattern, (err, stdout) => {
      if (!err && stdout.trim()) {
        const pids = stdout.trim().split('\n');
        // Only track the first (main) process
        const mainPid = parseInt(pids[0]);
        if (mainPid) {
          log.info(`Found ${processName} process with PID: ${mainPid}`);
          
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
          log.info(`${processName} process successfully tracked and registered`);
        }
      } else {
        log.warn(`No ${processName} process found - it may not have started yet`);
        // Reset the tracking flag if process not found so we can retry later
        if (processName === 'litd') {
          this.litdTracked = false;
        } else if (processName === 'rgb-lightning-node') {
          this.rgbTracked = false;
        }
      }
    });
  }

  // Start Express server
  async start() {
    return new Promise(async (resolve, reject) => {
      try {
        // Find available port starting from 8091
        const basePort = parseInt(this.port);
        const availablePort = await this.findAvailablePort(basePort);
        this.port = availablePort.toString();
        
        log.info(`Using port ${this.port} for Express server`);

        const env = Object.assign({}, process.env);

        env.ELECTRON_RUN = true;
        env.LINK_NAME = "Lnfi-Node";
        env.LINK_DATA_PATH = path.join(pathManager.getDataPath());
        env.ENABLE_TOR = false;
        env.BINARY_PATH = path.join(pathManager.getBinaryPath());
        env.LINK_OWNER = nostrService.getNpub(); 
        env.LINK_HTTP_PORT = this.port;
        // env.HTTPS_PROXY = "127.0.0.1:33210";
        // env.LINK_NETWORK = 'regtest';
        //port
        // env.LND_RPC_PORT = '10009';
        // env.LND_LISTEN_PORT = '9735';
        // env.LND_REST_PORT = '8080';

        // Set NODE_PATH to include nodeserver's node_modules
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
      } catch (error) {
        log.error(`Failed to find available port: ${error.message}`);
        reject(error);
      }
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
        
        // Monitor for litd process start - only trigger on specific startup messages
        if (!this.litdTracked && (
          message.includes('starting litd') || 
          message.includes('litd is ready') ||
          (message.includes('[litd]') && message.includes('LiT version:'))
        )) {
          log.info('Detected litd process starting');
          this.litdTracked = true; // Set flag immediately to prevent duplicate triggers
          setTimeout(() => {
            this.checkAndTrackProcess('litd', (process) => processManager.setLitdProcess(process));
          }, 2000); // Give it more time to start
        }
        
        // Monitor for RGB node process start - only trigger on specific startup messages
        if (!this.rgbTracked && (
          message.includes('starting rgb') || 
          message.includes('RGB node started') ||
          (message.includes('rgb-lightning-node') && message.includes('started'))
        )) {
          log.info('Detected RGB node process starting');
          this.rgbTracked = true; // Set flag immediately to prevent duplicate triggers
          setTimeout(() => {
            this.checkAndTrackProcess('rgb-lightning-node', (process) => processManager.setRgbNodeProcess(process));
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
      }, 5*1000); // 5 second timeout
      
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
const { fork, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');
const processManager = require('./process-manager');
const nostrService = require('./nostr-service');
const { exec } = require('node:child_process');

// Import LN-Link Electron wrapper
const LnLinkElectron = require('@lnfi-network/ln-link/electron');
class ExpressServer {
  constructor() {
    this.lnLink = null;
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
    try {
      // Find available port starting from 8091
      const basePort = parseInt(this.port);
      const availablePort = await this.findAvailablePort(basePort);
      this.port = availablePort.toString();

      log.info(`Using port ${this.port} for LN-Link server`);

      // Create LN-Link instance with configuration
      const config = {
        dataPath: pathManager.getDataPath(),
        network: process.env.LINK_NETWORK || 'regtest', // default to testnet
        httpPort: parseInt(this.port),
        name: 'LN-Link-App', // Application name
        enableTor: process.env.LINK_ENABLE_TOR === 'true' || false,
        owner: nostrService.getNpub(),
        binaryPath: pathManager.getBinaryPath(),
        debug: !process.env.NODE_ENV || process.env.NODE_ENV !== 'production'
      };

      log.info('Creating LN-Link instance with config:', config);

      this.lnLink = new LnLinkElectron(config);

      // Initialize LN-Link (sets up environment variables + database initialization)
      log.info('Initializing LN-Link...');
      await this.lnLink.initialize();

      // Start LN-Link service
      log.info('Starting LN-Link service...');
      await this.lnLink.start();

      this.serverReady = true;
      log.info('LN-Link server started successfully');

      return true;
    } catch (error) {
      log.error(`Failed to start LN-Link server: ${error.message}`);
      throw error;
    }
  }


  // Stop the server
  async stop() {
    if (this.lnLink) {
      log.info('Stopping LN-Link server');
      try {
        await this.lnLink.stop();
      } catch (e) {
        log.error('Error stopping LN-Link server:', e);
      }
      this.lnLink = null;
      this.serverReady = false;
    }

    // Reset tracking flags
    this.litdTracked = false;
    this.rgbTracked = false;
  }

  // Check if server is running
  isRunning() {
    return this.lnLink !== null && this.serverReady;
  }
}

module.exports = new ExpressServer();
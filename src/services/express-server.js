// const { fork, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');

const nostrService = require('./nostr-service');
const detectPort = require('detect-port');


const LnLinkElectron = require('ln-link');
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

  // Check if a port is available (cross-platform)
  async isPortAvailable(port) {
    const free = await detectPort(port);
    return free === port;
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

  // Check for and track processes by name (cross-platform)
  async checkAndTrackProcess(processName, trackFunction) {
    // Double check if already tracked (safety measure)
    if (processName === 'litd' && this.litdTracked) {
      log.debug(`${processName} already tracked, skipping check`);
      return;
    }
    if (processName === 'rgb-lightning-node' && this.rgbTracked) {
      log.debug(`${processName} already tracked, skipping check`);
      return;
    }

    log.debug(`Searching for ${processName} process...`);
    try {
      const { default: psList } = await import('ps-list');
      const list = await psList();
      const match = list.find((p) => {
        const cmd = `${p.name} ${p.cmd || ''}`;
        if (processName === 'litd') {
          return /\blitd\b/.test(cmd) && /--disableui/.test(cmd);
        }
        if (processName === 'rgb-lightning-node') {
          return /rgb-lightning-node/.test(cmd) && /--daemon-listening-port/.test(cmd);
        }
        return cmd.includes(processName);
      });

      if (match && match.pid) {
        const mainPid = match.pid;
        log.info(`Found ${processName} process with PID: ${mainPid}`);
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
          on: () => {}
        };
        trackFunction(mockProcess);
        log.info(`${processName} process successfully tracked and registered`);
      } else {
        log.warn(`No ${processName} process found - it may not have started yet`);
        if (processName === 'litd') this.litdTracked = false;
        if (processName === 'rgb-lightning-node') this.rgbTracked = false;
      }
    } catch (e) {
      log.error(`Failed to list processes: ${e.message}`);
    }
  }

  // Start Express server
  async start() {
    try {
      // Find available port starting from 8091
      const basePort = parseInt(this.port);
      const availablePort = await this.findAvailablePort(basePort);
      this.port = availablePort.toString();

      log.info(`Using port ${this.port} for LN-Link server`);

      // Plan A: ensure user database exists by copying from template at first run
      const dataPath = pathManager.getDataPath();
      const userDbDir = path.join(dataPath, 'link');
      const userDbPath = path.join(userDbDir, 'lnlink.db');
      const templateDbPath = path.join(pathManager.getAppDataPath(), 'link', 'lnlink.db');

      if (!fs.existsSync(userDbPath)) {
        try {
          if (!fs.existsSync(userDbDir)) {
            fs.mkdirSync(userDbDir, { recursive: true });
            log.info(`Created user DB directory: ${userDbDir}`);
          }
          if (fs.existsSync(templateDbPath)) {
            fs.copyFileSync(templateDbPath, userDbPath);
            log.info(`Copied template DB from ${templateDbPath} -> ${userDbPath}`);
          } else {
            log.warn(`Template DB not found at ${templateDbPath}. Prisma should have created it during prebuild.`);
          }
        } catch (e) {
          log.error(`Failed to prepare user DB: ${e.message}`);
        }
      } else {
        log.info(`Using existing user DB at: ${userDbPath}`);
      }

      // Ensure LINK_DATABASE_URL is set for ln-link initialization
      process.env.LINK_DATABASE_URL = `file:${userDbPath}`;
      log.info(`Set LINK_DATABASE_URL: ${process.env.LINK_DATABASE_URL}`);

      // Create LN-Link instance with configuration
      const config = {
        dataPath: dataPath,
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
// const { fork, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('../utils/logger');
const pathManager = require('../utils/path-manager');

const nostrService = require('./nostr-service');
const detectPort = require('detect-port');


const LnLinkElectron = require('lnlink-server');
class ExpressServer {
  constructor() {
    this.lnLink = null;
    this.serverReady = false;
    this.port = '8091';
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

  // Start Express server
  async start() {
    try {
      // Find available port starting from 8091
      const basePort = parseInt(this.port);
      const availablePort = await this.findAvailablePort(basePort);
      this.port = availablePort.toString();

      log.info(`Using port ${this.port} for lnlink-server`);

      // Plan A: ensure user database exists by copying from template at first run
      const dataPath = pathManager.getDataPath();
      const userDbDir = path.join(dataPath, '.link');
      const userDbPath = path.join(userDbDir, 'lnlink.db');
      const templateDbPath = path.join(pathManager.getAppDataPath(), '.link', 'lnlink.db');

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

      // Apply any pending Prisma migrations to the user DB. This handles upgrades
      // where the bundled schema has new tables/columns but the user's existing
      // sqlite file was created against an older schema. No-op on fresh installs.
      try {
        const dbMigrator = require('./db-migrator');
        await dbMigrator.runMigrateDeploy(userDbPath);
      } catch (e) {
        log.error(`DB migration step threw but continuing: ${e.message}`);
      }

      // Ensure LINK_DATABASE_URL is set for lnlink-server initialization
      process.env.LINK_DATABASE_URL = `file:${userDbPath}`;
      log.info(`Set LINK_DATABASE_URL: ${process.env.LINK_DATABASE_URL}`);


      // Create lnlink-server instance with configuration
      const config = {
        dataPath: dataPath,
        httpPort: parseInt(this.port),
        name: 'NodeFlow',
        owner: nostrService.getNpub(),
        binaryPath: pathManager.getBinaryPath(),
        debug: false,
        reportBaseUrl: 'https://devoffaucet.unift.xyz',
        reportAddress: 'npub1q7amuklx0fjw76dtulzzhhjmff8du5lyngw377d89hhrmj49w48ssltn7y',
        rgbLdkPeerListeningPort: 9750,
        rgbHost: 'localhost'
      };

      log.info('Creating lnlink-server instance with config:', config);

      this.lnLink = new LnLinkElectron(config);

      // Initialize lnlink-server (sets up environment variables + database initialization)
      log.info('Initializing lnlink-server...');
      await this.lnLink.initialize();

      // Start lnlink-server service
      log.info('Starting lnlink-server service...');
      const result = await this.lnLink.start();

      // Sync port: the backend's assignAvailablePorts() in getConfig may have
      // reassigned the port if the original was taken between our probe and bind.
      // Always use the actual listening port from the backend to avoid UI mismatch.
      if (result?.port && result.port.toString() !== this.port) {
        log.warn(`Port changed by backend: ${this.port} -> ${result.port} (syncing)`);
        this.port = result.port.toString();
      }

      this.serverReady = true;
      log.info(`lnlink-server started successfully on port ${this.port}`);

      return true;
    } catch (error) {
      log.error(`Failed to start lnlink-server: ${error.message}`);
      throw error;
    }
  }


  // Stop the server
  async stop() {
    if (this.lnLink) {
      log.info('Stopping lnlink-server');
      try {
        await this.lnLink.stop();
      } catch (e) {
        log.error('Error stopping lnlink-server:', e);
      }
      this.lnLink = null;
      this.serverReady = false;
    }

  }

  // Get PIDs of all managed child processes from lnlink-server
  getServicePids() {
    if (this.lnLink) {
      try {
        return this.lnLink.getServicePids();
      } catch (e) {
        log.error('Failed to get service PIDs:', e);
      }
    }
    return { litd: null, tor: null, rgb: null };
  }

  // Check if server is running
  isRunning() {
    return this.lnLink !== null && this.serverReady;
  }
}

module.exports = new ExpressServer();
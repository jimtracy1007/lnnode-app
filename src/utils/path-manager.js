const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('electron-log');

class PathManager {
  constructor() {
    this.isPackaged = app.isPackaged;
    this.appPath = app.getAppPath();

    if (this.isPackaged) {
      this.resourcesPath = process.resourcesPath;
      this.userDataPath = app.getPath('userData');

      const appDir = path.join(this.resourcesPath, 'app');
      const appAsarUnpacked = path.join(this.resourcesPath, 'app.asar.unpacked');

      // Determine binary root path (extraFiles are placed directly under Resources/bin)
      const packagedBinPath = path.join(this.resourcesPath, 'bin');
      const unpackedBinPath = path.join(appAsarUnpacked, 'bin');
      if (fs.existsSync(packagedBinPath)) {
        this.binaryRootPath = packagedBinPath;
      } else if (fs.existsSync(unpackedBinPath)) {
        this.binaryRootPath = unpackedBinPath;
      } else {
        this.binaryRootPath = packagedBinPath; // fallback
      }

      if (fs.existsSync(path.join(appDir, 'data'))) {
        this.appDataPath = path.join(appDir, 'data');
      } else if (fs.existsSync(path.join(appAsarUnpacked, 'data'))) {
        this.appDataPath = path.join(appAsarUnpacked, 'data');
      } else {
        this.appDataPath = path.join(this.appPath, 'data');
      }
    } else {
      this.userDataPath = path.join(__dirname, '..', '..', 'data');
      this.resourcesPath = path.join(__dirname, '..', '..', 'data');
      this.binaryRootPath = path.join(__dirname, '..', '..', 'bin');
    }

    this.debugPaths();
  }


  getDataPath() {
    return this.userDataPath;
  }

  getBinaryRootPath() {
    return this.binaryRootPath;
  }

  getBinaryDir() {
    const platform = os.platform();
    const arch = os.arch();
    
    // Map platform names
    let platformName = platform;
    if (platform === 'win32') {
      platformName = 'win32';
    } else if (platform === 'darwin') {
      platformName = 'darwin';
    } else if (platform === 'linux') {
      platformName = 'linux';
    }

    // Map architecture names
    let archName = arch;
    if (arch === 'x64') {
      archName = 'x64';
    } else if (arch === 'arm64') {
      archName = 'arm64';
    }

    return `${platformName}-${archName}`;
  }

  getBinaryPath() {
    // Full path to platform-specific bin directory: <root>/bin/<platform-arch>
    return path.join(this.binaryRootPath, this.getBinaryDir());
  }

  getAppDataPath() {
    return this.appDataPath || this.userDataPath;
  }

  getAppIcon() {
    const iconPath = path.join(this.appPath, 'assets', 'lnfi.png');
    log.info(`App icon path: ${iconPath}`);
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }

    log.warn('App icon not found at:', iconPath);
    return undefined;
  }

  debugPaths() {
    log.info('=== PathManager Debug ===');
    log.info('isPackaged:', this.isPackaged);
    log.info('getDataPath():', this.getDataPath());
    log.info('getBinaryRootPath():', this.getBinaryRootPath());
    log.info('getBinaryPath():', this.getBinaryPath());
  }
}

module.exports = new PathManager(); 
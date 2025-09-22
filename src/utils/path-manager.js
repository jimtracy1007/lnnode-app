const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('./logger');

class PathManager {
  constructor() {
    this.isPackaged = app.isPackaged;
    this.appPath = app.getAppPath();

    if (this.isPackaged) {
      this.userDataPath = app.getPath('userData');
      this.resourcesPath = process.resourcesPath;
      this.binaryPath = path.join(process.resourcesPath, 'bin');
    } else {
      this.userDataPath = path.join(__dirname, '..', '..', 'data');
      this.resourcesPath = path.join(__dirname, '..', '..', 'data');
      this.binaryPath = path.join(__dirname, '..', '..', 'bin');
    }

    this.debugPaths();
  }


  getBinaryPath() {
    const platform = process.platform;
    const arch = process.arch;

    let platformName;
    
    // Map platform names to match binary directory structure
    if (platform === 'win32') {
      platformName = 'win32';
    } else if (platform === 'darwin') {
      platformName = 'darwin';
    } else if (platform === 'linux') {
      platformName = 'linux';
    } else {
      log.warn(`Unsupported platform: ${platform}`);
      platformName = platform;
    }

    // Map architecture names
    let archName = arch;
    if (arch === 'x64') {
      archName = 'x64';
    } else if (arch === 'arm64') {
      archName = 'arm64';
    } else {
      log.warn(`Unsupported architecture: ${arch}`);
      archName = arch;
    }

    const binaryDir = `${platformName}-${archName}`;
    
    // Validate supported platform-architecture combinations
    const supportedCombinations = [
      'darwin-x64',
      'darwin-arm64', 
      'linux-x64',
      'win32-x64'
    ];
    
    if (!supportedCombinations.includes(binaryDir)) {
      log.warn(`Unsupported platform-architecture combination: ${binaryDir}. Supported: ${supportedCombinations.join(', ')}`);
    }
    
    const fullPath = path.join(this.binaryPath, binaryDir);

    log.info(`Binary path: platform=${platform}, arch=${arch}, mapped=${binaryDir}, full=${fullPath}`);

    return fullPath;
  }

  getDataPath() {
    return this.userDataPath;
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
    log.info('getBinaryPath():', this.getBinaryPath());
  }
}

module.exports = new PathManager(); 
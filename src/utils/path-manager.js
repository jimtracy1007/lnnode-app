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

    // Fix Windows platform path format: win32 -> win
    let platformName = platform;
    if (platform === 'win32') {
      platformName = 'win';
    } else if (platform === 'darwin') {
      platformName = 'darwin';
    } else if (platform === 'linux') {
      platformName = 'linux';
    }

    const binaryDir = `${platformName}-${arch}`;
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
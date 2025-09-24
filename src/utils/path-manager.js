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
      this.binaryRootPath = path.join(process.resourcesPath, 'bin');
      this.appDataPath = path.join(process.resourcesPath, 'app', 'data'); // 只读的应用数据
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
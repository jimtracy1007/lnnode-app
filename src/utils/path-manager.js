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
      this.nodeserverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'nodeserver');
      this.nodeserverNodeModulesPath = path.join(process.resourcesPath, 'nodeserver', 'node_modules');
    } else {
      this.userDataPath = path.join(__dirname, '..', '..', 'data');
      this.resourcesPath = path.join(__dirname, '..', '..', 'data');
      this.nodeserverPath = path.join(__dirname, '..', '..', 'nodeserver');
      this.nodeserverNodeModulesPath = path.join(__dirname, '..', '..', 'nodeserver', 'node_modules');
      this.binaryPath = path.join(__dirname, '..', '..', 'bin');
    }
    
    this.debugPaths();
  }

  getNodeServerPath() {
    return this.nodeserverPath;
  }

  getNodeServerAppJs() {
    return path.join(this.nodeserverPath, 'app.js');
  }

  getNodeServerNodeModulesPath() {
    return this.nodeserverNodeModulesPath;
  }

  getBinaryPath() {
    const platform = process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    return path.join(this.binaryPath, `${platform}-${arch}`);
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
    log.info('getNodeServerPath():', this.getNodeServerPath());
    log.info('getNodeServerNodeModulesPath():', this.getNodeServerNodeModulesPath());
    log.info('getDataPath():', this.getDataPath());
    log.info('getBinaryPath():',this.getBinaryPath());
    log.info('nodeserver app.js exists:', fs.existsSync(this.getNodeServerAppJs()));
    log.info('nodeserver node_modules exists:', fs.existsSync(this.getNodeServerNodeModulesPath()));
  }
}

module.exports = new PathManager(); 
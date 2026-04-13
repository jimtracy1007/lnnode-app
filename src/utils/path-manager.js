const { app } = require('electron');
const path = require('path');
const fs = require('fs');
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
    }

    this.debugPaths();
  }

  getDataPath() {
    return this.userDataPath;
  }

  getBinaryPath() {
    // Binaries are provided by @nodeflow-network/nodeflow-bin (via lnlink-server).
    // Returning "" means LINK_BINARY_PATH is not set, so lnlink-server's
    // binary-resolver falls through to nodeflow-bin's auto-resolution.
    return "";
  }

  /**
   * Returns the root directory of the platform-specific nodeflow-bin sub-package
   * (e.g. @nodeflow-network/bin-darwin-arm64). Used by main.js to identify
   * orphaned child processes from a previous crashed run by matching cmd paths.
   * Returns "" if the sub-package cannot be resolved — isOurBinary() guards it safely.
   *
   * INVARIANT: for require.resolve to work inside a packaged Electron asar, BOTH
   * @nodeflow-network/nodeflow-bin AND @nodeflow-network/bin-<platform>-<arch> must
   * be listed in asarUnpack (package.json). Narrowing asarUnpack to only the child
   * package will break module resolution from code inside the asar.
   *
   * NOTE: orphan adoption intentionally matches only binaries from the current
   * install path. A litd/rgb orphan from a different NodeFlow version at a different
   * install path will NOT be adopted — cross-version adoption would be unsafe (each
   * version expects its own IPC protocol and data-dir layout).
   */
  getNodeflowBinPackageRoot() {
    try {
      const subpkg = `@nodeflow-network/bin-${process.platform}-${process.arch}`;
      return path.dirname(require.resolve(`${subpkg}/package.json`));
    } catch (e) {
      log.warn(`[path-manager] nodeflow-bin sub-package not resolvable: ${e.message}`);
      return '';
    }
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
    log.info('getBinaryPath(): "" (delegated to @nodeflow-network/nodeflow-bin via lnlink-server)');
    log.info('getNodeflowBinPackageRoot():', this.getNodeflowBinPackageRoot());
  }
}

module.exports = new PathManager();

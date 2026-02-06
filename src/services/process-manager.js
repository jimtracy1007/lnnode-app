const log = require('../utils/logger');

class ProcessManager {
  constructor() {
    this.childProcesses = [];
    this.rgbNodeProcess = null;
    this.litdProcess = null;
    this.torProcess = null;
    this.isShuttingDown = false;
    this.trackedPids = new Set(); // Track PIDs to avoid duplicates
  }

  // Track a child process (prevent duplicates)
  trackProcess(process) {
    if (process && process.pid) {
      // Check if this PID is already being tracked
      if (this.trackedPids.has(process.pid)) {
        log.info(`Process with PID ${process.pid} is already being tracked`);
        return process;
      }

      this.childProcesses.push(process);
      this.trackedPids.add(process.pid);
      log.info(`Tracking child process with PID: ${process.pid}`);
      
      // Remove from the list when the process ends
      process.on('close', () => {
        const index = this.childProcesses.findIndex(p => p.pid === process.pid);
        if (index !== -1) {
          this.childProcesses.splice(index, 1);
          this.trackedPids.delete(process.pid);
          log.info(`Process with PID ${process.pid} has been removed from tracking`);
        }
      });

      process.on('error', () => {
        // Remove from tracking if process errors
        const index = this.childProcesses.findIndex(p => p.pid === process.pid);
        if (index !== -1) {
          this.childProcesses.splice(index, 1);
          this.trackedPids.delete(process.pid);
        }
      });
    }
    return process;
  }

  // Set RGB node process
  setRgbNodeProcess(process) {
    if (this.rgbNodeProcess && this.rgbNodeProcess.pid === process.pid) {
      log.info(`RGB node process with PID ${process.pid} is already set`);
      return process;
    }
    this.rgbNodeProcess = process;
    this.trackProcess(process);
    return process;
  }

  // Get RGB node process
  getRgbNodeProcess() {
    return this.rgbNodeProcess;
  }

  // Set litd process
  setLitdProcess(process) {
    if (this.litdProcess && this.litdProcess.pid === process.pid) {
      log.info(`Litd process with PID ${process.pid} is already set`);
      return process;
    }
    this.litdProcess = process;
    this.trackProcess(process);
    return process;
  }

  // Get litd process
  getLitdProcess() {
    return this.litdProcess;
  }

  // Set tor process
  setTorProcess(process) {
    if (this.torProcess && this.torProcess.pid === process.pid) {
      log.info(`Tor process with PID ${process.pid} is already set`);
      return process;
    }
    this.torProcess = process;
    this.trackProcess(process);
    return process;
  }

  // Get tor process
  getTorProcess() {
    return this.torProcess;
  }

  // Force kill process by name using system commands (last-resort fallback)
  forceKillProcessByName(processName) {
    log.info(`Force killing ${processName} process (last-resort)...`);
    try {
      const { execSync } = require('child_process');
      
      if (process.platform === 'darwin' || process.platform === 'linux') {
        execSync(`pkill -9 -x "${processName}" || true`);
        log.info(`Killed ${processName} process with pkill -9`);
      } else if (process.platform === 'win32') {
        execSync(`taskkill /F /IM ${processName}.exe /T 2>nul || exit 0`);
        log.info(`Killed ${processName} process with taskkill /F`);
      }
    } catch (e) {
      log.error(`Error force killing ${processName} process:`, e);
    }
  }

  // Check if process is alive
  isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Gracefully kill a named service process (SIGTERM first, then SIGKILL)
  killServiceProcess(name, processRef) {
    if (!processRef) {
      log.info(`${name} process not tracked, skipping`);
      return;
    }
    if (!this.isProcessAlive(processRef.pid)) {
      log.info(`${name} process (PID ${processRef.pid}) already dead`);
      return;
    }
    log.info(`Stopping ${name} process (PID ${processRef.pid}) with SIGTERM...`);
    try {
      processRef.kill('SIGTERM');
    } catch (e) {
      log.error(`Error sending SIGTERM to ${name} process:`, e);
    }
  }

  // Kill RGB node process
  killRgbNodeProcess() {
    this.killServiceProcess('RGB', this.rgbNodeProcess);
    this.rgbNodeProcess = null;
  }

  // Kill litd process
  killLitdProcess() {
    this.killServiceProcess('litd', this.litdProcess);
    this.litdProcess = null;
  }

  // Kill tor process
  killTorProcess() {
    this.killServiceProcess('Tor', this.torProcess);
    this.torProcess = null;
  }

  // Clean up dead processes from tracking
  cleanupDeadProcesses() {
    const aliveProcesses = this.childProcesses.filter(process => {
      if (process && process.pid && this.isProcessAlive(process.pid)) {
        return true;
      } else {
        // Remove dead process from tracking
        this.trackedPids.delete(process.pid);
        log.info(`Removed dead process ${process.pid} from tracking`);
        return false;
      }
    });
    
    this.childProcesses = aliveProcesses;
  }

  // Terminate all child processes (SIGTERM → wait → SIGKILL fallback)
  killAllProcesses() {
    if (this.isShuttingDown) {
      log.info('Already shutting down, skipping duplicate kill request');
      return;
    }
    
    this.isShuttingDown = true;
    
    // Clean up dead processes first
    this.cleanupDeadProcesses();
    
    log.info(`Attempting to stop ${this.childProcesses.length} child processes`);
    
    // Graceful SIGTERM phase (ln-link's lnLink.stop() should have handled this already)
    this.killRgbNodeProcess();
    this.killLitdProcess();
    this.killTorProcess();
    
    // SIGTERM remaining tracked processes
    const processes = [...this.childProcesses];
    processes.forEach(p => {
      if (p && p.pid && this.isProcessAlive(p.pid)) {
        try {
          log.info(`Sending SIGTERM to process PID: ${p.pid}`);
          p.kill('SIGTERM');
        } catch (e) {
          log.error(`Error sending SIGTERM to process ${p.pid}:`, e);
        }
      }
    });
    
    // Clear the process list and PID tracking
    this.childProcesses = [];
    this.trackedPids.clear();
    
    // Last-resort: force kill by name after a delay if any remain
    setTimeout(() => {
      this.forceKillProcessByName('rgb-lightning-node');
      this.forceKillProcessByName('litd');
      this.forceKillProcessByName('tor');
      this.isShuttingDown = false;
    }, 3000);
  }
}

module.exports = new ProcessManager(); 
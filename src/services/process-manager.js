const { spawn } = require('child_process');
const log = require('../utils/logger');

class ProcessManager {
  constructor() {
    this.childProcesses = [];
    this.rgbNodeProcess = null;
    this.litdProcess = null;
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

  // Force kill process by name using system commands
  forceKillProcessByName(processName) {
    if (this.isShuttingDown) {
      return; // Avoid duplicate kills during shutdown
    }
    
    log.info(`Force killing ${processName} process...`);
    try {
      const { execSync } = require('child_process');
      
      if (process.platform === 'darwin' || process.platform === 'linux') {
        execSync(`pkill -9 -f "${processName}" || true`);
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

  // Kill RGB node process
  killRgbNodeProcess() {
    if (this.rgbNodeProcess) {
      log.info('Closing RGB Node process');
      if (this.isProcessAlive(this.rgbNodeProcess.pid)) {
        try {
          this.rgbNodeProcess.kill('SIGKILL');
        } catch (e) {
          log.error('Error killing RGB Node process:', e);
        }
      } else {
        log.info('RGB Node process already dead');
      }
      this.rgbNodeProcess = null;
    }
    
    // Always try system-level kill for any remaining processes
    this.forceKillProcessByName('rgb-lightning-node');
  }

  // Kill litd process
  killLitdProcess() {
    if (this.litdProcess) {
      log.info('Closing litd process');
      if (this.isProcessAlive(this.litdProcess.pid)) {
        try {
          this.litdProcess.kill('SIGKILL');
        } catch (e) {
          log.error('Error killing litd process:', e);
        }
      } else {
        log.info('Litd process already dead');
      }
      this.litdProcess = null;
    }
    
    // Always try system-level kill for any remaining processes
    this.forceKillProcessByName('litd');
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

  // Force terminate all child processes
  killAllProcesses() {
    if (this.isShuttingDown) {
      log.info('Already shutting down, skipping duplicate kill request');
      return;
    }
    
    this.isShuttingDown = true;
    
    // Clean up dead processes first
    this.cleanupDeadProcesses();
    
    log.info(`Attempting to kill ${this.childProcesses.length} child processes`);
    
    // Kill RGB node process first
    this.killRgbNodeProcess();
    
    // Kill litd process
    this.killLitdProcess();
    
    // Kill remaining tracked processes
    const processes = [...this.childProcesses]; // Copy to avoid modification during iteration
    
    processes.forEach(process => {
      if (process && process.pid && this.isProcessAlive(process.pid)) {
        try {
          log.info(`Killing process with PID: ${process.pid}`);
          process.kill('SIGKILL');
        } catch (e) {
          log.error(`Error killing process ${process.pid}:`, e);
        }
      }
    });
    
    // Clear the process list and PID tracking
    this.childProcesses = [];
    this.trackedPids.clear();
    
    // Reset shutdown flag after a delay
    setTimeout(() => {
      this.isShuttingDown = false;
    }, 2000);
  }
}

module.exports = new ProcessManager(); 
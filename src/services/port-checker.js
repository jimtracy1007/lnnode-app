/**
 * Port pre-check for NodeFlow services.
 *
 * Probes each expected service port BEFORE expressServer.start() is called.
 * Uses detect-port (already a dependency) for availability checks, and
 * platform-native commands (lsof / netstat) to identify the occupying process
 * so the welcome page can surface "Port 9735 occupied by Tor Browser (PID 1234)"
 * instead of a cryptic crash message.
 *
 * All checks run in parallel; failures are non-fatal (a probe error just omits
 * the process name). ln-link's assignAvailablePorts() handles single-port
 * conflicts at startup time — these warnings are informational, not blockers.
 *
 * Docker note: this module only runs in the Electron app (called from
 * welcome-handlers.js). It does NOT touch ln-link's getConfig.js or any
 * Docker-facing configuration.
 */

const detectPort = require('detect-port');
const { execSync } = require('child_process');
const log = require('../utils/logger');

// Ports that NodeFlow expects to bind, in priority order.
// severity 'warning'  → ln-link will auto-reassign if blocked, but user should know
// severity 'info'     → tor is optional; occupied tor ports are soft advisory only
const PORTS = [
  { key: 'HTTP (lnlink-server)', port: 8091, severity: 'warning' },
  { key: 'LND RPC',              port: 10009, severity: 'warning' },
  { key: 'LND Peer',             port: 9735,  severity: 'warning' },
  { key: 'RGB API',              port: 3001,  severity: 'warning' },
  { key: 'RGB LDK Peer',         port: 9750,  severity: 'warning' },
  { key: 'Tor SOCKS',            port: 9050,  severity: 'info' },
  { key: 'Tor Control',          port: 9051,  severity: 'info' },
];

/**
 * Try to identify which process is listening on a port.
 * Returns { pid, name } or null if identification fails or is unsupported.
 *
 * Uses synchronous shell commands with tight timeouts so the probe
 * completes quickly. Non-fatal: any error returns null.
 */
function getOccupyingProcess(port) {
  try {
    const platform = process.platform;

    if (platform === 'darwin' || platform === 'linux') {
      // lsof -ti :PORT  → one PID per line (may be multiple for the same port)
      const pidRaw = execSync(`lsof -ti :${port} 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      if (!pidRaw) return null;
      // Take the first PID if multiple are returned.
      const pid = pidRaw.split('\n')[0].trim();
      if (!pid || isNaN(parseInt(pid, 10))) return null;
      // ps -p PID -o comm=  → just the process name, no header
      const name = execSync(`ps -p ${pid} -o comm= 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      return { pid: parseInt(pid, 10), name: name || 'unknown' };
    }

    if (platform === 'win32') {
      // netstat -ano lists listening ports with owning PID.
      const output = execSync(`netstat -ano 2>nul`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const match = output
        .split('\n')
        .find((l) => l.match(new RegExp(`[:\\s]${port}\\s`)) && l.includes('LISTENING'));
      if (!match) return null;
      const parts = match.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (isNaN(pid)) return null;
      // tasklist for process name
      const taskOutput = execSync(
        `tasklist /FI "PID eq ${pid}" /FO CSV /NH 2>nul`,
        { encoding: 'utf-8', timeout: 3000 },
      );
      const nameMatch = taskOutput.match(/"([^"]+)"/);
      return { pid, name: nameMatch ? nameMatch[1] : 'unknown' };
    }
  } catch {
    // Non-fatal — process identification is best-effort.
  }
  return null;
}

/**
 * Probe all service ports in parallel.
 *
 * @returns {Promise<{ok: true, conflicts: Array<{key, port, severity, pid, processName}>}>}
 */
async function checkPorts() {
  const results = await Promise.all(
    PORTS.map(async ({ key, port, severity }) => {
      try {
        const freePort = await detectPort(port);
        if (freePort === port) return null; // port is available
        // Port occupied — try to identify the owner.
        const proc = getOccupyingProcess(port);
        const entry = {
          key,
          port,
          severity,
          pid: proc ? proc.pid : null,
          processName: proc ? proc.name : null,
        };
        log.warn(
          `[port-checker] Port ${port} (${key}) occupied` +
            (proc ? ` by ${proc.name} (PID ${proc.pid})` : ' (process unknown)'),
        );
        return entry;
      } catch (e) {
        log.warn(`[port-checker] Failed to probe port ${port} (${key}): ${e.message}`);
        return null;
      }
    }),
  );

  const conflicts = results.filter(Boolean);
  log.info(`[port-checker] Checked ${PORTS.length} ports, ${conflicts.length} conflict(s)`);
  return { ok: true, conflicts };
}

module.exports = { checkPorts };

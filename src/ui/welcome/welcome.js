'use strict';

/**
 * Welcome page renderer.
 *
 * Runs inside the Electron BrowserWindow before any backend services
 * (rgb-lightning-node, litd, tor) are spawned. All work is delegated to
 * main via window.welcomeAPI (see src/preload.js and
 * src/ipc/welcome-handlers.js).
 */

const $ = (id) => document.getElementById(id);

/* --------------------------- ui helpers --------------------------- */

function setOverlay(text) {
  $('overlay-text').textContent = text || 'Working…';
  $('overlay').classList.remove('overlay-hidden');
}

function clearOverlay() {
  $('overlay').classList.add('overlay-hidden');
}

let toastTimer = null;
function toast(message, kind) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('toast-hidden', 'toast-success', 'toast-error');
  el.classList.add(kind === 'error' ? 'toast-error' : 'toast-success');
  // Next frame so the transition actually plays.
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  clearTimeout(toastTimer);
  const ttl = kind === 'error' ? 7000 : 4500;
  toastTimer = setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.classList.add('toast-hidden'), 220);
  }, ttl);
}

const ACTION_BTN_IDS = [
  'start-btn',
  'backup-btn',
  'clear-btn',
  'open-data-btn',
  'quit-btn',
];
function setAllButtonsDisabled(disabled) {
  ACTION_BTN_IDS.forEach((id) => {
    const btn = $(id);
    if (btn) btn.disabled = disabled;
  });
}

function showBanner(kind, html) {
  const el = $('status-banner');
  el.className = `banner ${kind}`;
  el.innerHTML = html;
  el.classList.remove('banner-hidden');
}

function hideBanner() {
  const el = $('status-banner');
  el.classList.add('banner-hidden');
  el.innerHTML = '';
}

/**
 * Render the rgb-version-checker result as a banner and adjust the
 * Start button accordingly. Call this any time the check state
 * changes (initial load, after a successful reset, after "Start
 * Anyway" acknowledgement).
 */
function renderVersionBanner(check) {
  const startBtn = $('start-btn');

  if (!check || check.state === 'ok' || check.state === 'fresh' || check.state === 'non-breaking') {
    hideBanner();
    startBtn.disabled = false;
    return;
  }

  if (check.state === 'breaking') {
    startBtn.disabled = true;
    showBanner(
      'warning',
      `
        <div class="banner-title">Incompatible Upgrade Detected</div>
        <div class="banner-body">
          rgb-lightning-node changed from
          <code>${escapeHtml(check.stored || 'unknown')}</code> to
          <code>${escapeHtml(check.expected)}</code>. This crosses a known
          breaking release (<code>${escapeHtml(check.crossed)}</code>).
          Starting the node against the existing LDK channel state will
          crash rgb-lightning-node or corrupt funds.
          <br><br>
          A timestamped backup of <code>.rgb/.ldk/</code> will be created
          before anything is deleted.
        </div>
        <div class="banner-actions">
          <button type="button" class="banner-btn banner-btn-primary" data-action="reset-ldk">
            Back Up &amp; Reset Channel State
          </button>
          <button type="button" class="banner-btn banner-btn-ghost" data-action="quit">
            Quit
          </button>
        </div>
      `,
    );
    return;
  }

  if (check.state === 'unknown') {
    // Start button stays enabled — user can choose to reset, continue, or quit.
    startBtn.disabled = false;
    showBanner(
      'warning',
      `
        <div class="banner-title">Unknown Upgrade Safety</div>
        <div class="banner-body">
          NodeFlow cannot determine whether this upgrade is safe for your
          existing LDK channel state
          (reason: <code>${escapeHtml(check.reason || 'unknown')}</code>).
          You can back up and reset LDK to be safe, continue at your own
          risk, or quit.
        </div>
        <div class="banner-actions">
          <button type="button" class="banner-btn banner-btn-primary" data-action="reset-ldk">
            Back Up &amp; Reset Channel State
          </button>
          <button type="button" class="banner-btn banner-btn-ghost" data-action="acknowledge">
            Start Anyway
          </button>
          <button type="button" class="banner-btn banner-btn-ghost" data-action="quit">
            Quit
          </button>
        </div>
      `,
    );
    return;
  }

  if (check.state === 'expected-unknown') {
    startBtn.disabled = false;
    showBanner(
      'info',
      `
        <div class="banner-title">Version Check Degraded</div>
        <div class="banner-body">
          Could not determine the bundled rgb-lightning-node version
          (PROVENANCE.json read failed). Continuing is allowed but the
          upgrade-safety check is effectively off — take extra care
          before starting if you just updated NodeFlow.
        </div>
      `,
    );
    return;
  }

  // Unrecognised state — show raw for debugging.
  startBtn.disabled = false;
  showBanner(
    'warning',
    `<div class="banner-title">Unknown check state</div>
     <div class="banner-body"><code>${escapeHtml(JSON.stringify(check))}</code></div>`,
  );
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/* --------------------------- port check --------------------------- */

/**
 * Probe all expected service ports and render a compact warning section
 * if any are occupied. Runs in parallel with loadInfo() / refreshVersionCheck()
 * and never blocks the Start button — ln-link's assignAvailablePorts() handles
 * single-port conflicts at startup. This just surfaces them early so users
 * aren't surprised by a cryptic crash.
 */
async function refreshPortCheck() {
  const section = $('port-check-section');
  if (!section) return;

  let result;
  try {
    result = await window.welcomeAPI.portCheck();
  } catch (e) {
    // Non-fatal — silently skip if IPC fails.
    return;
  }

  if (!result || !result.ok || !result.conflicts || result.conflicts.length === 0) {
    section.className = 'port-check-hidden';
    section.innerHTML = '';
    return;
  }

  const warnings = result.conflicts.filter((c) => c.severity === 'warning');
  const infos    = result.conflicts.filter((c) => c.severity === 'info');

  const rows = result.conflicts.map((c) => {
    const procLabel = c.processName
      ? `${escapeHtml(c.processName)}${c.pid ? ` (PID ${c.pid})` : ''}`
      : 'process unknown';
    return `
      <li class="port-conflict-item severity-${escapeHtml(c.severity)}">
        <span class="port-conflict-left">
          <span class="port-conflict-key">${escapeHtml(c.key)}</span>
          <span class="port-conflict-proc">${procLabel}</span>
        </span>
        <span class="port-conflict-port">:${c.port}</span>
      </li>`;
  }).join('');

  const titleCount = result.conflicts.length === 1
    ? '1 port conflict'
    : `${result.conflicts.length} port conflicts`;

  // Only show the auto-reassign note for warning-level conflicts (tor ports
  // don't get reassigned automatically — they're just skipped if tor disabled).
  const noteText = warnings.length > 0
    ? 'NodeFlow will attempt to auto-reassign conflicting ports at startup. ' +
      'If another Lightning node is running on these ports, consider stopping it first.'
    : 'These are Tor ports. If Tor is disabled in settings, these conflicts have no effect.';

  section.innerHTML = `
    <div class="port-check">
      <div class="port-check-title">
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
          <path fill="#ffad33" d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 12a1 1 0 110-2 1 1 0 010 2zm1-4H9V6h2v4z"/>
        </svg>
        ${titleCount} detected
      </div>
      <p class="port-check-note">${noteText}</p>
      <ul class="port-conflict-list">${rows}</ul>
    </div>`;
  section.className = '';
}

/* --------------------------- info loading --------------------------- */

async function loadInfo() {
  try {
    const info = await window.welcomeAPI.getInfo();
    if (!info || !info.ok) {
      showBanner(
        'warning',
        `Failed to load version info: ${info && info.error ? info.error : 'unknown error'}`,
      );
      return;
    }
    $('v-app').textContent = info.appVersion || '—';
    $('v-rgb').textContent = info.rgb || '—';
    $('v-litd').textContent = info.litd || '—';
    $('data-dir').textContent = info.dataDir || '—';
    $('log-dir').textContent = info.logDir || '—';
    $('lnlink-log-dir').textContent = info.lnlinkLogDir || '—';
  } catch (e) {
    showBanner('warning', `Failed to load info: ${e.message}`);
  }
}

async function refreshVersionCheck() {
  try {
    const check = await window.welcomeAPI.versionCheck();
    if (!check || !check.ok) {
      showBanner(
        'warning',
        `Version check failed: ${check && check.error ? check.error : 'unknown error'}`,
      );
      return;
    }
    renderVersionBanner(check);
  } catch (e) {
    showBanner('warning', `Version check failed: ${e.message}`);
  }
}

async function handleResetLdk() {
  const confirm = await window.welcomeAPI.confirm({
    title: 'Reset Lightning Channel State',
    message: 'Back up and reset .rgb/.ldk/ now?',
    detail:
      'A timestamped backup will be created first under backups/. ' +
      'After that, the .ldk/ subtree (LDK channel monitors and ' +
      'Lightning channel state) will be deleted. Wallet mnemonic, ' +
      'RGB assets and BDK on-chain state are preserved.\n\n' +
      'This is the safest way to recover from an incompatible ' +
      'rgb-lightning-node upgrade. The backup lets you restore ' +
      'channel state later if needed.',
    destructive: true,
  });
  if (!confirm || !confirm.confirmed) return;

  setAllButtonsDisabled(true);
  setOverlay('Backing up, then resetting channel state…');
  try {
    const result = await window.welcomeAPI.resetLdk();
    clearOverlay();
    setAllButtonsDisabled(false);
    if (result && result.ok) {
      const msg = result.backupDir
        ? `LDK reset complete. Backup at ${result.backupDir}`
        : 'LDK reset complete (no channel data was present).';
      toast(msg, 'success');
      // Clear the banner and re-enable Start now that state is ok.
      await refreshVersionCheck();
    } else {
      const suffix = result && result.backupDir
        ? ` (backup at ${result.backupDir})`
        : '';
      toast(
        `Reset failed: ${result && result.error ? result.error : 'unknown error'}${suffix}`,
        'error',
      );
    }
  } catch (e) {
    clearOverlay();
    setAllButtonsDisabled(false);
    toast(`Reset failed: ${e.message}`, 'error');
  }
}

async function handleAcknowledgeVersion() {
  const confirm = await window.welcomeAPI.confirm({
    title: 'Start Without Reset',
    message: 'Start the node against existing channel state anyway?',
    detail:
      'NodeFlow cannot confirm this upgrade is safe. If the on-disk ' +
      'format actually changed, the node may hang, crash, or corrupt ' +
      'state backing real funds. Only continue if you have manually ' +
      'verified this upgrade or have your own backup.',
    destructive: true,
  });
  if (!confirm || !confirm.confirmed) return;

  try {
    const result = await window.welcomeAPI.acknowledgeVersion();
    if (result && result.ok) {
      toast('Version mismatch acknowledged. You may now click Start.', 'success');
      await refreshVersionCheck();
    } else {
      toast(
        `Acknowledge failed: ${result && result.error ? result.error : 'unknown error'}`,
        'error',
      );
    }
  } catch (e) {
    toast(`Acknowledge failed: ${e.message}`, 'error');
  }
}

// Delegated click handler for banner action buttons.
function handleBannerClick(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  switch (action) {
    case 'reset-ldk':
      handleResetLdk();
      break;
    case 'acknowledge':
      handleAcknowledgeVersion();
      break;
    case 'backup':
      // Re-used by the migration-failure banner. Runs the same full
      // backup flow as the main "Backup Data Now" button.
      handleBackup();
      break;
    case 'open-data':
      // Re-used by the migration-failure banner.
      handleOpenDataDir();
      break;
    case 'quit':
      handleQuit();
      break;
  }
}

/* --------------------------- actions --------------------------- */

async function handleStart() {
  setAllButtonsDisabled(true);
  setOverlay('Starting node services…');
  try {
    const result = await window.welcomeAPI.startServices();
    // On success main navigates this BrowserWindow to the local express
    // URL, tearing down this renderer — so the block below rarely runs.
    if (!result || !result.ok) {
      clearOverlay();
      setAllButtonsDisabled(false);
      if (result && result.classification === 'migration') {
        // Database migration failed — surface a dedicated, persistent
        // banner with recovery actions. Start stays disabled until the
        // user addresses the problem (usually by backing up and
        // relaunching after restoring a known-good DB).
        renderMigrationFailureBanner(result);
        return;
      }
      toast(
        `Failed to start: ${result && result.error ? result.error : 'unknown error'}`,
        'error',
      );
    }
  } catch (e) {
    clearOverlay();
    setAllButtonsDisabled(false);
    toast(`Failed to start: ${e.message}`, 'error');
  }
}

/**
 * Render the "Database Migration Failed" state as a persistent red
 * banner with recovery actions. Start is disabled: we cannot safely
 * boot lnlink-server against a half-migrated schema, so the only
 * moves available are Back Up Data / Open Data Folder / Quit.
 */
function renderMigrationFailureBanner(result) {
  $('start-btn').disabled = true;
  const failedLine = result.failedMigration
    ? ` (failed at <code>${escapeHtml(result.failedMigration)}</code>)`
    : '';
  const dbPath = result.dbPath
    ? `<br><strong>Database:</strong> <code>${escapeHtml(result.dbPath)}</code>`
    : '';
  showBanner(
    'warning',
    `
      <div class="banner-title">Database Migration Failed</div>
      <div class="banner-body">
        NodeFlow could not apply a required schema change to the user
        database${failedLine}. Starting the node against a half-migrated
        schema would risk corrupting wallet records, so startup has
        been aborted.
        <br><br>
        <strong>Error:</strong> <code>${escapeHtml(result.error || 'unknown error')}</code>
        ${dbPath}
        <br><br>
        Back up your data now and report this error. To retry, quit
        and relaunch NodeFlow after addressing the underlying issue
        (e.g. free disk space, restore a known-good database).
      </div>
      <div class="banner-actions">
        <button type="button" class="banner-btn banner-btn-primary" data-action="backup">
          Back Up Data Now
        </button>
        <button type="button" class="banner-btn banner-btn-ghost" data-action="open-data">
          Open Data Folder
        </button>
        <button type="button" class="banner-btn banner-btn-ghost" data-action="quit">
          Quit
        </button>
      </div>
    `,
  );
}

async function handleBackup() {
  const confirm = await window.welcomeAPI.confirm({
    title: 'Backup Node Data',
    message: 'Create a full backup of NodeFlow data now?',
    detail:
      'Copies everything under the data directory (wallet state, ' +
      'Lightning channels, RGB assets, user database) into a timestamped ' +
      'folder under backups/. No services are running yet, so the ' +
      'backup is guaranteed consistent.',
    destructive: false,
  });
  if (!confirm || !confirm.confirmed) return;

  setAllButtonsDisabled(true);
  setOverlay('Creating backup…');
  try {
    const result = await window.welcomeAPI.backupNow();
    clearOverlay();
    setAllButtonsDisabled(false);
    if (result && result.ok) {
      toast(`Backup saved at ${result.backupDir}`, 'success');
    } else {
      toast(
        `Backup failed: ${result && result.error ? result.error : 'unknown error'}`,
        'error',
      );
    }
  } catch (e) {
    clearOverlay();
    setAllButtonsDisabled(false);
    toast(`Backup failed: ${e.message}`, 'error');
  }
}

async function handleClear() {
  const confirm = await window.welcomeAPI.confirm({
    title: 'Clear All Data',
    message: 'This will permanently delete all node data.',
    detail:
      'A timestamped backup will be created first under backups/. After ' +
      'clearing, the wallet mnemonic, Lightning channels, RGB assets, ' +
      'BDK on-chain state and the user database are all removed. This ' +
      'action is irreversible without restoring from the backup.',
    destructive: true,
  });
  if (!confirm || !confirm.confirmed) return;

  setAllButtonsDisabled(true);
  setOverlay('Backing up, then clearing data…');
  try {
    const result = await window.welcomeAPI.clearAllData();
    clearOverlay();
    setAllButtonsDisabled(false);
    if (result && result.ok) {
      toast(
        `Data cleared. Backup saved at ${result.backupDir}`,
        'success',
      );
      // Refresh the info card so version numbers stay correct (the
      // data dir entries changed, but bundled versions did not).
      loadInfo();
    } else {
      const suffix = result && result.backupDir
        ? ` (backup at ${result.backupDir})`
        : '';
      toast(
        `Clear failed: ${result && result.error ? result.error : 'unknown error'}${suffix}`,
        'error',
      );
    }
  } catch (e) {
    clearOverlay();
    setAllButtonsDisabled(false);
    toast(`Clear failed: ${e.message}`, 'error');
  }
}

async function handleOpenDataDir() {
  try {
    const result = await window.welcomeAPI.openDataDir();
    if (!result || !result.ok) {
      toast(
        `Failed to open: ${result && result.error ? result.error : 'unknown error'}`,
        'error',
      );
      return;
    }
    // Data dir is full of dot-directories (.rgb, .lnd, .litd, .tor, …)
    // which Finder / most file managers hide by default. Nudge the user
    // so they don't think the folder is empty.
    const tip =
      result.platform === 'darwin'
        ? 'Data folder opened. Press ⌘⇧. in Finder to show hidden entries.'
        : result.platform === 'win32'
          ? 'Data folder opened. Enable "Hidden items" in Explorer\'s View tab to show .rgb / .lnd / ….'
          : 'Data folder opened. Enable "Show hidden files" in your file manager to see .rgb / .lnd / ….';
    toast(tip, 'success');
  } catch (e) {
    toast(`Failed to open: ${e.message}`, 'error');
  }
}

async function handleQuit() {
  setOverlay('Shutting down…');
  try {
    await window.welcomeAPI.quit();
  } catch (e) {
    clearOverlay();
    toast(`Quit failed: ${e.message}`, 'error');
  }
}

/* --------------------------- init --------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  if (!window.welcomeAPI) {
    showBanner(
      'warning',
      'Welcome bridge not available — preload did not load. ' +
        'Try restarting NodeFlow.',
    );
    setAllButtonsDisabled(true);
    return;
  }
  $('start-btn').addEventListener('click', handleStart);
  $('backup-btn').addEventListener('click', handleBackup);
  $('clear-btn').addEventListener('click', handleClear);
  $('open-data-btn').addEventListener('click', handleOpenDataDir);
  $('quit-btn').addEventListener('click', handleQuit);
  $('status-banner').addEventListener('click', handleBannerClick);
  loadInfo();
  refreshVersionCheck();
  refreshPortCheck();
});

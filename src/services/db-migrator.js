const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { app } = require('electron');
const log = require('../utils/logger');

/**
 * Resolve a project-relative path to its runtime location.
 *
 * In development (unpackaged), returns the regular node_modules path.
 * In production (asar-packaged), returns the path inside app.asar.unpacked.
 *
 * Prisma CLI and @prisma/engines MUST be in asarUnpack because Prisma spawns
 * native schema-engine binaries that cannot be exec'd from inside app.asar.
 * See package.json `build.asarUnpack`.
 */
function resolveAsset(relPath) {
  if (!app.isPackaged) {
    return path.join(__dirname, '..', '..', relPath);
  }
  const unpackedRoot = path.join(process.resourcesPath, 'app.asar.unpacked');
  return path.join(unpackedRoot, relPath);
}

/**
 * Run `prisma migrate deploy` against the user's database to apply any pending
 * schema migrations bundled with the current app version.
 *
 * - Safe on first install: if the template DB is already up-to-date, this is a no-op.
 * - Safe on upgrade: applies only new migrations since the last run.
 * - Non-fatal on failure: logs errors but does not throw. lnlink-server startup
 *   will surface any resulting schema mismatch later.
 *
 * Spawns the prisma CLI as a child process with ELECTRON_RUN_AS_NODE=1 so that
 * the Electron binary runs in plain Node mode (no Chromium, no renderer).
 *
 * @param {string} userDbPath Absolute path to the user's sqlite database file.
 * @returns {Promise<{ok: boolean, [key: string]: any}>}
 */
async function runMigrateDeploy(userDbPath) {
  const prismaCli = resolveAsset('node_modules/prisma/build/index.js');
  const schemaPath = resolveAsset('node_modules/lnlink-server/prisma/schema.prisma');

  if (!fs.existsSync(prismaCli)) {
    log.warn(`[db-migrator] Prisma CLI not found at: ${prismaCli}. Skipping migrations.`);
    return { ok: false, skipped: true, reason: 'prisma-cli-missing' };
  }
  if (!fs.existsSync(schemaPath)) {
    log.warn(`[db-migrator] schema.prisma not found at: ${schemaPath}. Skipping migrations.`);
    return { ok: false, skipped: true, reason: 'schema-missing' };
  }

  log.info('[db-migrator] Running prisma migrate deploy');
  log.info(`[db-migrator]   schema: ${schemaPath}`);
  log.info(`[db-migrator]   db:     ${userDbPath}`);

  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        LINK_DATABASE_URL: `file:${userDbPath}`,
      },
      encoding: 'utf-8',
      timeout: 60 * 1000,
    }
  );

  if (result.error) {
    log.error(`[db-migrator] Spawn error: ${result.error.message}`);
    return { ok: false, error: result.error.message };
  }

  if (result.stdout) {
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) log.info(`[prisma] ${line}`);
  }
  if (result.stderr) {
    const lines = result.stderr.trim().split('\n').filter(Boolean);
    for (const line of lines) log.warn(`[prisma] ${line}`);
  }

  if (result.status !== 0) {
    log.error(`[db-migrator] Prisma migrate exited with code ${result.status}`);
    return { ok: false, code: result.status };
  }

  log.info('[db-migrator] Migrate deploy completed successfully');
  return { ok: true };
}

module.exports = { runMigrateDeploy };

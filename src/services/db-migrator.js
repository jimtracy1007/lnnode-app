const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');
const log = require('../utils/logger');

/**
 * Resolve a project-relative path to its runtime location.
 * Dev: <project>/<relPath>. Packaged: <app.asar.unpacked>/<relPath>.
 *
 * At runtime inside the packaged app, @prisma/client and .prisma/client live
 * under app.asar.unpacked, and lnlink-server/prisma/migrations/*.sql also live
 * there via the asarUnpack config in package.json.
 */
function resolveAsset(relPath) {
  if (!app.isPackaged) {
    return path.join(__dirname, '..', '..', relPath);
  }
  return path.join(process.resourcesPath, 'app.asar.unpacked', relPath);
}

/**
 * Split a Prisma-generated SQLite migration.sql into an array of executable
 * statements. Strips `--` line comments and splits on `;`. Safe for DDL
 * (CREATE TABLE, CREATE INDEX, ALTER, PRAGMA, INSERT INTO ... SELECT ...)
 * because Prisma does not emit SQL with embedded semicolons in string
 * literals for SQLite migrations.
 */
function parseMigrationSQL(sql) {
  const withoutComments = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');

  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply pending Prisma migrations to the user's SQLite database using
 * @prisma/client directly from the Electron main process. This avoids the
 * brittleness of shelling out to the `prisma` CLI from inside an asar bundle.
 *
 * Behaviour:
 *   - Creates the `_prisma_migrations` tracking table if missing (same schema
 *     that Prisma CLI uses, so Prisma can later read/write it).
 *   - Reads migration folders from lnlink-server/prisma/migrations, sorts them
 *     lexicographically (== chronologically thanks to the timestamp prefix).
 *   - Skips any migration whose `migration_name` already has a non-null
 *     `finished_at` row.
 *   - Applies pending migrations inside an interactive Prisma transaction,
 *     executing each statement with $executeRawUnsafe so PRAGMA defer_foreign_keys
 *     and the RedefineTables pattern work correctly.
 *   - Records the applied row with checksum (sha256 of migration.sql bytes)
 *     to match Prisma's drift-detection format.
 *
 * Non-fatal on failure: logs errors and returns { ok: false } but does not
 * throw, so lnlink-server still gets a chance to start and surface a more
 * specific error if the DB truly is unusable.
 *
 * @param {string} userDbPath Absolute path to the user's sqlite database file.
 */
async function runMigrateDeploy(userDbPath) {
  const migrationsDir = resolveAsset('node_modules/lnlink-server/prisma/migrations');

  if (!fs.existsSync(migrationsDir)) {
    log.warn(`[db-migrator] migrations dir not found at: ${migrationsDir}. Skipping.`);
    return { ok: false, skipped: true, reason: 'migrations-dir-missing' };
  }

  const folders = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (folders.length === 0) {
    log.info('[db-migrator] No migration folders found, nothing to do');
    return { ok: true, applied: 0 };
  }

  log.info(`[db-migrator] Running programmatic migrate deploy`);
  log.info(`[db-migrator]   migrations: ${migrationsDir}`);
  log.info(`[db-migrator]   db:         ${userDbPath}`);
  log.info(`[db-migrator]   found:      ${folders.length} migration(s)`);

  let PrismaClient;
  try {
    ({ PrismaClient } = require('@prisma/client'));
  } catch (e) {
    log.error(`[db-migrator] Failed to require @prisma/client: ${e.message}`);
    return { ok: false, error: e.message };
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${userDbPath}` } },
    log: ['warn', 'error'],
  });

  try {
    // Ensure Prisma's tracking table exists. Schema must match what Prisma CLI
    // expects so that running `prisma migrate deploy` later stays compatible.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
          "id"                    TEXT PRIMARY KEY NOT NULL,
          "checksum"              TEXT NOT NULL,
          "finished_at"           DATETIME,
          "migration_name"        TEXT NOT NULL,
          "logs"                  TEXT,
          "rolled_back_at"        DATETIME,
          "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
          "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
      )`
    );

    const appliedRows = await prisma.$queryRawUnsafe(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`
    );
    const appliedSet = new Set(appliedRows.map((r) => r.migration_name));

    const pending = folders.filter((f) => !appliedSet.has(f));
    if (pending.length === 0) {
      log.info('[db-migrator] All migrations already applied');
      return { ok: true, applied: 0 };
    }

    log.info(`[db-migrator] Applying ${pending.length} pending migration(s)`);

    for (const folder of pending) {
      const sqlPath = path.join(migrationsDir, folder, 'migration.sql');
      if (!fs.existsSync(sqlPath)) {
        log.warn(`[db-migrator] ${folder}: migration.sql missing, skipping`);
        continue;
      }

      const sql = fs.readFileSync(sqlPath, 'utf-8');
      const statements = parseMigrationSQL(sql);
      if (statements.length === 0) {
        log.warn(`[db-migrator] ${folder}: empty after parsing, skipping`);
        continue;
      }

      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const id = crypto.randomUUID();
      const nowMs = Date.now();

      log.info(`[db-migrator] Applying ${folder} (${statements.length} statements)`);

      try {
        await prisma.$transaction(
          async (tx) => {
            for (const stmt of statements) {
              await tx.$executeRawUnsafe(stmt);
            }
            await tx.$executeRawUnsafe(
              `INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "finished_at", "applied_steps_count")
               VALUES (?, ?, ?, ?, ?, ?)`,
              id,
              checksum,
              folder,
              nowMs,
              nowMs,
              statements.length
            );
          },
          { timeout: 60 * 1000, maxWait: 10 * 1000 }
        );
        log.info(`[db-migrator] ✓ ${folder}`);
      } catch (e) {
        log.error(`[db-migrator] ✗ ${folder} failed: ${e.message}`);
        return { ok: false, error: e.message, failed: folder };
      }
    }

    log.info(`[db-migrator] Migrate deploy completed successfully (${pending.length} applied)`);
    return { ok: true, applied: pending.length };
  } catch (e) {
    log.error(`[db-migrator] Unexpected error: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    try {
      await prisma.$disconnect();
    } catch {}
  }
}

module.exports = { runMigrateDeploy };

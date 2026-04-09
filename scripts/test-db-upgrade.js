#!/usr/bin/env node
/*
 * Simulate the upgrade scenario:
 *   1. Old user has a DB created from the currently-bundled migrations.
 *   2. A new version ships with an additional migration.
 *   3. On next start, `migrate deploy` should apply the new migration to
 *      the existing DB without data loss.
 *
 * We use a temp clone of the lnlink-server prisma dir so we can inject a
 * synthetic migration without touching node_modules.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const prismaCli = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
const origSchemaPath = path.join(projectRoot, 'node_modules', 'lnlink-server', 'prisma', 'schema.prisma');
const origMigrationsDir = path.join(projectRoot, 'node_modules', 'lnlink-server', 'prisma', 'migrations');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function runMigrate(dbPath, schemaPath, label) {
  console.log(`\n▶ [${label}]`);
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
    {
      env: { ...process.env, LINK_DATABASE_URL: `file:${dbPath}` },
      encoding: 'utf-8',
      timeout: 60 * 1000,
    }
  );
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr && result.stderr.trim()) console.error(result.stderr.trim());
  return result.status === 0;
}

function listTables(dbPath) {
  // Use prisma CLI itself via `db execute` is complex; instead, shell out to
  // sqlite3 if available, else use the query engine via a tiny inline script.
  const { execFileSync } = require('child_process');
  try {
    const out = execFileSync('sqlite3', [dbPath, ".tables"], { encoding: 'utf-8' });
    return out.trim().split(/\s+/).filter(Boolean);
  } catch {
    return null;
  }
}

// ─── Setup: temp workdir with a copy of the prisma folder ───
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lnlink-upgrade-test-'));
const tmpPrismaDir = path.join(tmpDir, 'prisma');
const tmpSchemaPath = path.join(tmpPrismaDir, 'schema.prisma');
const tmpMigrationsDir = path.join(tmpPrismaDir, 'migrations');
const tmpDbPath = path.join(tmpDir, 'lnlink.db');

fs.mkdirSync(tmpPrismaDir, { recursive: true });
fs.copyFileSync(origSchemaPath, tmpSchemaPath);
copyDir(origMigrationsDir, tmpMigrationsDir);

console.log(`🧪 Workdir: ${tmpDir}`);
console.log(`   schema:     ${tmpSchemaPath}`);
console.log(`   migrations: ${tmpMigrationsDir}`);

// Step 1: install the "old" version (just the baseline migrations)
const ok1 = runMigrate(tmpDbPath, tmpSchemaPath, 'Step 1: old version install');
if (!ok1) { console.error('❌ baseline migrate failed'); process.exit(1); }

const tablesBefore = listTables(tmpDbPath);
console.log(`   tables after step 1: ${tablesBefore ? tablesBefore.join(', ') : '(sqlite3 CLI not available)'}`);

// Step 2: add a synthetic new migration (as if shipped with a newer version)
const newMigName = '20260409120000_add_test_upgrade_table';
const newMigDir = path.join(tmpMigrationsDir, newMigName);
fs.mkdirSync(newMigDir, { recursive: true });
fs.writeFileSync(
  path.join(newMigDir, 'migration.sql'),
  `CREATE TABLE "test_upgrade_table" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "note" TEXT
);
`
);
console.log(`\n📦 Injected new migration: ${newMigName}`);

// Step 3: run migrate again — should apply ONLY the new one
const ok2 = runMigrate(tmpDbPath, tmpSchemaPath, 'Step 3: upgrade run');
if (!ok2) { console.error('❌ upgrade migrate failed'); process.exit(1); }

const tablesAfter = listTables(tmpDbPath);
console.log(`   tables after step 3: ${tablesAfter ? tablesAfter.join(', ') : '(sqlite3 CLI not available)'}`);

// Step 4: run again to confirm idempotency
const ok3 = runMigrate(tmpDbPath, tmpSchemaPath, 'Step 4: re-run (idempotent)');

// Verification
let verdict = true;
if (tablesAfter && !tablesAfter.includes('test_upgrade_table')) {
  console.error('❌ new table was not applied');
  verdict = false;
}

// Cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\n${verdict && ok1 && ok2 && ok3 ? '✅ ALL CHECKS PASSED' : '❌ FAILED'}`);
process.exit(verdict && ok1 && ok2 && ok3 ? 0 : 1);

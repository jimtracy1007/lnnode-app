#!/usr/bin/env node
/*
 * Standalone test for the db-migrator spawn mechanism.
 *
 * Validates that `prisma migrate deploy` can be spawned successfully against
 * the user DB, using the same arg layout the runtime migrator uses. Also tests
 * idempotency by running twice on the same DB.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const prismaCli = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
const schemaPath = path.join(projectRoot, 'node_modules', 'lnlink-server', 'prisma', 'schema.prisma');

function runMigrate(dbPath, label) {
  console.log(`\n▶ [${label}] spawning prisma migrate deploy on ${dbPath}`);
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
    {
      env: { ...process.env, LINK_DATABASE_URL: `file:${dbPath}` },
      encoding: 'utf-8',
      timeout: 60 * 1000,
    }
  );
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  console.log(`  exit code: ${result.status}`);
  return result.status === 0;
}

console.log('📂 Project root:', projectRoot);
console.log('📜 Prisma CLI:  ', prismaCli, fs.existsSync(prismaCli) ? '✓' : '✗');
console.log('📜 Schema:      ', schemaPath, fs.existsSync(schemaPath) ? '✓' : '✗');

if (!fs.existsSync(prismaCli) || !fs.existsSync(schemaPath)) {
  console.error('❌ Prerequisites missing');
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lnlink-migrate-test-'));
const tmpDbPath = path.join(tmpDir, 'lnlink.db');

// Test 1: fresh DB
const ok1 = runMigrate(tmpDbPath, 'fresh');

// Test 2: re-run on same DB (should be idempotent no-op)
const ok2 = runMigrate(tmpDbPath, 'idempotent');

// Cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

const allOk = ok1 && ok2;
console.log(`\n${allOk ? '✅' : '❌'} fresh=${ok1} idempotent=${ok2}`);
process.exit(allOk ? 0 : 1);

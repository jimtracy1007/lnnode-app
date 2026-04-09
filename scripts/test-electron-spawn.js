#!/usr/bin/env node
/*
 * Verify that spawning with ELECTRON_RUN_AS_NODE=1 against the local Electron
 * binary can run the prisma CLI successfully. This exercises the exact code
 * path db-migrator uses at runtime inside the packaged app.
 *
 * Usage: node scripts/test-electron-spawn.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const electronBin = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const prismaCli = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
const schemaPath = path.join(projectRoot, 'node_modules', 'lnlink-server', 'prisma', 'schema.prisma');

console.log('⚡ Electron bin:', electronBin, fs.existsSync(electronBin) ? '✓' : '✗');
console.log('📜 Prisma CLI: ', prismaCli, fs.existsSync(prismaCli) ? '✓' : '✗');
console.log('📜 Schema:     ', schemaPath, fs.existsSync(schemaPath) ? '✓' : '✗');

if (!fs.existsSync(electronBin)) {
  console.error('⚠️  Electron binary not at expected path, trying fallback...');
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lnlink-electron-test-'));
const tmpDbPath = path.join(tmpDir, 'lnlink.db');

console.log(`\n▶ Spawning Electron as Node with prisma CLI...`);
console.log(`  execPath: ${electronBin}`);
console.log(`  script:   ${prismaCli}`);
console.log(`  db:       ${tmpDbPath}\n`);

const result = spawnSync(
  electronBin,
  [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
  {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      LINK_DATABASE_URL: `file:${tmpDbPath}`,
    },
    encoding: 'utf-8',
    timeout: 60 * 1000,
  }
);

if (result.stdout) console.log('[stdout]\n' + result.stdout);
if (result.stderr) console.error('[stderr]\n' + result.stderr);
if (result.error) console.error('[spawn error]', result.error.message);

console.log(`\nExit code: ${result.status}`);

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

process.exit(result.status === 0 ? 0 : 1);

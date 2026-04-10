#!/usr/bin/env node
/*
 * Ensures the ./data directory contains ONLY the Prisma template database
 * before electron-builder packs it into app.asar.
 *
 * Why this exists:
 *   During development (`yarn dev`), lnlink-server writes runtime state into
 *   ./data/ — wallet mnemonics (.rgb/mnemonic), LND chain state (.lnd/),
 *   TLS private keys (.litd/tls.key), LDK channel monitors, etc. If those
 *   files are still present when `yarn build` runs, electron-builder bundles
 *   them into the shipped .dmg, exposing the developer's private keys to
 *   every end user. This script removes anything that is not the template DB
 *   and warns loudly so the developer notices.
 *
 * It only touches files under ./data and is idempotent.
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(projectRoot, 'data');
// Paths that are allowed to remain, relative to ./data
const KEEP = new Set(['.link/lnlink.db']);

if (!fs.existsSync(dataDir)) {
  console.log('[clean-data] data/ does not exist, nothing to clean');
  process.exit(0);
}

// Safety guard: refuse to run if dataDir somehow points outside the project
if (!dataDir.startsWith(projectRoot + path.sep) && dataDir !== path.join(projectRoot, 'data')) {
  console.error(`[clean-data] Refusing to clean suspicious path: ${dataDir}`);
  process.exit(1);
}

let removedFiles = 0;
let removedDirs = 0;
const removedSensitive = [];

function relFromData(abs) {
  return path.relative(dataDir, abs).split(path.sep).join('/');
}

function isSensitive(rel) {
  return (
    rel.includes('mnemonic') ||
    rel.includes('tls.key') ||
    rel.includes('wallet_') ||
    rel.startsWith('.rgb/.ldk/') ||
    rel.startsWith('.lnd/') ||
    rel.startsWith('.tor/keys')
  );
}

function removeNonKept(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = relFromData(abs);

    if (entry.isDirectory()) {
      removeNonKept(abs);
      try {
        fs.rmdirSync(abs);
        removedDirs++;
      } catch {
        // directory not empty — it still contains a KEEP file
      }
      continue;
    }

    if (KEEP.has(rel)) continue;

    if (isSensitive(rel)) removedSensitive.push(rel);
    try {
      fs.unlinkSync(abs);
      removedFiles++;
    } catch (e) {
      console.error(`[clean-data] Failed to remove ${rel}: ${e.message}`);
    }
  }
}

console.log(`[clean-data] Scanning ${dataDir}`);
removeNonKept(dataDir);

if (removedFiles === 0) {
  console.log('[clean-data] Nothing to remove, data/ is already clean');
} else {
  console.log(`[clean-data] Removed ${removedFiles} file(s) and ${removedDirs} empty directory(ies)`);
  if (removedSensitive.length > 0) {
    console.warn('');
    console.warn('[clean-data] ⚠️  SENSITIVE files removed (would have leaked into .dmg):');
    for (const p of removedSensitive.slice(0, 20)) console.warn(`    - ${p}`);
    if (removedSensitive.length > 20) {
      console.warn(`    ... and ${removedSensitive.length - 20} more`);
    }
    console.warn('');
  }
}

// Wipe all runtime data from the template DB so developer state (owner_npub,
// node keys, lnlink_users, etc.) never ships to end users. Schema and
// migrations are preserved; only data rows are deleted.
const templateDb = path.join(dataDir, '.link', 'lnlink.db');
if (fs.existsSync(templateDb)) {
  try {
    const { execFileSync } = require('child_process');
    const dataTables = [
      'lnlink_config',
      'lnlink_users',
      'lnlink_orders',
      'lnlink_transactions',
      'lnlink_nostr_events',
      'exchange_orders',
    ];
    const sql = dataTables.map(t => `DELETE FROM ${t};`).join(' ') + ' VACUUM;';
    execFileSync('sqlite3', [templateDb, sql], { stdio: 'pipe' });
    console.log('[clean-data] Template DB data tables cleared (schema preserved)');
  } catch (e) {
    // sqlite3 CLI may not be available in all CI environments — log and continue.
    console.warn(`[clean-data] Could not clear template DB (sqlite3 not available?): ${e.message}`);
  }
}

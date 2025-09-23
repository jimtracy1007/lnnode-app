#!/usr/bin/env node
/*
 Plan A prebuild script:
 - Use Prisma CLI (node_modules/prisma/build/index.js) against ln-link's schema
 - Generate client and run migrate deploy into ./data/link/lnlink.db
 - This produces a fully migrated template DB that will be packed into the app
*/
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function runPrisma(args, env) {
  const prismaEntry = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(prismaEntry)) {
    console.error(`Prisma CLI entry not found at ${prismaEntry}`);
    process.exit(1);
  }
  const res = spawnSync(process.execPath, [prismaEntry, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    cwd: process.cwd(),
  });
  if (res.status !== 0) {
    console.error(`Prisma command failed: prisma ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
}

function main() {
  const schemaPath = path.join(process.cwd(), 'node_modules', 'ln-link', 'prisma', 'schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    console.error(`ln-link schema.prisma not found at ${schemaPath}`);
    process.exit(1);
  }

  const dataDir = path.join(process.cwd(), 'data', 'link');
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, 'lnlink.db');

  const env = {
    LINK_DATABASE_URL: `file:${dbPath}`,
  };

  console.log(`🗄️ Using template DB path: ${dbPath}`);
  console.log('🔧 Running prisma generate...');
  runPrisma(['generate', '--schema', schemaPath], env);

  console.log('📦 Running prisma migrate deploy...');
  runPrisma(['migrate', 'deploy', '--schema', schemaPath], env);

  // Verify DB created
  if (!fs.existsSync(dbPath)) {
    console.error('Prisma migrate did not create database at:', dbPath);
    process.exit(1);
  }

  console.log('✅ Prisma setup completed. Template DB ready.');
}

if (require.main === module) {
  main();
}

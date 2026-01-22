#!/usr/bin/env node
/*
 Plan A prebuild script:
 - Use Prisma CLI (node_modules/prisma/build/index.js) against lnlink-server's schema
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
  // 优先从 dist/prisma 查找，如果不存在则回退到根目录的 prisma
  const distSchemaPath = path.join(process.cwd(), 'node_modules', 'lnlink-server', 'dist', 'prisma', 'schema.prisma');
  const rootSchemaPath = path.join(process.cwd(), 'node_modules', 'lnlink-server', 'prisma', 'schema.prisma');
  
  let schemaPath;
  if (fs.existsSync(distSchemaPath)) {
    schemaPath = distSchemaPath;
    console.log(`📁 Using schema from dist: ${schemaPath}`);
  } else if (fs.existsSync(rootSchemaPath)) {
    schemaPath = rootSchemaPath;
    console.log(`📁 Using schema from root: ${schemaPath}`);
  } else {
    console.error(`lnlink-server schema.prisma not found at:`);
    console.error(`  - ${distSchemaPath}`);
    console.error(`  - ${rootSchemaPath}`);
    process.exit(1);
  }

  // Ensure generator block contains required binaryTargets for mac builds
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  const binaryTargetsLine = '  binaryTargets = ["native", "darwin", "darwin-arm64", "windows", "debian-openssl-3.0.x"]';
  if (!schemaContent.includes('binaryTargets')) {
    const providerLine = '  provider = "prisma-client-js"';
    if (!schemaContent.includes(providerLine)) {
      console.error('Unable to inject binaryTargets: provider line not found in schema.prisma generator block.');
      process.exit(1);
    }
    const updatedSchema = schemaContent.replace(
      providerLine,
      `${providerLine}\n${binaryTargetsLine}`
    );
    fs.writeFileSync(schemaPath, updatedSchema);
    console.log('🛠️ Updated schema.prisma to include binaryTargets for mac binaries.');
  }

  const dataDir = path.join(process.cwd(), 'data', 'link');
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, 'lnlink.db');

  const env = {
    LINK_DATABASE_URL: `file:${dbPath}`,
  };

  console.log(`🗄️ Using template DB path: ${dbPath}`);
  console.log('🔧 Running prisma generate with schema-defined binaryTargets...');
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

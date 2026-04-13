const path = require('path');
const fs = require('fs');
const asar = require('asar');

exports.default = async function(context) {
  console.log('🔧 Starting afterPack process...');
  
  const { electronPlatformName, arch, appOutDir } = context;

  // Handle architecture value (can be a number)
  let actualArch;
  if (typeof arch === 'number') {
    actualArch = arch === 1 ? 'x64' : arch === 3 ? 'arm64' : 'unknown';
  } else {
    actualArch = arch;
  }

  console.log(`📦 Platform: ${electronPlatformName}, Architecture: ${actualArch}`);

  // Check if lnlink-server is properly packaged (no asar)
  const resourcesBase = electronPlatformName === 'darwin'
    ? path.join(appOutDir, 'NodeFlow.app/Contents/Resources')
    : path.join(appOutDir, 'resources');

  const unpackedRoot = path.join(resourcesBase, 'app.asar.unpacked');
  const appRoot = path.join(resourcesBase, 'app');
  const appAsarPath = path.join(resourcesBase, 'app.asar');

  const existsInAsar = (relativePath) => {
    if (!fs.existsSync(appAsarPath)) {
      return false;
    }
    try {
      asar.statFile(appAsarPath, relativePath);
      return true;
    } catch (error) {
      if (error?.code !== 'FILE_NOT_FOUND') {
        console.warn(`⚠️  Warning: Unable to inspect app.asar for ${relativePath}: ${error.message}`);
      }
      return false;
    }
  };

  const nodeModulesCandidates = [
    path.join(unpackedRoot, 'node_modules'),
    path.join(appRoot, 'node_modules')
  ];

  let nodeModulesPath = null;
  for (const candidate of nodeModulesCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      nodeModulesPath = candidate;
      break;
    }
  }

  const lnLinkPath = nodeModulesPath ? path.join(nodeModulesPath, 'lnlink-server') : null;
  let lnLinkFound = false;

  if (lnLinkPath && fs.existsSync(lnLinkPath)) {
    lnLinkFound = true;
    console.log(`✅ lnlink-server found at: ${lnLinkPath}`);
    const lnLinkPrismaPath = path.join(lnLinkPath, 'prisma');
    if (fs.existsSync(lnLinkPrismaPath)) {
      console.log(`✅ lnlink-server prisma directory found at: ${lnLinkPrismaPath}`);
    } else {
      console.warn(`⚠️  Warning: lnlink-server prisma directory not found at: ${lnLinkPrismaPath}`);
    }
  }

  if (!lnLinkFound && existsInAsar('node_modules/lnlink-server/package.json')) {
    lnLinkFound = true;
    console.log(`✅ lnlink-server found inside app.asar at: ${appAsarPath}!node_modules/lnlink-server`);
    if (existsInAsar('node_modules/lnlink-server/prisma/schema.prisma')) {
      console.log('✅ lnlink-server prisma directory present inside app.asar');
    } else {
      console.warn('⚠️  Warning: lnlink-server prisma directory missing inside app.asar');
    }
  }

  if (!lnLinkFound) {
    console.warn('⚠️  Warning: lnlink-server package not found in unpacked directories or app.asar');
  }

  // Check if Prisma client is properly unpacked
  const prismaClientCandidates = [
    path.join(unpackedRoot, 'node_modules', '.prisma', 'client'),
    path.join(appRoot, 'node_modules', '.prisma', 'client')
  ];

  let prismaClientPath = null;
  for (const candidate of prismaClientCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      prismaClientPath = candidate;
      console.log(`✅ Prisma client found at: ${candidate}`);
      break;
    }
  }

  if (prismaClientPath) {
    let queryEngineFiles = [];
    if (electronPlatformName === 'darwin') {
      queryEngineFiles = [
        `libquery_engine-darwin-${actualArch}.dylib.node`,
        'libquery_engine-darwin.dylib.node',
        'libquery_engine.dylib.node'
      ];
    } else if (electronPlatformName === 'win32') {
      queryEngineFiles = [
        `query_engine-windows.dll.node`,
        'query_engine.dll.node'
      ];
    } else if (electronPlatformName === 'linux') {
      queryEngineFiles = [
        `libquery_engine-linux-${actualArch}-openssl-1.1.x.so.node`,
        'libquery_engine.so.node'
      ];
    }

    let engineFound = false;
    for (const engineFile of queryEngineFiles) {
      const enginePath = path.join(prismaClientPath, engineFile);
      if (fs.existsSync(enginePath)) {
        console.log(`✅ Prisma query engine found: ${engineFile}`);
        engineFound = true;
        break;
      }
    }

    if (!engineFound) {
      console.warn(`⚠️  Warning: Prisma query engine not found. Expected one of: ${queryEngineFiles.join(', ')}`);
    }
  } else {
    console.warn('⚠️  Warning: Prisma client not found in unpacked directories or app folder');
  }

  const prismaClientPackageCandidates = [
    path.join(unpackedRoot, 'node_modules', '@prisma', 'client'),
    path.join(appRoot, 'node_modules', '@prisma', 'client')
  ];

  let prismaClientPackageFound = false;
  for (const candidate of prismaClientPackageCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      prismaClientPackageFound = true;
      console.log(`✅ @prisma/client package found at: ${candidate}`);
      break;
    }
  }

  if (!prismaClientPackageFound && existsInAsar('node_modules/@prisma/client/package.json')) {
    prismaClientPackageFound = true;
    console.log(`✅ @prisma/client package present inside app.asar at: ${appAsarPath}!node_modules/@prisma/client`);
  }

  if (!prismaClientPackageFound) {
    if (!fs.existsSync(appAsarPath)) {
      console.log('ℹ️  @prisma/client package not found before asar packaging (expected to be bundled inside app.asar).');
    } else {
      console.warn('⚠️  Warning: @prisma/client package not found in unpacked directories or app.asar');
    }
  }
  
  // Plan A: verify template DB packaged at Resources/app/data/link/lnlink.db
  const templateDbCandidates = [];
  if (fs.existsSync(appRoot)) {
    templateDbCandidates.push(path.join(appRoot, 'data', 'link', 'lnlink.db'));
  }
  templateDbCandidates.push(path.join(unpackedRoot, 'data', 'link', 'lnlink.db'));

  let templateDbFound = false;
  for (const candidate of templateDbCandidates) {
    if (fs.existsSync(candidate)) {
      console.log(`✅ Template DB found: ${candidate}`);
      templateDbFound = true;
      break;
    }
  }

  if (!templateDbFound && existsInAsar('data/link/lnlink.db')) {
    templateDbFound = true;
    console.log(`✅ Template DB present inside app.asar at: ${appAsarPath}!data/link/lnlink.db`);
  }

  if (!templateDbFound) {
    if (!fs.existsSync(appAsarPath)) {
      console.log('ℹ️  Template DB not found before asar packaging (expected to be bundled inside app.asar).');
    } else {
      console.warn('⚠️  Template DB not found in expected locations (scripts/prisma-setup.js should create it).');
    }
  }
  
  // Verify @nodeflow-network/bin-<target> and marker binary are in app.asar.unpacked.
  // A cross-build from a mismatched host OS will silently omit the optionalDependency,
  // producing a package that fails at first launch. Catch it here at build time instead.
  const targetKey =
    electronPlatformName === 'win32' ? 'win32-x64' :
    electronPlatformName === 'linux' ? 'linux-x64' :
    `darwin-${actualArch}`;
  const nodeflowBinPkg = path.join(unpackedRoot, 'node_modules', '@nodeflow-network', `bin-${targetKey}`);
  if (!fs.existsSync(nodeflowBinPkg)) {
    throw new Error(
      `[afterPack] @nodeflow-network/bin-${targetKey} not found at ${nodeflowBinPkg}. ` +
      `Cross-building from a host OS that does not match the target will cause optionalDependencies ` +
      `to be skipped. Build ${targetKey} targets on a matching host.`
    );
  }
  const binExt = electronPlatformName === 'win32' ? '.exe' : '';
  const markerBinary = path.join(nodeflowBinPkg, 'bin', 'terminal', `litd${binExt}`);
  if (!fs.existsSync(markerBinary)) {
    throw new Error(`[afterPack] nodeflow-bin sub-package present but litd missing: ${markerBinary}`);
  }
  const provenancePath = path.join(nodeflowBinPkg, 'PROVENANCE.json');
  if (!fs.existsSync(provenancePath)) {
    throw new Error(`[afterPack] PROVENANCE.json missing from bin-${targetKey}: ${provenancePath}. ` +
      `rgb-version-checker depends on it to detect breaking upgrades.`);
  }
  console.log(`✅ nodeflow-bin verified: bin-${targetKey} (litd + PROVENANCE.json present)`);

  console.log('✅ afterPack completed successfully');
};
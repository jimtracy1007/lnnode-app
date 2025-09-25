const path = require('path');
const fs = require('fs');

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
  
  // Check if ln-link is properly packaged (no asar)
  const platformPaths = {
    'darwin': 'LN-Link.app/Contents/Resources/app/node_modules',
    'win32': 'resources/app/node_modules',
    'linux': 'resources/app/node_modules'
  };
  
  const unpackedNodeModulesPath = path.join(appOutDir, platformPaths[electronPlatformName] || 'resources/app/node_modules');
  const lnLinkPath = path.join(unpackedNodeModulesPath, 'ln-link');
  
  if (fs.existsSync(lnLinkPath)) {
    console.log(`✅ ln-link found at: ${lnLinkPath}`);
    
    // Check if ln-link's prisma directory exists
    const lnLinkPrismaPath = path.join(lnLinkPath, 'prisma');
    if (fs.existsSync(lnLinkPrismaPath)) {
      console.log(`✅ ln-link prisma directory found at: ${lnLinkPrismaPath}`);
    } else {
      console.warn(`⚠️  Warning: ln-link prisma directory not found at: ${lnLinkPrismaPath}`);
    }
  } else {
    console.warn(`⚠️  Warning: ln-link not found at: ${lnLinkPath}`);
  }
  
  // Check if Prisma client is properly unpacked
  const prismaClientPath = path.join(unpackedNodeModulesPath, '.prisma', 'client');
  if (fs.existsSync(prismaClientPath)) {
    console.log(`✅ Prisma client found at: ${prismaClientPath}`);
    
    // Check for query engine based on platform and architecture
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
    console.warn(`⚠️  Warning: Prisma client not found at: ${prismaClientPath}`);
  }
  
  // Check if @prisma/client is available
  const prismaClientPackagePath = path.join(unpackedNodeModulesPath, '@prisma', 'client');
  if (fs.existsSync(prismaClientPackagePath)) {
    console.log(`✅ @prisma/client package found at: ${prismaClientPackagePath}`);
  } else {
    console.warn(`⚠️  Warning: @prisma/client package not found at: ${prismaClientPackagePath}`);
  }
  
  // Plan A: verify template DB packaged at Resources/app/data/link/lnlink.db
  const appResourcesAppPath = path.join(appOutDir,
    electronPlatformName === 'darwin' ? 'LN-Link.app/Contents/Resources/app' : 'resources/app');
  const templateDbPath = path.join(appResourcesAppPath, 'data', 'link', 'lnlink.db');
  if (fs.existsSync(templateDbPath)) {
    console.log(`✅ Template DB found: ${templateDbPath}`);
  } else {
    console.warn(`⚠️  Template DB not found: ${templateDbPath} (expected created by scripts/prisma-setup.js)`);
  }
  
  console.log('✅ afterPack completed successfully');
};
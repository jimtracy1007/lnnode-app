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
  
  // Check if @lnfi-network/ln-link is properly packaged
  const platformPaths = {
    'darwin': 'LN-Link.app/Contents/Resources/nodeserver/node_modules',
    'win32': 'resources/nodeserver/node_modules',
    'linux': 'resources/nodeserver/node_modules'
  };
  
  const nodeModulesPath = path.join(appOutDir, platformPaths[electronPlatformName] || 'resources/nodeserver/node_modules');
  const lnLinkPath = path.join(nodeModulesPath, '@lnfi-network/ln-link');
  
  if (fs.existsSync(lnLinkPath)) {
    console.log(`✅ @lnfi-network/ln-link found at: ${lnLinkPath}`);
    
    // Check if sqlite3 exists (optional, as it's handled by ln-link)
    const sqlitePath = path.join(nodeModulesPath, 'sqlite3');
    if (fs.existsSync(sqlitePath)) {
      console.log(`✅ SQLite3 module found and should be handled by @lnfi-network/ln-link postinstall`);
    } else {
      console.log(`ℹ️  SQLite3 not found in direct dependencies (handled by @lnfi-network/ln-link)`);
    }
  } else {
    console.warn(`⚠️  Warning: @lnfi-network/ln-link not found at: ${lnLinkPath}`);
  }
  
  console.log('✅ afterPack completed successfully');
}; 
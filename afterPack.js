const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  console.log('🔧 Starting afterPack process...');
  
  const { electronPlatformName, arch, appOutDir } = context;
  
  // Print debug information
  console.log(`🔍 Context: platform=${electronPlatformName}, arch=${arch}, archAsString=${typeof arch === 'number' ? (arch === 1 ? 'x64' : arch === 3 ? 'arm64' : 'unknown') : arch}`);
  
  // Handle architecture value (can be a number)
  let actualArch;
  if (typeof arch === 'number') {
    actualArch = arch === 1 ? 'x64' : arch === 3 ? 'arm64' : 'unknown';
  } else {
    actualArch = arch;
  }
  
  if (electronPlatformName === 'darwin') {
    // Ensure SQLite binding file is correct
    const nodeModulesPath = path.join(appOutDir, 'LN-Link.app/Contents/Resources/nodeserver/node_modules');
    const sqliteBindingPath = path.join(nodeModulesPath, 'sqlite3/lib/binding');
    
    if (fs.existsSync(sqliteBindingPath)) {
      const expectedBinding = actualArch === 'x64' ? 'napi-v6-darwin-unknown-x64' : 'napi-v6-darwin-unknown-arm64';
      const bindingExists = fs.existsSync(path.join(sqliteBindingPath, expectedBinding));
      
      console.log(`📦 Architecture: ${actualArch} (original: ${arch})`);
      console.log(`🔍 Checking SQLite binding: ${expectedBinding}`);
      console.log(`✅ Binding exists: ${bindingExists}`);
      
      if (!bindingExists) {
        console.warn(`⚠️  Warning: SQLite binding for ${actualArch} not found!`);
        
        // List actual available bindings
        const availableBindings = fs.readdirSync(sqliteBindingPath);
        console.log(`📋 Available bindings: ${availableBindings.join(', ')}`);
      }
    } else {
      console.warn(`⚠️  Warning: SQLite binding path not found: ${sqliteBindingPath}`);
    }
  } else if (electronPlatformName === 'win32') {
    // SQLite3 binding handling for Windows platform
    const nodeModulesPath = path.join(appOutDir, 'resources/nodeserver/node_modules');
    const sqliteBindingPath = path.join(nodeModulesPath, 'sqlite3/lib/binding');
    
    console.log(`🪟 Processing Windows SQLite bindings...`);
    console.log(`📂 NodeModules path: ${nodeModulesPath}`);
    console.log(`📂 SQLite binding path: ${sqliteBindingPath}`);
    
    if (fs.existsSync(sqliteBindingPath)) {
      const expectedBinding = `napi-v6-win32-unknown-${actualArch}`;
      const expectedBindingPath = path.join(sqliteBindingPath, expectedBinding);
      const bindingExists = fs.existsSync(expectedBindingPath);
      
      console.log(`📦 Architecture: ${actualArch} (original: ${arch})`);
      console.log(`🔍 Checking SQLite binding: ${expectedBinding}`);
      console.log(`✅ Binding exists: ${bindingExists}`);
      
      if (!bindingExists) {
        console.warn(`⚠️  Warning: SQLite binding for Windows ${actualArch} not found!`);
        
        // List actual available bindings
        try {
          const availableBindings = fs.readdirSync(sqliteBindingPath);
          console.log(`📋 Available bindings: ${availableBindings.join(', ')}`);
          
          // Attempt to find any Windows binding files
          const windowsBindings = availableBindings.filter(binding => 
            binding.includes('win32') || binding.includes('windows')
          );
          
          if (windowsBindings.length > 0) {
            console.log(`🔍 Found Windows bindings: ${windowsBindings.join(', ')}`);
            
            // If other Windows bindings are found, try to copy to the expected name
            const sourceBinding = windowsBindings.find(binding => 
              binding.includes(actualArch) || binding.includes('x64')
            );
            
            if (sourceBinding) {
              const sourcePath = path.join(sqliteBindingPath, sourceBinding);
              const targetPath = expectedBindingPath;
              
              try {
                fs.copyFileSync(sourcePath, targetPath);
                console.log(`✅ Copied ${sourceBinding} to ${expectedBinding}`);
              } catch (copyError) {
                console.error(`❌ Failed to copy binding: ${copyError.message}`);
              }
            }
          }
        } catch (readError) {
          console.error(`❌ Failed to read bindings directory: ${readError.message}`);
        }
      } else {
        console.log(`✅ SQLite binding found for Windows ${actualArch}`);
      }
    } else {
      console.warn(`⚠️  Warning: SQLite binding path not found: ${sqliteBindingPath}`);
      
      // Attempt to find SQLite3 module
      const sqlite3ModulePath = path.join(nodeModulesPath, 'sqlite3');
      if (fs.existsSync(sqlite3ModulePath)) {
        console.log(`📦 SQLite3 module found at: ${sqlite3ModulePath}`);
        
        // Create binding directory if it doesn't exist
        if (!fs.existsSync(sqliteBindingPath)) {
          try {
            fs.mkdirSync(sqliteBindingPath, { recursive: true });
            console.log(`📁 Created binding directory: ${sqliteBindingPath}`);
          } catch (mkdirError) {
            console.error(`❌ Failed to create binding directory: ${mkdirError.message}`);
          }
        }
      } else {
        console.error(`❌ SQLite3 module not found at: ${sqlite3ModulePath}`);
      }
    }
  }
  
  console.log('✅ afterPack completed successfully');
}; 
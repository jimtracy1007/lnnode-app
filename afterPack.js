const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  console.log('🔧 Starting afterPack process...');
  
  const { electronPlatformName, arch, appOutDir } = context;
  
  // 打印调试信息
  console.log(`🔍 Context: platform=${electronPlatformName}, arch=${arch}, archAsString=${typeof arch === 'number' ? (arch === 1 ? 'x64' : arch === 3 ? 'arm64' : 'unknown') : arch}`);
  
  // 处理架构值（可能是数字）
  let actualArch;
  if (typeof arch === 'number') {
    actualArch = arch === 1 ? 'x64' : arch === 3 ? 'arm64' : 'unknown';
  } else {
    actualArch = arch;
  }
  
  if (electronPlatformName === 'darwin') {
    // 确保 SQLite 绑定文件正确
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
        
        // 列出实际存在的绑定
        const availableBindings = fs.readdirSync(sqliteBindingPath);
        console.log(`📋 Available bindings: ${availableBindings.join(', ')}`);
      }
    } else {
      console.warn(`⚠️  Warning: SQLite binding path not found: ${sqliteBindingPath}`);
    }
  } else if (electronPlatformName === 'win32') {
    // Windows 平台的 SQLite3 绑定处理
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
        
        // 列出实际存在的绑定
        try {
          const availableBindings = fs.readdirSync(sqliteBindingPath);
          console.log(`📋 Available bindings: ${availableBindings.join(', ')}`);
          
          // 尝试查找任何 Windows 绑定文件
          const windowsBindings = availableBindings.filter(binding => 
            binding.includes('win32') || binding.includes('windows')
          );
          
          if (windowsBindings.length > 0) {
            console.log(`🔍 Found Windows bindings: ${windowsBindings.join(', ')}`);
            
            // 如果找到其他 Windows 绑定，尝试复制为期望的名称
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
      
      // 尝试查找 SQLite3 模块
      const sqlite3ModulePath = path.join(nodeModulesPath, 'sqlite3');
      if (fs.existsSync(sqlite3ModulePath)) {
        console.log(`📦 SQLite3 module found at: ${sqlite3ModulePath}`);
        
        // 创建 binding 目录如果不存在
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
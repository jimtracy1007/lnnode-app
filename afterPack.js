const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  console.log('🔧 Starting afterPack process...');
  
  const { electronPlatformName, arch, appOutDir } = context;
  
  // 打印调试信息
  console.log(`🔍 Context: platform=${electronPlatformName}, arch=${arch}, archAsString=${typeof arch === 'number' ? (arch === 1 ? 'x64' : arch === 3 ? 'arm64' : 'unknown') : arch}`);
  
  if (electronPlatformName === 'darwin') {
    // 确保 SQLite 绑定文件正确
    const nodeModulesPath = path.join(appOutDir, 'LN-Link.app/Contents/Resources/nodeserver/node_modules');
    const sqliteBindingPath = path.join(nodeModulesPath, 'sqlite3/lib/binding');
    
    if (fs.existsSync(sqliteBindingPath)) {
      // 处理架构值（可能是数字）
      let actualArch;
      if (typeof arch === 'number') {
        actualArch = arch === 1 ? 'x64' : arch === 3 ? 'arm64' : 'unknown';
      } else {
        actualArch = arch;
      }
      
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
  }
  
  console.log('✅ afterPack completed successfully');
}; 
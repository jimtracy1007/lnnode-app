const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`);
  
  console.log(`\n🔐 Applying ad-hoc signature to: ${appPath}`);
  
  try {
    // Ad-hoc sign the app
    execSync(`codesign --sign - --force --deep "${appPath}"`, {
      stdio: 'inherit'
    });
    
    console.log('✅ Ad-hoc signature applied successfully\n');
  } catch (error) {
    console.error('❌ Ad-hoc signing failed:', error);
    throw error;
  }
};

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;

  let nodeserverPath;
  if (electronPlatformName === 'darwin') {
    nodeserverPath = path.join(appOutDir, 'LN-Link.app', 'Contents', 'Resources', 'app.asar.unpacked', 'nodeserver');
  } else if (electronPlatformName === 'win') {
    nodeserverPath = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'nodeserver');
  } else if (electronPlatformName === 'linux') {
    nodeserverPath = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'nodeserver');
  } else {
    return;
  }

  if (!fs.existsSync(nodeserverPath)) {
    throw new Error(`nodeserver directory does not exist: ${nodeserverPath}`);
  }

  console.log(`Installing nodeserver dependencies for ${electronPlatformName}...`);

  await new Promise((resolve, reject) => {
    const child = spawn('yarn', ['install', '--production'], {
      cwd: nodeserverPath,
      stdio: 'inherit',
      shell: true
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yarn install failed with code ${code}`));
      } else {
        console.log(`nodeserver dependencies installed successfully for ${electronPlatformName}.`);
        resolve();
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}; 
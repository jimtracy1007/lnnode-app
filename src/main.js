const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { nip19, nip04, getPublicKey, generateSecretKey, finalizeEvent } = require("nostr-tools")
const { bytesToHex, hexToBytes } = require('@noble/hashes/utils') 
const { getPrivateKey } = require('./store');

// 保持对窗口对象的全局引用，避免 JavaScript 对象被垃圾回收时窗口关闭
let mainWindow;
let serverProcess = null;
let rgbNodeProcess = null;

// Nostr 
const nostrEnabled = true;
const sk = getPrivateKey();
const nostrPublicKey = getPublicKey(sk)
console.log("Link owner:::", nip19.npubEncode(nostrPublicKey))

const BasePath = path.join(__dirname, '../');

// 启动 Express 服务器
function startExpressServer(systemInfo) {

  if(!systemInfo.support){
    console.error(`System is not supported: ${systemInfo.platform}-${systemInfo.arch} Skip start Express Server`);
    return;
  }
  const env = Object.assign({}, process.env);

  env.ELECTRON_RUN = true;
  // data path
  env.LIT_NAME = "Lnfi-Node";
  env.LIT_DATA_PATH = `${BasePath}data/`;

  env.LIT_LOCAL_BASE_PATH = `${env.LIT_DATA_PATH}${env.LIT_NAME}`;

  env.LIT_ENABLE_TOR = false;
  env.LIT_TOR_SOCKS_PORT = '9050';
  env.LIT_TOR_CONTROL_PORT = '9051';

  //port
  env.LND_RPC_PORT = '10009';
  env.LND_LISTEN_PORT = '9735';


  env.PORT = '8090';
  env.LINK_HTTP_PORT = '8090';
  env.BINARY_PATH = systemInfo.binaryPath;

  env.LINK_OWNER = nip19.npubEncode(nostrPublicKey)

  //rgb
  env.RGB_LISTENING_PORT = '3002';
  env.RGB_LDK_PEER_LISTENING_PORT = '9736';
  env.RGB_NETWORK = 'regtest';

  // 使用 spawn 启动 Node.js 进程运行 app.js
  serverProcess = spawn('node', ['../nodeserver/app.js'], {
    cwd: __dirname,
    env: env
  });
  
  // 监听标准输出
  serverProcess.stdout.on('data', (data) => {
    console.log(`Express server: ${data}`);
  });
  
  // 监听错误输出
  serverProcess.stderr.on('data', (data) => {
    console.error(`Express server error: ${data}`);
  });
  
  // 监听进程结束
  serverProcess.on('close', (code) => {
    console.log(`Express server process exited with code ${code}`);
    serverProcess = null;
  });
}

// 启动 RGB Lightning Node
// function startRGBLightningNode(systemInfo) {
//   if(!systemInfo.support){
//     console.error(`System is not supported: ${systemInfo.platform}-${systemInfo.arch}`);
//     return;
//   }
//     const rgbNodePath = systemInfo.binaryPath + "/rgb-lightning-node";
    
//     console.log(`Starting RGB Lightning Node from: ${rgbNodePath}`);

//     // rgb-lightning-node dataldk0/ --daemon-listening-port 3001 \
//     // --ldk-peer-listening-port 9735 --network regtest

//     let dataPath = `${BasePath}data`;

//     let args = [dataPath,'--daemon-listening-port','8001','--ldk-peer-listening-port','9735','--network','regtest'];
    
//     // 使用 spawn 启动 RGB Lightning Node
//     rgbNodeProcess = spawn(rgbNodePath, args, {
//       cwd: __dirname,
//       env: process.env,
//       // 确保二进制文件有执行权限
//       shell: true
//     });
    
//     // 监听标准输出
//     rgbNodeProcess.stdout.on('data', (data) => {
//       console.log(`RGB Lightning Node: ${data}`);
//     });
    
//     // 监听错误输出
//     rgbNodeProcess.stderr.on('data', (data) => {
//       console.error(`RGB Lightning Node error: ${data}`);
//     });
    
//     // 监听进程结束
//     rgbNodeProcess.on('close', (code) => {
//       console.log(`RGB Lightning Node process exited with code ${code}`);
//       rgbNodeProcess = null;
//     });
//   }

// get os type
function getSystemInfo() {
  const platform = process.platform;
  const arch = process.arch;

  console.log(`Platform: ${platform}-${arch}  ${__dirname}`);
  // get bin path 
  let binaryPath = `${BasePath}/bin/${platform}-${arch}`;
  console.log(`1=====>Binary Path: ${binaryPath}`);

  // check if binaryPath is exist
  if (fs.existsSync(binaryPath)) {
    console.log(`Binary Path exists: ${binaryPath}`);
    return{
      support: true,
      platform: platform,
      arch: arch,
      binaryPath: binaryPath
    }
  } else {
    console.log(`Binary Path does not exist: ${binaryPath}`);
    return{
      support: false,
      platform: platform,
      arch: arch,
      binaryPath: binaryPath
    }
  }

  
}

function getAppIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'lnfi.png');
  console.log(`App icon path: ${iconPath}`);
  if (fs.existsSync(iconPath)) {
    return iconPath;
  }
  
  console.warn('App icon not found at:', iconPath);
  return undefined;
}

function createWindow() {
  let systemInfo = getSystemInfo();
  // Start Express Server
  startExpressServer(systemInfo);
  // Start RGB Lightning Node
  //startRGBLightningNode(systemInfo);
  
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: false, 
        allowRunningInsecureContent: false,
        experimentalFeatures: false
    },
    icon: getAppIcon(),
    titleBarStyle: 'default',
    show: true,
    title: 'Lightning Network Node App'
  });

  // 等待一小段时间确保 Express 服务器已启动
  setTimeout(() => {
    // 加载应用的本地 URL
    // mainWindow.loadURL('https://devoflnnode.unift.xyz/#/');
    mainWindow.loadURL('http://127.0.0.1:8090');
    
    mainWindow.webContents.openDevTools();
  }, 1000);

  // 当窗口关闭时触发
  mainWindow.on('closed', function() {
    mainWindow = null;
  });
}

// Electron 初始化完成后创建窗口
app.whenReady().then(createWindow);

// 所有窗口关闭时退出应用
app.on('window-all-closed', function() {
  // 关闭 Express 服务器
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }

  if (rgbNodeProcess) {
    rgbNodeProcess.kill();
    rgbNodeProcess = null;
  }
  
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function() {
  if (mainWindow === null) createWindow();
});

// 确保应用退出时也关闭服务器进程
app.on('quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (rgbNodeProcess) {
    rgbNodeProcess.kill();
    rgbNodeProcess = null;
  }
});

// Nostr IPC 处理器
ipcMain.handle('nostr-get-public-key', async () => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
      return nostrPublicKey;  
      
  } catch (error) {
      throw new Error(`Failed to get public key: ${error.message}`);
  }
});

ipcMain.handle('nostr-get-npub', async () => {
  let npub = await nip19.npubEncode(nostrPublicKey);
  console.log(`Nostr NPub: ${npub}`);
  return npub;
});

ipcMain.handle('nostr-sign-event', async (event, eventData) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }

      let signedEvent = await finalizeEvent(eventData, sk)
      return signedEvent;
  } catch (error) {
      throw new Error(`Failed to sign event: ${error.message}`);
  }
});

ipcMain.handle('nostr-get-relays', async () => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
      // 默认中继列表
      return {
          'wss://relay01.lnfi.network': { read: true, write: true },
          'wss://relay02.lnfi.network': { read: true, write: true },
          'wss://nostr-01.yakihonne.com': { read: true, write: true },
          'wss://nostr-02.yakihonne.com': { read: true, write: true },
      };
  } catch (error) {
      throw new Error(`Failed to get relays: ${error.message}`);
  }
});

ipcMain.handle('nostr-nip04-encrypt', async (event, pubkey, plaintext) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
    
      return nip04.encrypt(sk, pubkey, plaintext);
      
  } catch (error) {
      throw new Error(`Failed to encrypt: ${error.message}`);
  }
});

ipcMain.handle('nostr-nip04-decrypt', async (event, pubkey, ciphertext) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }

      return nip04.decrypt(sk, pubkey, ciphertext);
      
  } catch (error) {
      throw new Error(`Failed to decrypt: ${error.message}`);
  }
});

ipcMain.handle('nostr-nip44-encrypt', async (event, pubkey, plaintext) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
      
      return nip44.encrypt(sk, pubkey, plaintext)

  } catch (error) {
      throw new Error(`Failed to encrypt with NIP-44: ${error.message}`);
  }
});

ipcMain.handle('nostr-nip44-decrypt', async (event, pubkey, ciphertext) => {
  try {
      if (!nostrEnabled) {
          throw new Error('Nostr is not enabled');
      }
      return nip44.decrypt(sk, pubkey, ciphertext)
  } catch (error) {
      throw new Error(`Failed to decrypt with NIP-44: ${error.message}`);
  }
});

ipcMain.handle('nostr-enable', async () => {
  try {
      return true;
  } catch (error) {
      throw new Error(`Failed to enable Nostr: ${error.message}`);
  }
});

ipcMain.handle('nostr-is-enabled', async () => {
  return nostrEnabled;
});
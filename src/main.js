const { app, BrowserWindow, ipcMain } = require('electron');
global.crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn, fork } = require('child_process');
const { nip19, nip04, getPublicKey, finishEvent } = require("nostr-tools")
const { getPrivateKey } = require('./store');
const log = require('electron-log');

// 配置日志
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';


// 保持对窗口对象的全局引用，避免 JavaScript 对象被垃圾回收时窗口关闭
let mainWindow;
let serverProcess = null;
let rgbNodeProcess = null;

// Nostr 
const nostrEnabled = true;
const sk = getPrivateKey();
const nostrPublicKey = getPublicKey(sk)
const npub = nip19.npubEncode(nostrPublicKey)
const LINK_HTTP_PORT = '8091'
console.log("Link owner:::", npub)

const BasePath = path.join(__dirname, '../');

class PathManager {
  constructor() {
    this.isPackaged = app.isPackaged;
    this.appPath = app.getAppPath();
    
    
    if (this.isPackaged) {
      this.userDataPath = app.getPath('userData');
      this.resourcesPath = process.resourcesPath;
      this.binaryPath = path.join(process.resourcesPath, 'bin');
      this.nodeserverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'nodeserver');
      this.nodeserverPath = path.join(__dirname, '..', 'nodeserver');

      // if (!fs.existsSync(this.nodeserverPath)) {
      //   this.nodeserverPath = path.join(this.resourcesPath, 'nodeserver');
      // }
    } else {
      this.userDataPath = path.join(__dirname, '..', 'data');
      this.resourcesPath = path.join(__dirname, '..', 'data');
      this.nodeserverPath = path.join(__dirname, '..', 'nodeserver');
      this.binaryPath = path.join(__dirname, '..', 'bin');
    }
    
    this.debugPaths();
  }

  getNodeServerPath() {
    return this.nodeserverPath;
  }

  getNodeServerAppJs() {
    return path.join(this.nodeserverPath, 'app.js');
  }

  getBinaryPath() {
    const platform = process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    return path.join(this.binaryPath, `${platform}-${arch}`);
  }

  getDataPath() {
    return this.userDataPath;
  }

  debugPaths() {
    console.log('=== PathManager Debug ===');
    console.log('isPackaged:', this.isPackaged);
    console.log('getNodeServerPath():', this.getNodeServerPath());
    console.log('getDataPath():', this.getDataPath());
    console.log('getBinaryPath():',this.getBinaryPath());
    console.log('nodeserver app.js exists:', fs.existsSync(this.getNodeServerAppJs()));
    // console.log('========================');
  }
}

const pathManager = new PathManager();

// 启动 Express 服务器
function startExpressServer() {

  // if(!systemInfo.support){
  //   console.error(`System is not supported: ${systemInfo.platform}-${systemInfo.arch} Skip start Express Server`);
  //   return;
  // }

  const env = Object.assign({}, process.env);

  process.env.ELECTRON_RUN = true;
  // data path
  process.env.LIT_NAME = "Lnfi-Node";
  process.env.LIT_DATA_PATH = path.join(pathManager.getDataPath());

  process.env.LIT_LOCAL_BASE_PATH = `${process.env.LIT_DATA_PATH}/${process.env.LIT_NAME}`;

  process.env.LIT_ENABLE_TOR = false;

  //port
  process.env.LND_RPC_PORT = '10009';
  process.env.LND_LISTEN_PORT = '9735';
  process.env.LND_REST_PORT = '8080';

  process.env.PORT = LINK_HTTP_PORT;
  process.env.LINK_HTTP_PORT = LINK_HTTP_PORT;
  process.env.BINARY_PATH = path.join(pathManager.getBinaryPath()); 

  process.env.LINK_OWNER = npub

  //rgb

  process.env.RGB_LISTENING_PORT = '3001';
  process.env.RGB_LDK_PEER_LISTENING_PORT = '9735';
  process.env.RGB_NETWORK = 'regtest';

  const nodeserverPath = pathManager.getNodeServerPath();
  const appJsPath = pathManager.getNodeServerAppJs();
  
  console.log('Nodeserver path:', nodeserverPath);
  console.log('App.js path:', appJsPath);
  console.log('Nodeserver exists:', fs.existsSync(nodeserverPath));
  console.log('App.js exists:', fs.existsSync(appJsPath));

  // let serverApp;
  // 使用 spawn 启动 Node.js 进程运行 app.js
  // if(pathManager.isPackaged){
  //   // serverProcess = fork(appJsPath, [], {
  //   //   cwd: nodeserverPath,
  //   //   env: env
  //   // });
  //   serverApp = require('../nodeserver/app.js');
  // }else{
  //   // serverProcess = fork(appJsPath,[], {
  //   //   cwd: nodeserverPath,
  //   //   env: env
  //   // });
  //   serverApp = require(appJsPath);
  // }
  // swpan('node','app.js')
  let serverApp = require('../nodeserver/app.js');
  console.log('Server started from asar');
    
  // 错误处理
  process.on('uncaughtException', (err) => {
    // pop window
    mainWindow.webContents.send('uncaughtException', err);
    console.error('Uncaught Exception:', err);
  });

  return serverApp;
  
  // // 监听标准输出
  // serverProcess.stdout.on('data', (data) => {
  //   console.log(`Express server: ${data}`);
  // });
  
  // // 监听错误输出
  // serverProcess.stderr.on('data', (data) => {
  //   console.error(`Express server error: ${data}`);
  // });
  
  // // 监听进程结束
  // serverProcess.on('close', (code) => {
  //   console.log(`Express server process exited with code ${code}`);
  //   serverProcess = null;
  // });
}

// // 启动 RGB Lightning Node
// function startRGBLightningNode(systemInfo) {
//   // if(!systemInfo.support){
//   //   console.error(`System is not supported: ${systemInfo.platform}-${systemInfo.arch}`);
//   //   return;
//   // }
//     const rgbNodePath = path.join(pathManager.getBinaryPath(), 'rgb-lightning-node'); //systemInfo.binaryPath + "/rgb-lightning-node";
    
//     console.log(`Starting RGB Lightning Node from: ${rgbNodePath}`);
//     console.log(`Starting RGB Lightning Node from: ${rgbNodePath}`);

//     // rgb-lightning-node dataldk0/ --daemon-listening-port 3001 \
//     // --ldk-peer-listening-port 9735 --network regtest
//     // rgb-lightning-node dataldk0/ --daemon-listening-port 3001 \
//     // --ldk-peer-listening-port 9735 --network regtest

//     let dataPath = path.join(pathManager.getDataPath('data'), 'rgb');

//     let args = [dataPath,'--daemon-listening-port','8001','--ldk-peer-listening-port','9735','--network','regtest'];
//     let args = [dataPath,'--daemon-listening-port','8001','--ldk-peer-listening-port','9735','--network','regtest'];
    
//     // 使用 spawn 启动 RGB Lightning Node
//     rgbNodeProcess = spawn(rgbNodePath, args, {
//       cwd: __dirname,
//       env: process.env,
//       // 确保二进制文件有执行权限
//       shell: true
//     });
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
//     // 监听标准输出
//     rgbNodeProcess.stdout.on('data', (data) => {
//       console.log(`RGB Lightning Node: ${data}`);
//     });
    
//     // 监听错误输出
//     rgbNodeProcess.stderr.on('data', (data) => {
//       console.error(`RGB Lightning Node error: ${data}`);
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
  // let systemInfo = getSystemInfo();
  // Start Express Server
  try{
    startExpressServer(); 
  }catch(error){
    log.error('Failed to start Express Server:', error);
  }
  // Start RGB Lightning Node
  // startRGBLightningNode();
  
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
    mainWindow.loadURL(`http://127.0.0.1:${LINK_HTTP_PORT}`);
    // mainWindow.loadURL('./src/index.html');
    // mainWindow.loadURL('index.html');
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
      console.log("🚀 ~ ipcMain.handle ~ eventData:", sk)
      let signedEvent = await finishEvent(eventData, sk)
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
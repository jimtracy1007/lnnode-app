const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// 保持对窗口对象的全局引用，避免 JavaScript 对象被垃圾回收时窗口关闭
let mainWindow;
let serverProcess = null;
let rgbNodeProcess = null;

// 启动 Express 服务器
function startExpressServer(systemInfo) {

  if(!systemInfo.support){
    console.error(`System is not supported: ${systemInfo.platform}-${systemInfo.arch} Skip start Express Server`);
    return;
  }
  const env = Object.assign({}, process.env);
  // 可以在这里设置额外的环境变量
  env.ELECTRON_RUN = 'true';
  env.LIT_DATA_PATH = path.join(__dirname, 'data');
  env.CUR_ENV = 'local';
  env.PORT = '8090';
  env.LINK_HTTP_PORT = '8090';
  env.BINARY_PATH = systemInfo.binaryPath;
  // 使用 spawn 启动 Node.js 进程运行 app.js
  serverProcess = spawn('node', ['nodeserver/app.js'], {
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
function startRGBLightningNode(systemInfo) {
  if(!systemInfo.support){
    console.error(`System is not supported: ${systemInfo.platform}-${systemInfo.arch}`);
    return;
  }
    const rgbNodePath = systemInfo.binaryPath + "/rgb-lightning-node";
    
    console.log(`Starting RGB Lightning Node from: ${rgbNodePath}`);

    // rgb-lightning-node dataldk0/ --daemon-listening-port 3001 \
    // --ldk-peer-listening-port 9735 --network regtest

    let dataPath = path.join(__dirname, 'data');

    let args = [dataPath,'--daemon-listening-port','8001','--ldk-peer-listening-port','9735','--network','regtest'];
    
    // 使用 spawn 启动 RGB Lightning Node
    rgbNodeProcess = spawn(rgbNodePath, args, {
      cwd: __dirname,
      env: process.env,
      // 确保二进制文件有执行权限
      shell: true
    });
    
    // 监听标准输出
    rgbNodeProcess.stdout.on('data', (data) => {
      console.log(`RGB Lightning Node: ${data}`);
    });
    
    // 监听错误输出
    rgbNodeProcess.stderr.on('data', (data) => {
      console.error(`RGB Lightning Node error: ${data}`);
    });
    
    // 监听进程结束
    rgbNodeProcess.on('close', (code) => {
      console.log(`RGB Lightning Node process exited with code ${code}`);
      rgbNodeProcess = null;
    });
  }

// get os type
function getSystemInfo() {
  const platform = process.platform;
  const arch = process.arch;

  console.log(`Platform: ${platform}-${arch}  ${__dirname}`);
  // get bin path 
  let binaryPath = path.join(__dirname, 'bin', `${platform}-${arch}`);
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

function createWindow() {
  let systemInfo = getSystemInfo();
  // Start Express Server
  startExpressServer(systemInfo);
  // Start RGB Lightning Node
  startRGBLightningNode(systemInfo);
  
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 等待一小段时间确保 Express 服务器已启动
  setTimeout(() => {
    // 加载应用的本地 URL
    // mainWindow.loadURL('https://devoflnnode.unift.xyz/#/');
    mainWindow.loadURL('http://127.0.0.1:8090');
    
    // mainWindow.webContents.openDevTools();
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
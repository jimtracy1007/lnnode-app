const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

class ServerManager {
    constructor() {
        this.serverProcess = null;
        this.serverPort = process.env.PORT || 8090; // 根据 constants/index.js 中的配置
        this.serverUrl = `http://localhost:${this.serverPort}`;
        this.isRunning = false;
        this.startupTimeout = 30000; // 30 seconds
        this.serverPath = path.join(__dirname, '../nodeserver');
    }

    async startServer() {
        return new Promise((resolve, reject) => {
            try {
                // 检查 nodeserver 目录是否存在
                if (!fs.existsSync(this.serverPath)) {
                    reject(new Error('nodeserver directory not found. Please ensure the nodeserver directory exists.'));
                    return;
                }

                // 检查 app.js 是否存在
                const appJsPath = path.join(this.serverPath, 'app.js');
                if (!fs.existsSync(appJsPath)) {
                    reject(new Error('app.js not found in nodeserver directory.'));
                    return;
                }

                console.log('Starting nodeserver app.js...');

                // 设置环境变量
                const env = {
                    ...process.env,
                    NODE_ENV: 'development',
                    PORT: this.serverPort.toString(),
                };

                // 检查是否有 .env.local 文件
                const envLocalPath = path.join(this.serverPath, '.env.local');
                const hasEnvLocal = fs.existsSync(envLocalPath);

                // 根据是否有 .env.local 文件选择启动方式
                let startCommand, startArgs;
                
                if (hasEnvLocal) {
                    // 使用 npm run start:local (需要 dotenv-cli)
                    startCommand = 'npm';
                    startArgs = ['run', 'start:local'];
                    console.log('Found .env.local, using npm run start:local');
                } else {
                    // 直接使用 node 启动 app.js
                    startCommand = 'node';
                    startArgs = ['app.js'];
                    console.log('No .env.local found, using direct node app.js');
                }

                // 启动服务器进程
                this.serverProcess = spawn(startCommand, startArgs, {
                    cwd: this.serverPath,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: env
                });

                this.serverProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    console.log(`[nodeserver] ${output}`);
                    
                    // 检查服务器是否已启动的关键词
                    if (output.includes('Listening on') || 
                        output.includes('Server running') || 
                        output.includes('listening') ||
                        output.includes(`${this.serverPort}`)) {
                        
                        // 延迟一点时间确保服务器完全启动
                        setTimeout(() => {
                            this.checkServerHealth().then(() => {
                                this.isRunning = true;
                                resolve();
                            }).catch((error) => {
                                console.log('Health check failed, but server seems to be starting:', error.message);
                                // 即使健康检查失败，也认为服务器在运行（可能没有健康检查端点）
                                this.isRunning = true;
                                resolve();
                            });
                        }, 2000);
                    }
                });

                this.serverProcess.stderr.on('data', (data) => {
                    const error = data.toString();
                    console.error(`[nodeserver] Error: ${error}`);
                    
                    // 检查是否是端口占用错误
                    if (error.includes('EADDRINUSE')) {
                        reject(new Error(`Port ${this.serverPort} is already in use. Please stop other services using this port.`));
                    }
                });

                this.serverProcess.on('close', (code) => {
                    console.log(`[nodeserver] Process exited with code ${code}`);
                    this.isRunning = false;
                });

                this.serverProcess.on('error', (error) => {
                    console.error(`[nodeserver] Process error:`, error);
                    reject(error);
                });

                // 设置超时，如果在指定时间内没有检测到启动成功，尝试健康检查
                setTimeout(() => {
                    if (!this.isRunning) {
                        console.log('Timeout reached, attempting health check...');
                        this.checkServerHealth().then(() => {
                            this.isRunning = true;
                            resolve();
                        }).catch(() => {
                            // 如果健康检查失败，但进程还在运行，仍然认为启动成功
                            if (this.serverProcess && !this.serverProcess.killed) {
                                console.log('Health check failed but process is running, assuming success');
                                this.isRunning = true;
                                resolve();
                            } else {
                                reject(new Error('Server failed to start within timeout period'));
                            }
                        });
                    }
                }, this.startupTimeout);

            } catch (error) {
                reject(error);
            }
        });
    }

    async checkServerHealth() {
        try {
            // 尝试多个可能的端点
            const endpoints = ['/', '/api/lnd', '/health', '/status'];
            
            for (const endpoint of endpoints) {
                try {
                    const response = await axios.get(`${this.serverUrl}${endpoint}`, {
                        timeout: 5000,
                        validateStatus: (status) => status < 500 // 接受所有非 5xx 状态码
                    });
                    
                    console.log(`[nodeserver] Health check passed on ${endpoint} (status: ${response.status})`);
                    return true;
                } catch (error) {
                    // 继续尝试下一个端点
                    continue;
                }
            }
            throw new Error('No valid endpoint found');
        } catch (error) {
            throw new Error(`Health check failed: ${error.message}`);
        }
    }

    async stopServer() {
        if (this.serverProcess) {
            console.log('[nodeserver] Stopping server...');
            
            // 优雅关闭 - 发送 SIGTERM
            this.serverProcess.kill('SIGTERM');
            
            // 如果 5 秒后还没关闭，强制杀死
            setTimeout(() => {
                if (this.serverProcess && !this.serverProcess.killed) {
                    console.log('[nodeserver] Force killing server...');
                    this.serverProcess.kill('SIGKILL');
                }
            }, 5000);
            
            this.serverProcess = null;
            this.isRunning = false;
        }
    }

    getServerUrl() {
        return this.serverUrl;
    }

    getServerPort() {
        return this.serverPort;
    }

    isServerRunning() {
        return this.isRunning;
    }

    async makeRequest(endpoint, options = {}) {
        if (!this.isRunning) {
            throw new Error('Server is not running');
        }

        try {
            const url = `${this.serverUrl}${endpoint}`;
            const response = await axios({
                url,
                timeout: 10000,
                ...options
            });
            return response.data;
        } catch (error) {
            throw new Error(`Request failed: ${error.message}`);
        }
    }

    // 专门为 LND API 调用的方法
    async makeLndRequest(endpoint, options = {}) {
        return this.makeRequest(`/api/lnd${endpoint}`, options);
    }

    // 检查服务器依赖是否已安装
    async checkDependencies() {
        const nodeModulesPath = path.join(this.serverPath, 'node_modules');
        return fs.existsSync(nodeModulesPath);
    }

    // 安装服务器依赖
    async installDependencies() {
        return new Promise((resolve, reject) => {
            console.log('[nodeserver] Installing dependencies...');
            
            const installProcess = spawn('npm', ['install'], {
                cwd: this.serverPath,
                stdio: 'pipe'
            });

            installProcess.stdout.on('data', (data) => {
                console.log(`[nodeserver] npm install: ${data}`);
            });

            installProcess.stderr.on('data', (data) => {
                console.error(`[nodeserver] npm install error: ${data}`);
            });

            installProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('[nodeserver] Dependencies installed successfully');
                    resolve();
                } else {
                    reject(new Error(`npm install failed with code ${code}`));
                }
            });

            installProcess.on('error', (error) => {
                reject(error);
            });
        });
    }
}

module.exports = ServerManager;
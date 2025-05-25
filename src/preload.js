const { contextBridge, ipcRenderer } = require('electron');

// 暴露受保护的方法
contextBridge.exposeInMainWorld('electronAPI', {
    // 获取应用版本
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // nodeserver 相关 API
    getServerStatus: () => ipcRenderer.invoke('get-server-status'),
    restartServer: () => ipcRenderer.invoke('restart-server'),
    installServerDependencies: () => ipcRenderer.invoke('install-server-dependencies'),
    
    // 通用服务器请求
    makeServerRequest: (endpoint, options) => ipcRenderer.invoke('make-server-request', endpoint, options),
    
    // LND API 专用请求
    makeLndRequest: (endpoint, options) => ipcRenderer.invoke('make-lnd-request', endpoint, options),
    
    // 监听来自主进程的消息
    onServerStatus: (callback) => ipcRenderer.on('server-status', callback),
    onShowServerStatus: (callback) => ipcRenderer.on('show-server-status', callback),
    
    // 移除监听器
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// 在窗口加载完成时执行
window.addEventListener('DOMContentLoaded', () => {
    console.log('Preload script loaded with nodeserver integration');
}); 
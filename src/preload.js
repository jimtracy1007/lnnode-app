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

// 暴露 Nostr API 到 window.nostr
contextBridge.exposeInMainWorld('nostr', {
  
  // 获取公钥
  getPublicKey: () => ipcRenderer.invoke('nostr-get-public-key'),
  
  // 签名事件
  signEvent: (event) => ipcRenderer.invoke('nostr-sign-event', event),
  
  // 获取中继列表
  getRelays: () => ipcRenderer.invoke('nostr-get-relays'),
  
  // NIP-04: 加密消息
  nip04: {
      encrypt: (pubkey, plaintext) => ipcRenderer.invoke('nostr-nip04-encrypt', pubkey, plaintext),
      decrypt: (pubkey, ciphertext) => ipcRenderer.invoke('nostr-nip04-decrypt', pubkey, ciphertext)
  },
  
  // NIP-44: 加密消息 (新版本)
  nip44: {
      encrypt: (pubkey, plaintext) => ipcRenderer.invoke('nostr-nip44-encrypt', pubkey, plaintext),
      decrypt: (pubkey, ciphertext) => ipcRenderer.invoke('nostr-nip44-decrypt', pubkey, ciphertext)
  },
  
  // 启用/禁用 Nostr 功能
  enable: () => ipcRenderer.invoke('nostr-enable'),
  
  // 检查是否已启用
  isEnabled: () => ipcRenderer.invoke('nostr-is-enabled')
});

// 在窗口加载完成时执行
window.addEventListener('DOMContentLoaded', () => {
    console.log('Preload script loaded with nodeserver integration');


  if (window.nostr) {
      console.log('✅ window.nostr is available');
  } else {
      console.warn('❌ window.nostr is not available');
  }
}); 
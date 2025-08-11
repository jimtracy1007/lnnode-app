const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods
contextBridge.exposeInMainWorld('electronAPI', {
    // Get application version
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // nodeserver related API
    getServerStatus: () => ipcRenderer.invoke('get-server-status'),
    restartServer: () => ipcRenderer.invoke('restart-server'),
    installServerDependencies: () => ipcRenderer.invoke('install-server-dependencies'),
    
    // General server requests
    makeServerRequest: (endpoint, options) => ipcRenderer.invoke('make-server-request', endpoint, options),
    
    // LND API specific requests
    makeLndRequest: (endpoint, options) => ipcRenderer.invoke('make-lnd-request', endpoint, options),
    
    // Listen for messages from the main process
    onServerStatus: (callback) => ipcRenderer.on('server-status', callback),
    onShowServerStatus: (callback) => ipcRenderer.on('show-server-status', callback),
    
    // Remove listeners
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// Expose Nostr API to window.nostr
contextBridge.exposeInMainWorld('nostr', {
  
  // Get public key
  getPublicKey: () => ipcRenderer.invoke('nostr-get-public-key'),

  getNpub: () => ipcRenderer.invoke('nostr-get-npub'),
  
  // Sign event
  signEvent: (event) => ipcRenderer.invoke('nostr-sign-event', event),
  
  // Get relay list
  getRelays: () => ipcRenderer.invoke('nostr-get-relays'),
  
  // NIP-04: Encrypt message
  nip04: {
      encrypt: (pubkey, plaintext) => ipcRenderer.invoke('nostr-nip04-encrypt', pubkey, plaintext),
      decrypt: (pubkey, ciphertext) => ipcRenderer.invoke('nostr-nip04-decrypt', pubkey, ciphertext)
  },
  
  // NIP-44: Encrypt message (new version)
  nip44: {
      encrypt: (pubkey, plaintext) => ipcRenderer.invoke('nostr-nip44-encrypt', pubkey, plaintext),
      decrypt: (pubkey, ciphertext) => ipcRenderer.invoke('nostr-nip44-decrypt', pubkey, ciphertext)
  },
  
  // Enable/Disable Nostr features
  enable: () => ipcRenderer.invoke('nostr-enable'),
  
  // Check if enabled
  isEnabled: () => ipcRenderer.invoke('nostr-is-enabled')
});

// Execute when window is loaded
window.addEventListener('DOMContentLoaded', () => {
    console.log('Preload script loaded with nodeserver integration');
}); 
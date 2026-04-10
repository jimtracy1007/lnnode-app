const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods
contextBridge.exposeInMainWorld('electronAPI', {
    // Get application version
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // nodeserver related API
    getServerStatus: () => ipcRenderer.invoke('get-server-status'),
    restartServer: () => ipcRenderer.invoke('restart-server'),

    // NOTE: `installServerDependencies`, `makeServerRequest` and
    // `makeLndRequest` previously lived here but had no corresponding
    // `ipcMain.handle` anywhere in the main process, so any renderer
    // call would have thrown `No handler registered for ...`. Removed
    // to keep the preload/main contract honest.

    // Listen for messages from the main process
    onServerStatus: (callback) => ipcRenderer.on('server-status', callback),
    onShowServerStatus: (callback) => ipcRenderer.on('show-server-status', callback),
    
    // Open external URL in default browser
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    
    // Navigate back to the local welcome page (for external sites like devoflnnode.unift.xyz)
    navigateToWelcome: () => ipcRenderer.invoke('navigate-to-welcome'),
    
    // Remove listeners
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// Expose welcome-page API to window.welcomeAPI.
//
// Only visible to the welcome.html page but also present during the
// regular lnlink-server UI session (Electron preloads run in every
// navigation of the same BrowserWindow). That's fine: the handlers
// themselves do nothing dangerous outside the welcome flow, and the
// lnlink-server UI never references window.welcomeAPI.
contextBridge.exposeInMainWorld('welcomeAPI', {
  startServices: () => ipcRenderer.invoke('welcome:start'),
  backupNow: () => ipcRenderer.invoke('welcome:backup'),
  clearAllData: () => ipcRenderer.invoke('welcome:clear'),
  getInfo: () => ipcRenderer.invoke('welcome:info'),
  openDataDir: () => ipcRenderer.invoke('welcome:open-data-dir'),
  confirm: (opts) => ipcRenderer.invoke('welcome:confirm', opts),
  quit: () => ipcRenderer.invoke('welcome:quit'),
  versionCheck: () => ipcRenderer.invoke('welcome:version-check'),
  resetLdk: () => ipcRenderer.invoke('welcome:reset-ldk'),
  acknowledgeVersion: () => ipcRenderer.invoke('welcome:acknowledge-version'),
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
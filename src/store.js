const Store = require('electron-store');
const { generatePrivateKey } = require("nostr-tools")
// const { bytesToHex } = require('@noble/hashes/utils') 
// Create store instance
const store = new Store({
    name: 'app-config',
    defaults: {
        windowBounds: { width: 1200, height: 800 },
        userPreferences: {
            theme: 'dark',
            language: 'en'
        },
        nostrSettings: {
            enabled: false,
            relays: []
        }
    }
});
const getPrivateKey = () => {
    let key = "privateKey";
    if(!store.has(key)){
        store.set(key, generatePrivateKey());
    }
      
    return store.get(key);
}

module.exports = {
    getPrivateKey
}; 
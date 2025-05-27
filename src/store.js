const Store = require('electron-store');
const { generatePrivateKey } = require("nostr-tools")
// const { bytesToHex } = require('@noble/hashes/utils') 
// 创建存储实例
const store = new Store({
    name: 'app-config', // 文件名
    defaults: {
        windowBounds: { width: 1200, height: 800 },
        userPreferences: {
            theme: 'light',
            language: 'zh-CN'
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
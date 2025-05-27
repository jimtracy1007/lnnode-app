const { nip19, nip04, getPublicKey, finishEvent } = require("nostr-tools");
const store = require('../store');
const log = require('../utils/logger');

class NostrService {
  constructor() {
    this.enabled = true;
    this.sk = this._getPrivateKey();
    this.publicKey = getPublicKey(this.sk);
    this.npub = nip19.npubEncode(this.publicKey);
    
    // Default relay list
    this.defaultRelays = [
      'wss://relay.damus.io',
      'wss://relay.nostr.band',
      'wss://nos.lol',
      'wss://relay.nostr.info',
      'wss://relay.snort.social'
    ];
    
    log.info("Nostr service initialized with npub:", this.npub);
  }

  _getPrivateKey() {
    return store.getPrivateKey();
  }

  getPublicKey() {
    return this.publicKey;
  }

  getNpub() {
    return this.npub;
  }

  async signEvent(eventData) {
    try {
      if (!this.enabled) {
        throw new Error('Nostr is not enabled');
      }
      let signedEvent = await finishEvent(eventData, this.sk);
      return signedEvent;
    } catch (error) {
      throw new Error(`Failed to sign event: ${error.message}`);
    }
  }

  getRelays() {
    try {
      if (!this.enabled) {
        throw new Error('Nostr is not enabled');
      }
      // Default relay list with read/write settings
      return {
        'wss://relay01.lnfi.network': { read: true, write: true },
        'wss://relay02.lnfi.network': { read: true, write: true },
        'wss://nostr-01.yakihonne.com': { read: true, write: true },
        'wss://nostr-02.yakihonne.com': { read: true, write: true },
      };
    } catch (error) {
      throw new Error(`Failed to get relays: ${error.message}`);
    }
  }

  async encrypt(pubkey, plaintext) {
    try {
      if (!this.enabled) {
        throw new Error('Nostr is not enabled');
      }
      return nip04.encrypt(this.sk, pubkey, plaintext);
    } catch (error) {
      throw new Error(`Failed to encrypt: ${error.message}`);
    }
  }

  async decrypt(pubkey, ciphertext) {
    try {
      if (!this.enabled) {
        throw new Error('Nostr is not enabled');
      }
      return nip04.decrypt(this.sk, pubkey, ciphertext);
    } catch (error) {
      throw new Error(`Failed to decrypt: ${error.message}`);
    }
  }

  isEnabled() {
    return this.enabled;
  }

  enable() {
    this.enabled = true;
    return true;
  }

  disable() {
    this.enabled = false;
    return true;
  }
}

module.exports = new NostrService(); 
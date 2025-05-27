const { ipcMain } = require('electron');
const log = require('../utils/logger');
const nostrService = require('../services/nostr-service');

// Register all Nostr IPC handlers
function registerNostrHandlers() {
  // Get public key
  ipcMain.handle('nostr-get-public-key', async () => {
    try {
      if (!nostrService.isEnabled()) {
        throw new Error('Nostr is not enabled');
      }
      return nostrService.getPublicKey();
    } catch (error) {
      log.error('Failed to get public key:', error);
      throw new Error(`Failed to get public key: ${error.message}`);
    }
  });

  // Get npub
  ipcMain.handle('nostr-get-npub', async () => {
    try {
      return nostrService.getNpub();
    } catch (error) {
      log.error('Failed to get npub:', error);
      throw error;
    }
  });

  // Sign event
  ipcMain.handle('nostr-sign-event', async (event, eventData) => {
    try {
      return await nostrService.signEvent(eventData);
    } catch (error) {
      log.error('Failed to sign event:', error);
      throw error;
    }
  });

  // Get relays
  ipcMain.handle('nostr-get-relays', async () => {
    try {
      return nostrService.getRelays();
    } catch (error) {
      log.error('Failed to get relays:', error);
      throw error;
    }
  });

  // NIP-04 encrypt
  ipcMain.handle('nostr-nip04-encrypt', async (event, pubkey, plaintext) => {
    try {
      return await nostrService.encrypt(pubkey, plaintext);
    } catch (error) {
      log.error('Failed to encrypt:', error);
      throw error;
    }
  });

  // NIP-04 decrypt
  ipcMain.handle('nostr-nip04-decrypt', async (event, pubkey, ciphertext) => {
    try {
      return await nostrService.decrypt(pubkey, ciphertext);
    } catch (error) {
      log.error('Failed to decrypt:', error);
      throw error;
    }
  });

  // Enable Nostr
  ipcMain.handle('nostr-enable', async () => {
    try {
      return nostrService.enable();
    } catch (error) {
      log.error('Failed to enable Nostr:', error);
      throw error;
    }
  });

  // Check if Nostr is enabled
  ipcMain.handle('nostr-is-enabled', async () => {
    return nostrService.isEnabled();
  });

  log.info('Nostr IPC handlers registered');
}

module.exports = { registerNostrHandlers }; 
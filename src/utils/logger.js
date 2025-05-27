const log = require('electron-log');

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

module.exports = log; 
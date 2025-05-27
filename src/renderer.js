// Renderer process script
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Renderer process loaded');
    
    // Initialize application
    await initializeApp();
    
    // Set up navigation
    setupNavigation();
    
    // Set up event listeners
    setupEventListeners();
    
    // Load application version
    await loadAppVersion();
});

// Initialize application
async function initializeApp() {
    console.log('Initializing Lightning Network Node App...');
    
    // Simulate initialization process
    updateSyncStatus('Initializing...');
    
    // Here you can add actual initialization logic
    // For example: connecting to Lightning Network node, loading configurations, etc.
    
    setTimeout(() => {
        updateSyncStatus('Not Connected');
    }, 2000);
}

// Set up navigation functionality
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const targetSection = link.getAttribute('data-section');
            
            // Remove all active states
            navLinks.forEach(l => l.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));
            
            // Add active state
            link.classList.add('active');
            const targetPage = document.getElementById(targetSection);
            if (targetPage) {
                targetPage.classList.add('active');
            }
            
            // Update page content
            updatePageContent(targetSection);
        });
    });
}

// Set up event listeners
function setupEventListeners() {
    // Set up button click events
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            switchToPage('settings');
        });
    }
    
    // Wallet operation buttons
    setupWalletActions();
    
    // Channel operation buttons
    setupChannelActions();
    
    // Set up settings form handling
    setupSettingsForm();
}

// Set up wallet operations
function setupWalletActions() {
    const walletActions = document.querySelector('.wallet-actions');
    if (walletActions) {
        const buttons = walletActions.querySelectorAll('.btn');
        buttons.forEach(button => {
            button.addEventListener('click', (e) => {
                const action = e.target.textContent.trim();
                handleWalletAction(action);
            });
        });
    }
}

// Set up channel operations
function setupChannelActions() {
    const channelActions = document.querySelector('.channel-actions');
    if (channelActions) {
        const buttons = channelActions.querySelectorAll('.btn');
        buttons.forEach(button => {
            button.addEventListener('click', (e) => {
                const action = e.target.textContent.trim();
                handleChannelAction(action);
            });
        });
    }
}

// Set up settings form
function setupSettingsForm() {
    const settingsInputs = document.querySelectorAll('#settings input, #settings select');
    settingsInputs.forEach(input => {
        input.addEventListener('change', (e) => {
            handleSettingChange(e.target);
        });
    });
}

// Handle wallet operations
function handleWalletAction(action) {
    console.log(`Wallet action: ${action}`);
    
    switch (action) {
        case 'Receive':
            showReceiveDialog();
            break;
        case 'Send':
            showSendDialog();
            break;
        case 'Generate Address':
            generateNewAddress();
            break;
        default:
            console.log(`Unknown wallet action: ${action}`);
    }
}

// Handle channel operations
function handleChannelAction(action) {
    console.log(`Channel action: ${action}`);
    
    switch (action) {
        case 'Open Channel':
            showOpenChannelDialog();
            break;
        case 'Close Channel':
            showCloseChannelDialog();
            break;
        default:
            console.log(`Unknown channel action: ${action}`);
    }
}

// Handle setting changes
function handleSettingChange(input) {
    const setting = input.name || input.id;
    const value = input.value;
    
    console.log(`Setting changed: ${setting} = ${value}`);
    
    // Here you can save settings to local storage or send to main process
    localStorage.setItem(`setting_${setting}`, value);
}

// Switch to specified page
function switchToPage(pageId) {
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');
    
    // Remove all active states
    navLinks.forEach(l => l.classList.remove('active'));
    pages.forEach(p => p.classList.remove('active'));
    
    // Add active state
    const targetLink = document.querySelector(`[data-section="${pageId}"]`);
    const targetPage = document.getElementById(pageId);
    
    if (targetLink) targetLink.classList.add('active');
    if (targetPage) targetPage.classList.add('active');
    
    updatePageContent(pageId);
}

// Update page content
function updatePageContent(pageId) {
    switch (pageId) {
        case 'dashboard':
            updateDashboard();
            break;
        case 'wallet':
            updateWallet();
            break;
        case 'channels':
            updateChannels();
            break;
        case 'transactions':
            updateTransactions();
            break;
        case 'settings':
            updateSettings();
            break;
    }
}

// Update dashboard
function updateDashboard() {
    console.log('Updating dashboard...');
    
    // Here you can add actual data update logic
    // For example: getting latest data from Lightning Network node
    
    // Simulate data update
    updateStatCard('Balance', '0.00000000 BTC', 'On-chain Balance');
    updateStatCard('Lightning Network Balance', '0 sats', 'Available for Payments');
    updateStatCard('Active Channels', '0', 'Established Channels');
    updateStatCard('Node Status', 'Offline', 'Sync Status');
}

// Update stat card
function updateStatCard(title, value, label) {
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach(card => {
        const cardTitle = card.querySelector('h3');
        if (cardTitle && cardTitle.textContent === title) {
            const valueElement = card.querySelector('.stat-value');
            const labelElement = card.querySelector('.stat-label');
            
            if (valueElement) valueElement.textContent = value;
            if (labelElement) labelElement.textContent = label;
        }
    });
}

// Update wallet page
function updateWallet() {
    console.log('Updating wallet...');
    // Implement wallet data update logic
}

// Update channels page
function updateChannels() {
    console.log('Updating channels...');
    // Implement channel data update logic
}

// Update transactions page
function updateTransactions() {
    console.log('Updating transactions...');
    // Implement transaction record update logic
}

// Update settings page
function updateSettings() {
    console.log('Updating settings...');
    
    // Load settings from local storage
    loadSettingsFromStorage();
}

// Load settings from local storage
function loadSettingsFromStorage() {
    const settingsInputs = document.querySelectorAll('#settings input, #settings select');
    settingsInputs.forEach(input => {
        const setting = input.name || input.id;
        const savedValue = localStorage.getItem(`setting_${setting}`);
        
        if (savedValue) {
            input.value = savedValue;
        }
    });
}

// Show receive dialog
function showReceiveDialog() {
    alert('Receive functionality is under development...');
    // Here you can implement actual receive address generation and display
}

// Show send dialog
function showSendDialog() {
    alert('Send functionality is under development...');
    // Here you can implement actual send transaction interface
}

// Generate new address
function generateNewAddress() {
    alert('Address generation functionality is under development...');
    // Here you can implement actual address generation logic
}

// Show open channel dialog
function showOpenChannelDialog() {
    alert('Open channel functionality is under development...');
    // Here you can implement actual channel opening interface
}

// Show close channel dialog
function showCloseChannelDialog() {
    alert('Close channel functionality is under development...');
    // Here you can implement actual channel closing interface
}

// Update sync status
function updateSyncStatus(status) {
    const syncStatusElement = document.getElementById('syncStatus');
    if (syncStatusElement) {
        syncStatusElement.textContent = status;
    }
}

// Update node status
function updateNodeStatus(isOnline) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (statusDot && statusText) {
        if (isOnline) {
            statusDot.classList.remove('offline');
            statusDot.classList.add('online');
            statusText.textContent = 'Online';
        } else {
            statusDot.classList.remove('online');
            statusDot.classList.add('offline');
            statusText.textContent = 'Offline';
        }
    }
}

// Load application version
async function loadAppVersion() {
    try {
        if (window.electronAPI && window.electronAPI.getAppVersion) {
            const version = await window.electronAPI.getAppVersion();
            const versionElement = document.getElementById('appVersion');
            if (versionElement) {
                versionElement.textContent = version;
            }
        }
    } catch (error) {
        console.error('Failed to load app version:', error);
    }
}

// Utility function: format number
function formatNumber(num, decimals = 8) {
    return parseFloat(num).toFixed(decimals);
}

// Utility function: format time
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString('en-US');
}

// Utility function: show notification
function showNotification(message, type = 'info') {
    console.log(`${type.toUpperCase()}: ${message}`);
    // Here you can implement actual notification display logic
}

// Error handling
window.addEventListener('error', (event) => {
    console.error('Application error:', event.error);
    showNotification('An application error occurred. Please check the console for details.', 'error');
});

// Unhandled Promise rejection
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showNotification('An unhandled error occurred', 'error');
}); 
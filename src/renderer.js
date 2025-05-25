// 渲染进程脚本
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Renderer process loaded');
    
    // 初始化应用
    await initializeApp();
    
    // 设置导航
    setupNavigation();
    
    // 设置事件监听器
    setupEventListeners();
    
    // 加载应用版本
    await loadAppVersion();
});

// 初始化应用
async function initializeApp() {
    console.log('Initializing Lightning Network Node App...');
    
    // 模拟初始化过程
    updateSyncStatus('正在初始化...');
    
    // 这里可以添加实际的初始化逻辑
    // 例如：连接到 Lightning Network 节点、加载配置等
    
    setTimeout(() => {
        updateSyncStatus('未连接');
    }, 2000);
}

// 设置导航功能
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const targetSection = link.getAttribute('data-section');
            
            // 移除所有活跃状态
            navLinks.forEach(l => l.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));
            
            // 添加活跃状态
            link.classList.add('active');
            const targetPage = document.getElementById(targetSection);
            if (targetPage) {
                targetPage.classList.add('active');
            }
            
            // 更新页面内容
            updatePageContent(targetSection);
        });
    });
}

// 设置事件监听器
function setupEventListeners() {
    // 设置按钮点击事件
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            switchToPage('settings');
        });
    }
    
    // 钱包操作按钮
    setupWalletActions();
    
    // 通道操作按钮
    setupChannelActions();
    
    // 设置表单处理
    setupSettingsForm();
}

// 设置钱包操作
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

// 设置通道操作
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

// 设置设置表单
function setupSettingsForm() {
    const settingsInputs = document.querySelectorAll('#settings input, #settings select');
    settingsInputs.forEach(input => {
        input.addEventListener('change', (e) => {
            handleSettingChange(e.target);
        });
    });
}

// 处理钱包操作
function handleWalletAction(action) {
    console.log(`Wallet action: ${action}`);
    
    switch (action) {
        case '接收':
            showReceiveDialog();
            break;
        case '发送':
            showSendDialog();
            break;
        case '生成地址':
            generateNewAddress();
            break;
        default:
            console.log(`Unknown wallet action: ${action}`);
    }
}

// 处理通道操作
function handleChannelAction(action) {
    console.log(`Channel action: ${action}`);
    
    switch (action) {
        case '打开通道':
            showOpenChannelDialog();
            break;
        case '关闭通道':
            showCloseChannelDialog();
            break;
        default:
            console.log(`Unknown channel action: ${action}`);
    }
}

// 处理设置变更
function handleSettingChange(input) {
    const setting = input.name || input.id;
    const value = input.value;
    
    console.log(`Setting changed: ${setting} = ${value}`);
    
    // 这里可以保存设置到本地存储或发送到主进程
    localStorage.setItem(`setting_${setting}`, value);
}

// 切换到指定页面
function switchToPage(pageId) {
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');
    
    // 移除所有活跃状态
    navLinks.forEach(l => l.classList.remove('active'));
    pages.forEach(p => p.classList.remove('active'));
    
    // 添加活跃状态
    const targetLink = document.querySelector(`[data-section="${pageId}"]`);
    const targetPage = document.getElementById(pageId);
    
    if (targetLink) targetLink.classList.add('active');
    if (targetPage) targetPage.classList.add('active');
    
    updatePageContent(pageId);
}

// 更新页面内容
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

// 更新仪表板
function updateDashboard() {
    console.log('Updating dashboard...');
    
    // 这里可以添加实际的数据更新逻辑
    // 例如：从 Lightning Network 节点获取最新数据
    
    // 模拟数据更新
    updateStatCard('余额', '0.00000000 BTC', '链上余额');
    updateStatCard('闪电网络余额', '0 sats', '可用于支付');
    updateStatCard('活跃通道', '0', '已建立的通道');
    updateStatCard('节点状态', '离线', '同步状态');
}

// 更新统计卡片
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

// 更新钱包页面
function updateWallet() {
    console.log('Updating wallet...');
    // 实现钱包数据更新逻辑
}

// 更新通道页面
function updateChannels() {
    console.log('Updating channels...');
    // 实现通道数据更新逻辑
}

// 更新交易记录页面
function updateTransactions() {
    console.log('Updating transactions...');
    // 实现交易记录更新逻辑
}

// 更新设置页面
function updateSettings() {
    console.log('Updating settings...');
    
    // 从本地存储加载设置
    loadSettingsFromStorage();
}

// 从本地存储加载设置
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

// 显示接收对话框
function showReceiveDialog() {
    alert('接收功能正在开发中...');
    // 这里可以实现实际的接收地址生成和显示
}

// 显示发送对话框
function showSendDialog() {
    alert('发送功能正在开发中...');
    // 这里可以实现实际的发送交易界面
}

// 生成新地址
function generateNewAddress() {
    alert('地址生成功能正在开发中...');
    // 这里可以实现实际的地址生成逻辑
}

// 显示打开通道对话框
function showOpenChannelDialog() {
    alert('打开通道功能正在开发中...');
    // 这里可以实现实际的通道打开界面
}

// 显示关闭通道对话框
function showCloseChannelDialog() {
    alert('关闭通道功能正在开发中...');
    // 这里可以实现实际的通道关闭界面
}

// 更新同步状态
function updateSyncStatus(status) {
    const syncStatusElement = document.getElementById('syncStatus');
    if (syncStatusElement) {
        syncStatusElement.textContent = status;
    }
}

// 更新节点状态
function updateNodeStatus(isOnline) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (statusDot && statusText) {
        if (isOnline) {
            statusDot.classList.remove('offline');
            statusDot.classList.add('online');
            statusText.textContent = '在线';
        } else {
            statusDot.classList.remove('online');
            statusDot.classList.add('offline');
            statusText.textContent = '离线';
        }
    }
}

// 加载应用版本
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

// 工具函数：格式化数字
function formatNumber(num, decimals = 8) {
    return parseFloat(num).toFixed(decimals);
}

// 工具函数：格式化时间
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString('zh-CN');
}

// 工具函数：显示通知
function showNotification(message, type = 'info') {
    console.log(`${type.toUpperCase()}: ${message}`);
    // 这里可以实现实际的通知显示逻辑
}

// 错误处理
window.addEventListener('error', (event) => {
    console.error('Application error:', event.error);
    showNotification('应用程序发生错误，请查看控制台获取详细信息', 'error');
});

// 未处理的 Promise 拒绝
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showNotification('发生未处理的错误', 'error');
}); 
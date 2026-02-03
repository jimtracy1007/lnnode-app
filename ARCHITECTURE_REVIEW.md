# lnlink-app 架构审查报告

## 概述

本文档对 `lnlink-app` 项目的当前架构进行审查，识别存在的问题并提出优化建议。

---

## 当前架构分析

### 核心模块

| 文件 | 职责 | 代码行数 |
|------|------|----------|
| `src/main.js` | Electron 主进程入口，应用生命周期管理 | 253 |
| `src/services/express-server.js` | lnlink-server 封装，服务器启动/停止 | 255 |
| `src/services/process-manager.js` | 子进程跟踪与清理 | 213 |
| `src/services/nostr-service.js` | Nostr 密钥管理与签名 | 99 |

### 依赖关系

```
main.js
├── express-server.js
│   ├── nostr-service.js
│   ├── path-manager.js
│   └── lnlink-server (npm package)
├── process-manager.js
└── window-manager.js
```

---

## 发现的问题

### 1. 进程管理逻辑重复 ⚠️ 高优先级

**问题**: 进程扫描和跟踪逻辑在多处重复实现。

| 位置 | 重复代码 |
|------|----------|
| `main.js:78-119` | `checkForRemainingProcesses()` 函数 |
| `express-server.js:66-119` | `checkAndTrackProcess()` 方法 |

两者都使用 `ps-list` 扫描 `litd` 和 `rgb-lightning-node` 进程，创建相同的 `mockProcess` 对象。

**影响**:
- 代码维护困难，修改需同步多处
- 增加了 bug 引入的风险
- 违反单一职责原则 (SRP)

### 2. ExpressServer 职责过重 ⚠️ 中优先级

**问题**: `ExpressServer` 类承担了过多不相关的职责：

- ✅ 服务器生命周期管理（合理）
- ✅ 端口检测与分配（合理）
- ❌ 外部进程跟踪（应移到 ProcessManager）
- ❌ 全局环境变量设置（应提取为配置模块）

**代码片段** (`express-server.js:161-189`):
```javascript
// 直接修改 process.env，污染全局状态
if (!process.env.LINK_NOSTR_NODE_NPUBKEY) {
  process.env.LINK_NOSTR_NODE_NPUBKEY = '027d2f...';
}
// ... 更多环境变量设置
```

### 3. 配置管理分散 ⚠️ 中优先级

**问题**: 配置值硬编码在多个文件中：

| 配置项 | 位置 |
|--------|------|
| 默认端口 `8091` | `express-server.js:16` |
| Nostr relay URI | `express-server.js:168` |
| 报告地址 | `express-server.js:171` |
| RGB 端口 | `express-server.js:180` |

**建议**: 创建 `src/config/defaults.js` 集中管理。

### 4. 清理流程存在竞态条件 ⚠️ 低优先级

**问题**: `main.js` 中的 `performCleanup()` 使用 `setTimeout` 进行最终验证，可能导致应用在清理完成前退出。

```javascript
// main.js:147-159
setTimeout(async () => {
  // 清理验证逻辑
}, 2000);
```

---

## 重构建议

### 方案一：集中进程管理（推荐）

将所有进程扫描和跟踪逻辑移到 `ProcessManager`：

```javascript
// process-manager.js 新增方法
async scanAndTrackProcesses() {
  const { default: psList } = await import('ps-list');
  const list = await psList();
  
  // 扫描 litd
  if (!this.litdProcess) {
    const lit = list.find(p => /\blitd\b/.test(`${p.name} ${p.cmd || ''}`));
    if (lit?.pid) this.setLitdProcess(this._createMockProcess(lit.pid, 'litd'));
  }
  
  // 扫描 rgb-lightning-node
  if (!this.rgbNodeProcess) {
    const rgb = list.find(p => /rgb-lightning-node/.test(`${p.name} ${p.cmd || ''}`));
    if (rgb?.pid) this.setRgbNodeProcess(this._createMockProcess(rgb.pid, 'rgb'));
  }
}
```

### 方案二：提取配置模块

创建 `src/config/defaults.js`：

```javascript
module.exports = {
  server: {
    defaultPort: 8091,
    portRange: [8091, 8092, 8093, 8094, 8095, 8096],
  },
  nostr: {
    nodePubkey: '027d2f1be71dc24c60b15070489d4ef274dd6aac236d02c67c76d6935defba56a6',
    nodeHost: 'regtest.lnfi.network:9735',
    relayUri: 'wss://relay.snort.social',
  },
  rgb: {
    host: 'localhost',
    ldkPeerListeningPort: 9750,
  },
  report: {
    baseUrl: 'https://devoffaucet.unift.xyz',
    address: 'npub1q7amuklx0fjw76dtulzzhhjmff8du5lyngw377d89hhrmj49w48ssltn7y',
  },
};
```

### 方案三：简化 ExpressServer

重构后的 `ExpressServer` 应只关注：

1. 端口检测与分配
2. lnlink-server 实例创建
3. 服务器启动/停止

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/services/process-manager.js` | 修改 | 新增 `scanAndTrackProcesses()` 方法 |
| `src/services/express-server.js` | 修改 | 移除进程跟踪代码，简化 `start()` |
| `src/main.js` | 修改 | 使用 `processManager.scanAndTrackProcesses()` |
| `src/config/defaults.js` | 新增 | 集中管理默认配置 |

---

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 重构引入新 bug | 中 | 保持逻辑不变，只移动代码位置 |
| 进程清理失败 | 低 | 保留现有 SIGKILL 回退机制 |
| 配置迁移遗漏 | 低 | 逐项对比验证 |

---

## 验证计划

1. **开发环境测试**
   ```bash
   npm run dev
   ```
   - 检查日志确认进程跟踪正常
   - 关闭应用确认无僵尸进程

2. **打包测试**
   ```bash
   npm run build:mac
   ```
   - 安装 DMG 验证功能正常
   - 卸载后检查残留文件

---

## 结论

当前架构可以运行，但存在代码重复和职责不清的问题。建议按优先级逐步重构：

1. **高优先级**: 集中进程管理逻辑
2. **中优先级**: 提取配置模块
3. **低优先级**: 优化清理流程

是否需要我开始执行这些重构？

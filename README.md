# Lightning Network Node App

一个基于 Electron.js 构建的闪电网络节点管理应用程序。

## 功能特性

- 🚀 现代化的用户界面
- ⚡ 闪电网络节点管理
- 💰 钱包功能（开发中）
- 🔗 通道管理（开发中）
- 📊 实时数据仪表板
- 🌙 支持深色/浅色主题
- 🔒 安全的进程间通信
- 📱 响应式设计

## 技术栈

- **Electron**: 跨平台桌面应用框架
- **HTML5/CSS3**: 现代化的用户界面
- **JavaScript**: 应用逻辑和交互
- **Node.js**: 后端服务和 API

## 系统要求

- Node.js 16.0 或更高版本
- npm 或 yarn 包管理器
- macOS 10.15+, Windows 10+, 或 Linux

## 安装和运行

### 1. 克隆项目（如果从 Git 仓库）

```bash
git clone <repository-url>
cd lnnode-app
```

### 2. 安装依赖

```bash
npm install
```

### 3. 开发模式运行

```bash
npm run dev
```

### 4. 生产模式运行

```bash
npm start
```

## 构建应用

### 构建所有平台

```bash
npm run build
```

### 构建特定平台

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

### 打包（不分发）

```bash
npm run pack
```

## 项目结构

```
lnnode-app/
├── src/                    # 源代码目录
│   ├── main.js            # Electron 主进程
│   ├── preload.js         # 预加载脚本
│   ├── index.html         # 主页面
│   ├── styles.css         # 样式文件
│   └── renderer.js        # 渲染进程脚本
├── assets/                # 资源文件
├── dist/                  # 构建输出目录
├── package.json           # 项目配置
└── README.md             # 项目说明
```

## 开发指南

### 主要文件说明

- **src/main.js**: Electron 主进程，负责创建窗口和应用生命周期管理
- **src/preload.js**: 预加载脚本，提供安全的 API 接口
- **src/renderer.js**: 渲染进程脚本，处理用户界面交互
- **src/index.html**: 主页面结构
- **src/styles.css**: 应用样式，支持深色主题

### 添加新功能

1. 在 `src/renderer.js` 中添加前端逻辑
2. 在 `src/main.js` 中添加主进程功能
3. 通过 `src/preload.js` 暴露安全的 API
4. 更新 `src/index.html` 和 `src/styles.css` 以支持新的 UI

### 安全最佳实践

- 禁用 `nodeIntegration`
- 启用 `contextIsolation`
- 使用 `preload.js` 安全地暴露 API
- 验证所有用户输入
- 使用 HTTPS 进行网络通信

## 配置选项

### Electron Builder 配置

在 `package.json` 中的 `build` 字段可以配置：

- 应用图标
- 安装包格式
- 代码签名
- 自动更新

### 应用设置

用户可以在设置页面配置：

- 节点网络（主网/测试网）
- 应用主题
- 语言设置
- 节点连接参数

## 故障排除

### 常见问题

1. **应用无法启动**
   - 检查 Node.js 版本是否符合要求
   - 确保所有依赖已正确安装

2. **构建失败**
   - 清除 node_modules 并重新安装
   - 检查 electron-builder 配置

3. **界面显示异常**
   - 检查浏览器控制台错误
   - 验证 CSS 文件是否正确加载

### 调试模式

在开发模式下，应用会自动打开开发者工具：

```bash
npm run dev
```

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 联系方式

- 项目主页: [GitHub Repository]
- 问题反馈: [GitHub Issues]
- 邮箱: your.email@example.com

## 更新日志

### v1.0.0 (当前版本)

- ✨ 初始版本发布
- 🎨 现代化用户界面
- ⚡ 基础闪电网络功能框架
- 🔧 完整的开发环境配置

## 路线图

- [ ] 集成真实的闪电网络节点
- [ ] 实现钱包功能
- [ ] 添加通道管理
- [ ] 支持多语言
- [ ] 添加数据可视化
- [ ] 实现自动更新

---

**注意**: 这是一个开发中的项目，某些功能可能尚未完全实现。请查看项目状态和路线图了解最新进展。 
# lnlink-app Knowledge Base

## Overview
Electron-based desktop application that wraps `ln-link` backend. Supports macOS, Windows, Linux.

## Structure
```
lnlink-app/
├── src/
│   ├── main.js      # Electron Main Process
│   ├── renderer.js  # Renderer Process (UI)
│   └── ipc/         # IPC Communication
├── scripts/         # Build & Signing Scripts (fetch-binaries, afterSign)
├── assets/          # Icons & Static Assets
└── build/           # Build Configuration
```

## Development

### Architecture
- **Bundled Backend**: `ln-link` is bundled as a dependency and spawned as a child process within Electron.
- **Binaries**: Provided by `@nodeflow-network/nodeflow-bin` (installed as an optionalDependency of `lnlink-server`). The platform-specific sub-package (`bin-darwin-arm64`, `bin-linux-x64`, `bin-win32-x64`) is selected automatically by npm/yarn based on the host OS. No manual download step needed.
- **Supported platforms**: macOS arm64, Linux x64, Windows x64. macOS x64 (Intel) is not supported — nodeflow-bin has no darwin-x64 build.
- **Cross-building**: Build each target on a matching host — optionalDependencies are filtered by host OS, so building Windows targets from macOS will omit `bin-win32-x64`. `afterPack.js` enforces this with a hard assertion.

### Build Flow
1. `yarn install` — installs dependencies including the platform-matching nodeflow-bin sub-package
2. `yarn dev` — dev mode (no binary download step required)
3. `yarn build:mac` — builds macOS arm64 DMG

## Notes
- **Electron Builder**: Configured in `package.json` under `build` field.
- **Signing**: macOS requires signing (`afterSign.js`) and notarization. Credentials must be in env vars.
- **Prisma**: Prisma in Electron requires special handling (`scripts/prisma-setup.js`) to ensure Schema and engines are packaged correctly.

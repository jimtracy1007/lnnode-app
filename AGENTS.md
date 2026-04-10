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
- **Binaries**: `scripts/fetch-binaries.js` fetches LND and other binaries. Note architecture compatibility (x64/arm64).

### Build Flow
1. `npm install` (Install dependencies)
2. `node ./scripts/fetch-binaries.js` (Download binaries)
3. `npm run dev` (Dev mode)
4. `npm run build:mac` (Build Mac package)

## Notes
- **Electron Builder**: Configured in `package.json` under `build` field.
- **Signing**: macOS requires signing (`afterSign.js`) and notarization. Credentials must be in env vars.
- **Prisma**: Prisma in Electron requires special handling (`scripts/prisma-setup.js`) to ensure Schema and engines are packaged correctly.

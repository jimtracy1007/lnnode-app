# LN-Link (Lightning Network Node App)

An Electron-based desktop application for managing a Lightning Network node with an integrated local HTTP server and a modern UI.

### Key Features

- Modern, responsive UI (Dashboard, Wallet, Channels, Transactions, Settings)
- Integrated local server ("nodeserver") launched and managed by Electron
- Process tracking and graceful cleanup for child processes (litd, rgb-lightning-node)
- Basic Nostr integration (window.nostr) for keys and encryption helpers
- Light/Dark theme support
- Auto-update ready (configured via electron-updater)

### Tech Stack

- Electron (Main/Preload/Renderer)
- Node.js (integrated Express server under `nodeserver/`)
- HTML/CSS/JavaScript for the UI

## Requirements

- Node.js 19+ (Node 20 LTS recommended)
- npm (or yarn)
- macOS 10.15+, Windows 10+, or Linux

nodeserver enforces Node >= 19 via engines, so use at least Node 19 for development and builds.

## Getting Started

### 1) Clone

```bash
git clone <repository-url>
cd lnnode-app
```

### 2) Install dependencies

```bash
npm install
```

The postinstall script installs dependencies for `nodeserver/` as well.

### 3) Run (development)

Option A – run Electron which will spawn the internal server automatically:

```bash
npm run dev
```

Option B – run both Electron and the server separately (useful for debugging the server in isolation):

```bash
npm run dev:full
```

Notes:
- The Electron main process starts the server and chooses an available port, starting from 8091.
- When running the server standalone (`npm run dev:server`), `nodeserver` defaults to `LINK_HTTP_PORT=8090` unless overridden.

### 4) Run (production)

```bash
npm start
```

## Build & Distribution

This project uses `electron-builder`.

Build for all targets configured:

```bash
npm run build
```

Platform-specific builds:

```bash
# macOS (x64 + arm64)
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

Local package directory only (no installer):

```bash
npm run pack
```

Native module rebuild helpers (when needed for packaging):

```bash
# macOS x64
npm run build:mac-amd

# macOS arm64
npm run build:mac-arm

# Windows x64
npm run build:win
```

The `afterPack.js` script validates SQLite3 bindings inside the packaged `nodeserver/node_modules` and logs any anomalies to help diagnose packaging issues, especially across architectures.

## Project Structure

```
lnnode-app/
├─ src/
│  ├─ main.js               # Electron main process (window + lifecycle + server IPC)
│  ├─ preload.js            # Safe IPC bridge for renderer (window.electronAPI, window.nostr)
│  ├─ renderer.js           # UI logic, navigation, connection checks
│  ├─ index.html            # Main UI shell
│  ├─ styles.css            # Styling and theme
│  ├─ services/
│  │  ├─ express-server.js  # Spawns and monitors the internal server (nodeserver)
│  │  └─ process-manager.js # Tracks/kills child processes (incl. litd/rgb)
│  ├─ ui/window-manager.js  # Window creation, loading/error screens, URL loading
│  ├─ ipc/nostr-handlers.js # IPC handlers for Nostr features
│  └─ utils/
│     ├─ path-manager.js    # Resolves app paths (resources/bin/nodeserver, etc.)
│     └─ logger.js          # Logging helper
├─ nodeserver/              # Integrated Express server
│  ├─ app.js                # Express entrypoint (serves public/initOwner.html, mounts routes)
│  ├─ api/                  # API routes (LND wrappers)
│  ├─ business/             # Business logic (init, jobs, services)
│  ├─ constants/            # Constants and port config (LINK_HTTP_PORT)
│  ├─ public/               # Static assets (initOwner.html, favicon)
│  └─ package.json          # Server scripts, module aliases, engines
├─ assets/                  # App icons and assets
├─ afterPack.js             # Post-pack checks (e.g., sqlite bindings)
├─ package.json             # Electron app config + builder config
└─ README.md
```

## How it Works (High-level)

- On startup, the Electron main process creates a window and shows a loading screen.
- It then launches the internal HTTP server (`nodeserver/app.js`) as a child process and picks an available port starting at 8091.
- Once the server is ready, the window loads `http://127.0.0.1:<port>`.
- If the page fails to load, the app can attempt to restart the server and display an error/connection screen.
- Child processes (e.g., `litd`, `rgb-lightning-node`) can be detected and tracked to ensure clean shutdown.

## Security Notes

- `nodeIntegration` is disabled; `contextIsolation` is enabled.
- Only a minimal, explicit API is exposed via `preload.js` using `contextBridge`.
- Validate any user input at both renderer and server layers.

## Environment & Ports

- Electron will set environment variables for the server when it forks it (e.g., `LINK_HTTP_PORT`, `BINARY_PATH`, `LINK_DATA_PATH`).
- Standalone server runs on `LINK_HTTP_PORT` (defaults to 8090) defined in `nodeserver/constants/index.js`.
- When Electron manages the server, it finds the first available port from [8091..8096] then increments if necessary.

## Nostr Integration

The preload exposes `window.nostr` methods such as:

- `getPublicKey()`, `getNpub()`
- `nip04.encrypt/decrypt()`, `nip44.encrypt/decrypt()`
- `enable()`, `isEnabled()`

See `src/preload.js` and `src/ipc/nostr-handlers.js` for details.

## Troubleshooting

- Connection overlay appears if the renderer cannot reach the server. You can try "Restart Server" from the overlay.
- If builds fail due to native modules (e.g., sqlite3):
  - Use the platform-specific rebuild scripts before packaging
  - Check `afterPack.js` logs to ensure bindings exist for your architecture
- On exit, the app attempts to kill tracked child processes. If any remain, check OS process lists (`litd`, `rgb-lightning-node`).

## Scripts (root)

- `npm run dev` – Electron dev with integrated server
- `npm run dev:server` – Start server only (from `nodeserver/`)
- `npm run dev:full` – Start server and Electron concurrently
- `npm run build` – Build using electron-builder
- `npm run pack` – Package dir without publishing

## License

MIT

## Roadmap (short)

- Real Lightning node integration flows in UI
- Wallet features
- Channel management
- i18n (multi-language)
- Data visualization
- Auto-update configuration

---

This project is under active development; some features are placeholders in the UI until wired to backend services.
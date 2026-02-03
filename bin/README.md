# Embedded Binaries

This directory contains pre-downloaded platform binaries to avoid network download failures (e.g., GFW blocking).

## Directory Structure

```
bin/
├── darwin-arm64/       # macOS Apple Silicon (M1/M2/M3)
│   ├── tor
│   ├── libevent-2.1.7.dylib
│   ├── litd
│   └── rgb-lightning-node
├── darwin-x64/         # macOS Intel
│   ├── tor
│   ├── libevent-2.1.7.dylib
│   ├── litd
│   └── rgb-lightning-node
└── win32-x64/          # Windows x64
    ├── tor.exe
    ├── litd.exe
    └── rgb-lightning-node.exe
```

## How to Populate Binaries

### Option 1: Download Manually
Visit the URLs in `binaries.json` and extract files to the corresponding platform directory.

### Option 2: Use fetch-binaries.js
```bash
# Download for all platforms
node scripts/fetch-binaries.js --all

# Download for specific platform
node scripts/fetch-binaries.js --targets=darwin-x64,win32-x64
```

### Option 3: Download from existing installation
If you have already run the app and downloaded binaries, copy them from:
- macOS: `~/Library/Application Support/LN-Link/bin/`
- Windows: `%APPDATA%/LN-Link/bin/`

## Notes

- `fetch-binaries.js` will skip download if files already exist
- All binaries are automatically signed on macOS during download
- Windows binaries (.exe) do not require additional signing
- Total size: ~180MB per platform (Tor: 7MB, litd: 110MB, rgb: 60MB, libevent: 0.4MB)

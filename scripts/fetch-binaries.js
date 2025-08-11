/*
 * Preinstall binary fetcher
 * - Reads binaries.json
 * - Downloads and extracts platform-specific artifacts into bin/<platform-arch>/
 * - Uses system curl and tar to avoid Node deps (preinstall runs before deps are available)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function logInfo(message) {
  console.log(`[fetch-binaries] ${message}`);
}

function logWarn(message) {
  console.warn(`[fetch-binaries] WARN: ${message}`);
}

function logError(message) {
  console.error(`[fetch-binaries] ERROR: ${message}`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getProjectRoot() {
  // script is located at <root>/scripts/fetch-binaries.js
  return path.resolve(__dirname, '..');
}

function mapPlatformArch() {
  const rawPlatform = process.platform; // 'darwin' | 'win32' | 'linux'
  const rawArch = process.arch; // 'arm64' | 'x64' | ...

  const platformMap = {
    darwin: 'darwin',
    win32: 'win',
    linux: 'linux',
  };

  const platform = platformMap[rawPlatform] || rawPlatform;
  const arch = rawArch; // we expect 'arm64' or 'x64'

  return { platform, arch, key: `${platform}-${arch}`, rawPlatform, rawArch };
}

function which(cmd) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf-8' });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : '';
}

function downloadWithCurl(url, outFile) {
  const curlPath = which('curl');
  if (!curlPath) {
    throw new Error('curl not found in PATH');
  }
  const env = { ...process.env };
  const args = [
    '-L',
    '--fail',
    '--silent',
    '--show-error',
    '--retry', '5',
    '--retry-delay', '2',
    '--retry-all-errors',
    '--connect-timeout', '15',
    '--max-time', '600',
    url,
    '-o', outFile,
  ];
  const res = spawnSync(curlPath, args, { stdio: 'inherit', env });
  if (res.status !== 0) {
    throw new Error(`curl failed with status ${res.status}`);
  }
}

function downloadFile(url, outFile) {
  /** build fallback mirrors if applicable */
  const urls = [url];
  if (url.includes('archive.torproject.org/tor-package-archive/torbrowser/')) {
    urls.push(url.replace('archive.torproject.org/tor-package-archive', 'dist.torproject.org'));
  }

  let lastError = null;
  for (const candidate of urls) {
    try {
      logInfo(`Downloading: ${candidate}`);
      downloadWithCurl(candidate, outFile);
      return; // success
    } catch (e) {
      lastError = e;
      logWarn(`Download failed for ${candidate}: ${e && e.message ? e.message : e}`);
      try { fs.rmSync(outFile, { force: true }); } catch (_) {}
    }
  }
  throw lastError || new Error('Download failed');
}

function extractTarGz(archiveFile, destDir) {
  const tarPath = which('tar');
  if (!tarPath) {
    throw new Error('tar not found in PATH');
  }
  ensureDir(destDir);
  const res = spawnSync(tarPath, ['-xzf', archiveFile, '-C', destDir], { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`tar extraction failed with status ${res.status}`);
  }
}

function findFirstMatch(rootDir, filename) {
  // Depth-first search for a file with given basename
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === filename) {
        return fullPath;
      }
    }
  }
  return '';
}

function setExecutableIfExists(filePath) {
  try {
    const mode = fs.statSync(filePath).mode;
    // u+x g+x o+x
    fs.chmodSync(filePath, mode | 0o111);
  } catch (_) {
    // ignore
  }
}

const EXECUTABLE_NAMES = new Set([
  'tor',
  'litd',
  'lncli',
  'tapcli',
  'rgb-lightning-node',
]);

function ensureExecutablesInDir(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(dirPath, entry.name);
      if (EXECUTABLE_NAMES.has(entry.name) || /\.(sh|run)$/i.test(entry.name) || !/\./.test(entry.name)) {
        // Set +x for known executables, shell scripts, or extension-less files
        setExecutableIfExists(full);
      }
    }
  } catch (_) {
    // ignore
  }
}

function fetchForKey(json, key, root) {
  const [platform, arch] = key.split('-');
  const binRoot = path.join(root, 'bin');
  const destDir = path.join(binRoot, `${platform}-${arch}`);

  logInfo(`Platform key: ${key}`);
  logInfo(`Destination: ${destDir}`);
  ensureDir(destDir);

  const entries = json[key];
  if (!entries || typeof entries !== 'object') {
    logWarn(`No binaries defined for ${key}, skipping`);
    return;
  }

  /** @type {Record<string, string[]>} */
  const urlToNames = {};
  for (const [name, url] of Object.entries(entries)) {
    if (!urlToNames[url]) {
      urlToNames[url] = [];
    }
    urlToNames[url].push(name);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `fetch-bin-${platform}-${arch}-`));
  logInfo(`Temp dir: ${tmpDir}`);
  try {
    for (const [url, names] of Object.entries(urlToNames)) {
      const allExist = names.every((n) => fs.existsSync(path.join(destDir, n)));
      if (allExist) {
        logInfo(`All targets already present for URL: ${url}`);
        continue;
      }

      const archiveFile = path.join(tmpDir, 'artifact');
      downloadFile(url, archiveFile);

      if (url.endsWith('.tar.gz') || url.endsWith('.tgz')) {
        const extractDir = path.join(tmpDir, 'extract');
        extractTarGz(archiveFile, extractDir);

        for (const name of names) {
          const targetPath = path.join(destDir, name);
          if (fs.existsSync(targetPath)) {
            logInfo(`Exists, skip: ${targetPath}`);
            continue;
          }
          let matched = '';
          if (name === 'tor') {
            matched = findFirstMatch(extractDir, 'tor') || findFirstMatch(extractDir, 'tor.real');
          } else {
            matched = findFirstMatch(extractDir, name);
          }
          if (!matched) {
            throw new Error(`File '${name}' not found in extracted archive from ${url}`);
          }
          fs.copyFileSync(matched, targetPath);
          if (EXECUTABLE_NAMES.has(name)) {
            setExecutableIfExists(targetPath);
          }
          logInfo(`Placed: ${targetPath}`);
        }
      } else {
        if (names.length !== 1) {
          throw new Error(`Direct download URL with multiple targets is not supported: ${url}`);
        }
        const name = names[0];
        const targetPath = path.join(destDir, name);
        if (!fs.existsSync(targetPath)) {
          fs.copyFileSync(archiveFile, targetPath);
          if (EXECUTABLE_NAMES.has(name)) {
            setExecutableIfExists(targetPath);
          }
          logInfo(`Placed: ${targetPath}`);
        }
      }
    }
    // Ensure permissions for any pre-existing executables in this dir (e.g., rgb-lightning-node)
    ensureExecutablesInDir(destDir);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function parseTargets(json) {
  const argv = process.argv.slice(2);
  const argTargets = argv.find((a) => a.startsWith('--targets='));
  const argAll = argv.includes('--all');
  const argMacAll = argv.includes('--mac-all') || argv.includes('--mac-both');

  const envTargets = process.env.BINARIES_TARGETS || '';

  if (argAll) {
    return Object.keys(json);
  }
  if (argMacAll) {
    return Object.keys(json).filter((k) => k.startsWith('darwin-'));
  }
  if (argTargets) {
    return argTargets.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (envTargets) {
    return envTargets.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const { key } = mapPlatformArch();
  return [key];
}

function main() {
  const root = getProjectRoot();
  const configPath = path.join(root, 'binaries.json');
  if (!fs.existsSync(configPath)) {
    logWarn('binaries.json not found, skipping');
    return;
  }
  const json = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const targets = Array.from(new Set(parseTargets(json)));
  logInfo(`Targets: ${targets.join(', ')}`);

  for (const key of targets) {
    if (!json[key]) {
      logWarn(`No definition for ${key} in binaries.json, skipping`);
      continue;
    }
    try {
      fetchForKey(json, key, root);
    } catch (err) {
      logError(String(err && err.message ? err.message : err));
      process.exit(1);
    }
  }
  // Final sweep: ensure exec bits in all processed target dirs
  try {
    for (const key of targets) {
      const [platform, arch] = key.split('-');
      const dir = path.join(root, 'bin', `${platform}-${arch}`);
      ensureExecutablesInDir(dir);
    }
  } catch (_) {}
  logInfo('Done');
}

main();



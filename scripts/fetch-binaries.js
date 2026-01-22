/*
 * Preinstall binary fetcher
 * - Reads binaries.json
 * - Downloads and extracts platform-specific artifacts into bin/<platform-arch>/
 * - Uses system curl and tar to avoid Node deps (preinstall runs before deps are available)
 */

// 加载 .env 文件（如果存在）
try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv 可能还未安装（preinstall 阶段），忽略错误
}

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
    win32: 'win32',
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
  /* build fallback mirrors if applicable */
  const urls = [url];
  if (process.env.TOR_MIRROR && url.includes('torproject.org')) {
    // Allows user to provide a custom mirror base (e.g. "https://mirror.example.com")
    // Replaces "https://<original_host>" with the custom mirror
    const customUrl = url.replace(/^https:\/\/[^/]+/, process.env.TOR_MIRROR);
    urls.unshift(customUrl);
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

function extractZip(archiveFile, destDir) {
  const unzipPath = which('unzip');
  if (!unzipPath) {
    throw new Error('unzip not found in PATH');
  }
  ensureDir(destDir);
  const res = spawnSync(unzipPath, ['-q', archiveFile, '-d', destDir], { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`unzip extraction failed with status ${res.status}`);
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

function findFirstDir(rootDir, pattern) {
  // Find first directory matching pattern
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && pattern.test(entry.name)) {
      return path.join(rootDir, entry.name);
    }
  }
  return '';
}

function copyRecursive(src, dest) {
  // Recursively copy directory
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
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
      // Plan A: If this URL only provides Node.js runtime, skip entirely
      if (names.every((n) => n === 'node')) {
        logInfo(`Skip download (Node.js runtime only): ${url}`);
        continue;
      }
      
      // 检查是否包含 Tor 相关文件，如果未启用 Tor 则跳过
      // 默认开启 Tor 下载，除非显式禁用 (LINK_ENABLE_TOR === 'false')
      const isTorRelated = names.some((n) => n === 'tor' || n === 'libevent-2.1.7.dylib');
      if (isTorRelated && process.env.LINK_ENABLE_TOR === 'false') {
        logInfo(`Skip download (Tor disabled via LINK_ENABLE_TOR): ${names.join(', ')}`);
        continue;
      }
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
          if (name === 'node') {
            // Plan A: 不再捆绑 Node.js 运行时，直接跳过
            logInfo('Skip Node.js runtime (Plan A)');
            continue;
          }
          
          const targetPath = path.join(destDir, name);
          if (fs.existsSync(targetPath)) {
            logInfo(`Exists, skip: ${targetPath}`);
            continue;
          }
          let matched = '';
          if (name === 'tor') {
            matched = findFirstMatch(extractDir, 'tor') || findFirstMatch(extractDir, 'tor.real') || findFirstMatch(extractDir, 'tor.exe');
          } else if (name === 'litd') {
            matched = findFirstMatch(extractDir, 'litd') || findFirstMatch(extractDir, 'litd.exe');
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
      } else if (url.endsWith('.zip')) {
        const extractDir = path.join(tmpDir, 'extract');
        extractZip(archiveFile, extractDir);

        for (const name of names) {
          if (name === 'node') {
            // Plan A: 不再捆绑 Node.js 运行时，直接跳过
            logInfo('Skip Node.js runtime (Plan A)');
            continue;
          }
          
          const targetPath = path.join(destDir, name);
          if (fs.existsSync(targetPath)) {
            logInfo(`Exists, skip: ${targetPath}`);
            continue;
          }
          let matched = '';
          if (name === 'tor') {
            matched = findFirstMatch(extractDir, 'tor') || findFirstMatch(extractDir, 'tor.real') || findFirstMatch(extractDir, 'tor.exe');
          } else if (name === 'litd') {
            matched = findFirstMatch(extractDir, 'litd') || findFirstMatch(extractDir, 'litd.exe');
          } else if (name === 'rgb-lightning-node') {
            matched = findFirstMatch(extractDir, 'rgb-lightning-node') || 
                      findFirstMatch(extractDir, 'rgb-lightning-node.exe') || 
                      findFirstMatch(extractDir, 'rgb-lightning-node-macos-x86_64') || 
                      findFirstMatch(extractDir, 'rgb-lightning-node-macos-aarch64') ||
                      findFirstMatch(extractDir, 'rgb-lightning-node-linux-x86_64');
          } else {
            matched = findFirstMatch(extractDir, name);
          }
          if (!matched) {
            logInfo(`Contents of extract dir:`);
            const listFiles = (dir) => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  listFiles(fullPath);
                } else {
                  logInfo(` - ${fullPath}`);
                }
              }
            };
            try { listFiles(extractDir); } catch(e) { logError(e.message); }
            
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
  
  // Check for CI-specific environment variables
  const ciJobName = process.env.GITHUB_JOB || '';
  
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
  
  // CI job-specific targeting
  if (ciJobName === 'build-mac-amd') {
    return ['darwin-x64'];
  }
  if (ciJobName === 'build-mac-arm') {
    return ['darwin-arm64'];
  }
  if (ciJobName === 'build-windows') {
    return ['win32-x64'];
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



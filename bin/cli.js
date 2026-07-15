#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PI_DIR = path.join(os.homedir(), '.pi', 'agent');

const args = process.argv.slice(2);

// Handle "web" subcommand — launch web UI instead of CLI
if (args.includes('web') && !args.includes('--help') && !args.includes('-h')) {
  require('./web.js');
  return;
}

// Load custom-pi package version
let customPiVersion = '1.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  customPiVersion = pkg.version;
} catch (e) {}

// Handle version flag — show custom-pi version then delegate to pi for its version
if (args.includes('--version') || args.includes('-v') || args.includes('version')) {
  console.log('\x1b[36mcustom-pi v' + customPiVersion + '\x1b[0m');
  process.exit(0);
}

// Handle update command for custom-pi package
if (args.includes('update')) {
  console.log('\x1b[36m🔄 Checking for custom-pi updates on NPM...\x1b[0m');
  try {
    const latestVersion = execSync('npm show custom-pi version', { encoding: 'utf8' }).trim();
    if (latestVersion && latestVersion !== customPiVersion) {
      console.log('\x1b[33m📈 New version of custom-pi available: v' + latestVersion + ' (installed: v' + customPiVersion + ')\x1b[0m');
      console.log('\x1b[36m📦 Updating custom-pi globally...\x1b[0m');
      execSync('npm install -g custom-pi', { stdio: 'inherit' });
      console.log('\x1b[32m✅ custom-pi updated successfully!\x1b[0m\n');
    } else {
      console.log('\x1b[32m✅ custom-pi is up to date (v' + customPiVersion + ')\x1b[0m\n');
    }
  } catch (err) {
    console.warn('\x1b[33m⚠️ Could not automatically update custom-pi. You can run "npm install -g custom-pi" manually.\x1b[0m\n');
  }
  process.exit(0);
}

// ── Isolation flag ───────────────────────────────────────────────────────────
// custom-pi launches `pi` with this env var set. The shared extension at
// ~/.pi/agent/extensions/subagents checks it and stays inert when `pi` is run
// directly, so stock `pi` is never polluted by custom-pi's TUI/tools.
process.env.CUSTOM_PI_ACTIVE = "1";

function copyFolderRecursiveSync(src, dest, onlyIfMissingMap = {}) {
  const base = path.basename(src);
  if (base === 'node_modules' || base === '.git' || base === '.DS_Store') return;
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyFolderRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName), onlyIfMissingMap);
    });
  } else {
    const relativeDest = path.relative(PI_DIR, dest);
    if (onlyIfMissingMap[relativeDest] && fs.existsSync(dest)) return;
    // Skip unchanged files so large trees (e.g. web client dist) don't get
    // re-copied on every launch — this was causing a startup freeze.
    if (fs.existsSync(dest)) {
      try {
        const srcMtime = fs.statSync(src).mtimeMs;
        const dstMtime = fs.statSync(dest).mtimeMs;
        if (dstMtime >= srcMtime) return;
      } catch { /* fall through and copy */ }
    }
    fs.copyFileSync(src, dest);
  }
}

const onlyIfMissingMap = { 'mcp-servers.json': true };
const assetsDir = path.join(__dirname, '..', 'assets');
copyFolderRecursiveSync(assetsDir, PI_DIR, onlyIfMissingMap);

// Install extension dependencies
const extDir = path.join(PI_DIR, 'extensions', 'subagents');
if (fs.existsSync(path.join(extDir, 'package.json')) && !fs.existsSync(path.join(extDir, 'node_modules'))) {
  console.log('\x1b[33m📦 Installing custom sub-agent extension dependencies...\x1b[0m');
  try {
    execSync('npm install --no-audit --no-fund', { cwd: extDir, stdio: 'inherit' });
  } catch (e) {
    console.error('Failed to install dependencies:', e.message);
  }
}

// NOTE: The extension bundle (dist/index.js) is pre-built and synced to
// ~/.pi/agent/extensions/subagents/dist/index.js. Do NOT auto-build here —
// `npm run build` adds 3-4s of npm startup overhead and froze the TUI at
// launch. Rebuild manually with: npm run build && cp dist/index.js ~/.pi/agent/extensions/subagents/dist/index.js



// Load environment variables from ~/.pi/agent/.env
const envPath = path.join(PI_DIR, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (k && !process.env[k]) process.env[k] = v;
        }
      }
    }
  } catch (e) {}
}

// Check for --legacy-pi flag to spawn original pi process
const legacyPiIdx = args.indexOf('--legacy-pi');
if (legacyPiIdx >= 0) {
  args.splice(legacyPiIdx, 1);
  const { spawn } = require('child_process');
  const piProcess = spawn('pi', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  piProcess.on('error', (err) => {
    console.error('\x1b[31mFailed to launch `pi`. Is it installed and on your PATH?\x1b[0m');
    console.error(err.message);
    process.exit(1);
  });
  piProcess.on('exit', (code) => process.exit(code || 0));
  return;
}

// Run Custom-PI agent directly in-process (no subprocess spawn).
// Dynamic import is used because pi's dist is ESM while this file is CJS.
(async () => {
  try {
    const { configureHttpDispatcher } = await import('@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js');
    configureHttpDispatcher();
    process.title = 'custom-pi';
    process.env.PI_CODING_AGENT = "true";
    const { main } = await import('@earendil-works/pi-coding-agent/dist/main.js');
    await main(args);
  } catch (err) {
    console.error('\x1b[31mFailed to load the Custom-PI agent.\x1b[0m');
    console.error(err.message);
    process.exit(1);
  }
})();

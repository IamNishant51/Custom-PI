#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const PI_DIR = path.join(os.homedir(), '.pi', 'agent');

const args = process.argv.slice(2);

// Handle "web" subcommand — launch web UI instead of CLI
if (args.includes('web') && !args.includes('--help') && !args.includes('-h')) {
  require('./web.js');
  return; // web.js spawns its own process, don't continue to spawn pi
}

// Load custom-pi package version
let customPiVersion = '1.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  customPiVersion = pkg.version;
} catch (e) {}

// Handle version flag
if (args.includes('--version') || args.includes('-v') || args.includes('version')) {
  console.log('\x1b[36mcustom-pi wrapper: v' + customPiVersion + '\x1b[0m');
  try {
    const piVer = execSync('pi --version', { encoding: 'utf8' }).trim();
    console.log('\x1b[32mcore pi agent: ' + piVer + '\x1b[0m');
  } catch (e) {
    console.log('\x1b[31mcore pi agent: not installed or not in PATH\x1b[0m');
  }
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
}

console.log('\x1b[36m🚀 Synchronizing custom Pi configurations...\x1b[0m');

function copyFolderRecursiveSync(src, dest, onlyIfMissingMap = {}) {
  const base = path.basename(src);
  if (base === 'node_modules' || base === '.git' || base === '.DS_Store') {
    return;
  }
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyFolderRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName),
        onlyIfMissingMap
      );
    });
  } else {
    const relativeDest = path.relative(PI_DIR, dest);
    if (onlyIfMissingMap[relativeDest] && fs.existsSync(dest)) {
      return;
    }
    fs.copyFileSync(src, dest);
  }
}

const onlyIfMissingMap = {
  'mcp-servers.json': true
};

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

console.log('\x1b[32m✅ Configuration sync complete.\x1b[0m');

// Auto-detect LM Studio models
try {
  const data = JSON.parse(require('child_process').execSync(
    'curl -s --max-time 2 http://127.0.0.1:1234/v1/models 2>/dev/null || echo "{}"',
    { encoding: 'utf8' }
  ));
  if (data.data && data.data.length > 0) {
    const live = data.data.map(m => ({
      id: m.id, name: m.name || m.id,
      api: 'openai-completions',
      contextWindow: 4096, maxTokens: 2048,
      input: ['text'], reasoning: false,
    }));
    const modelsPath = path.join(PI_DIR, 'models.json');
    let cfg = { providers: {} };
    try { cfg = JSON.parse(fs.readFileSync(modelsPath, 'utf8')); } catch {}
    cfg.providers = cfg.providers || {};
    cfg.providers.lmstudio = {
      api: 'openai-completions', apiKey: 'not-needed',
      baseUrl: 'http://127.0.0.1:1234/v1', models: live,
    };
    fs.writeFileSync(modelsPath, JSON.stringify(cfg, null, 2));
  }
} catch {}

console.log('\x1b[32m✅ Models synced.\x1b[0m\n');

// Render a gorgeous high-fidelity startup dashboard
console.clear();
const cpuModel = os.cpus()[0]?.model || 'Unknown';
const nodeVersion = process.version;
const platform = process.platform + '-' + os.arch();

const termWidth = process.stdout.columns || 120;
const topPad = 3;
const leftPad = Math.max(0, Math.floor((termWidth - 74) / 2));
const pad = ' '.repeat(leftPad);
const topPadding = '\n'.repeat(topPad);

const banner = [
  "\x1b[38;5;198m  ██████╗ ██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ███╗      ██████╗ ██╗\x1b[0m",
  "\x1b[38;5;201m ██╔════╝ ██║   ██║██╔════╝ ╚══██╔══╝██╔═══██╗████╗ ████║      ██╔══██╗██║\x1b[0m",
  "\x1b[38;5;135m ██║      ██║   ██║╚██████╗    ██║   ██║   ██║██╔████╔██║█████╗██████╔╝██║\x1b[0m",
  "\x1b[38;5;57m ██║      ██║   ██║ ╚═══██║    ██║   ██║   ██║██║╚██╔╝██║╚════╝██╔═══╝ ██║\x1b[0m",
  "\x1b[38;5;51m ╚██████╗ ╚██████╔╝██████╔╝    ██║   ╚██████╔╝██║ ╚═╝ ██║      ██║     ██║\x1b[0m",
  "\x1b[38;5;45m  ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝    ╚═════╝ ╚═╝     ╚═╝      ╚═╝     ╚═╝\x1b[0m",
].map(line => pad + line).join("\n");

console.log(topPadding + banner);

const innerWidth = 72;
function printBoxLine(content) {
  const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const visibleLen = stripAnsi(content).length;
  const paddingNeeded = innerWidth - visibleLen;
  const padding = ' '.repeat(Math.max(0, paddingNeeded));
  console.log(pad + `\x1b[38;5;135m│\x1b[0m${content}${padding}\x1b[38;5;135m│\x1b[0m`);
}

console.log(pad + "\x1b[38;5;135m┌────────────────────────────────────────────────────────────────────────┐\x1b[0m");
printBoxLine(`  \x1b[38;5;51mCUSTOM-PI ADVANCED DEVELOPER CONSOLE\x1b[0m \x1b[38;5;121mv${customPiVersion}\x1b[0m`);
console.log(pad + `\x1b[38;5;135m├────────────────────────────────────────────────────────────────────────┤\x1b[0m`);
printBoxLine(`  \x1b[38;5;226mEngine:\x1b[0m custom-pi core      \x1b[38;5;226mNode.js:\x1b[0m ${nodeVersion.padEnd(8)}     \x1b[38;5;226mPlatform:\x1b[0m ${platform}`);
printBoxLine(`  \x1b[38;5;226mMemory:\x1b[0m ~/.pi/agent/memory/semantic.json  \x1b[38;5;226mTheme:\x1b[0m custom-pi-quantum`);
printBoxLine(`  \x1b[38;5;226mSwarm Status:\x1b[0m online (builder/researcher/reviewer)`);
printBoxLine(`  \x1b[38;5;226mHardware:\x1b[0m ${cpuModel.slice(0, 56)}`);
console.log(pad + "\x1b[38;5;135m└────────────────────────────────────────────────────────────────────────┘\x1b[0m\n");
console.log(pad + '\x1b[38;5;121m⚡ Starting custom-pi core console...\x1b[0m\n');
// Space between the startup logo and the pi-agent TUI input bar
console.log('\n'.repeat(15));

// Spawn the globally installed 'pi' binary, forwarding args and pipes without deprecation shell warning on Unix
const piProcess = spawn('pi', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

piProcess.on('exit', (code) => {
  process.exit(code || 0);
});

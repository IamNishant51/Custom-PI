#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const HOME = process.env.HOME || process.env.USERPROFILE || '/home/nishant';
const PI_DIR = path.join(HOME, '.pi', 'agent');

const args = process.argv.slice(2);

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

// Ensure destination directories exist
const destDirs = [
  PI_DIR,
  path.join(PI_DIR, 'agents'),
  path.join(PI_DIR, 'extensions'),
  path.join(PI_DIR, 'extensions', 'subagents'),
  path.join(PI_DIR, 'extensions', 'subagents', 'src')
];

for (const dir of destDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Synchronize files
const assetsDir = path.join(__dirname, '..', 'assets');
const filesToCopy = [
  { src: 'SYSTEM.md', dest: 'SYSTEM.md' },
  { src: 'settings.json', dest: 'settings.json' },
  { src: 'models.json', dest: 'models.json' },
  { src: 'agents/builder.md', dest: 'agents/builder.md' },
  { src: 'agents/researcher.md', dest: 'agents/researcher.md' },
  { src: 'agents/reviewer.md', dest: 'agents/reviewer.md' },
  { src: 'extensions/subagents/package.json', dest: 'extensions/subagents/package.json' },
  { src: 'extensions/subagents/src/index.ts', dest: 'extensions/subagents/src/index.ts' }
];

for (const f of filesToCopy) {
  const srcPath = path.join(assetsDir, f.src);
  const destPath = path.join(PI_DIR, f.dest);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
  }
}

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

console.log('\x1b[32m✅ Configuration sync complete. Starting Pi...\x1b[0m\n');

// Spawn the globally installed 'pi' binary, forwarding args and pipes without deprecation shell warning on Unix
const piProcess = spawn('pi', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

piProcess.on('exit', (code) => {
  process.exit(code || 0);
});

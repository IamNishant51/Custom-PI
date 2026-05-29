#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOME = process.env.HOME || process.env.USERPROFILE || '/home/nishant';
const PI_DIR = path.join(HOME, '.pi', 'agent');

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
    const { execSync } = require('child_process');
    execSync('npm install --no-audit --no-fund', { cwd: extDir, stdio: 'inherit' });
  } catch (e) {
    console.error('Failed to install dependencies:', e.message);
  }
}

console.log('\x1b[32m✅ Configuration sync complete. Starting Pi...\x1b[0m\n');

// Spawn the globally installed 'pi' binary, forwarding args and pipes
const piProcess = spawn('pi', process.argv.slice(2), {
  stdio: 'inherit',
  shell: true
});

piProcess.on('exit', (code) => {
  process.exit(code || 0);
});

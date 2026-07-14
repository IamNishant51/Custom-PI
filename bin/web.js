#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PI_DIR = path.join(os.homedir(), '.pi', 'agent');
const SERVER_SRC = path.join(__dirname, '..', 'assets', 'web', 'web-server.mjs');
const SERVER_DEST = path.join(PI_DIR, 'web', 'web-server.mjs');
const CLIENT_DIR = path.join(__dirname, '..', 'assets', 'web', 'client', 'dist');
const CLIENT_DEST = path.join(PI_DIR, 'web', 'client', 'dist');

// Auto-build web client if missing
const CLIENT_SRC = path.join(__dirname, '..', 'assets', 'web', 'client');
if (!fs.existsSync(path.join(CLIENT_SRC, 'dist', 'index.html'))) {
  console.log('\x1b[33mWeb client not built. Running build...\x1b[0m');
  const { execSync } = require('child_process');
  try {
    execSync('npm install && npm run build', { cwd: CLIENT_SRC, stdio: 'inherit' });
  } catch {
    console.error('\x1b[31mWeb client build failed\x1b[0m');
    process.exit(1);
  }
}

// Sync server to runtime dir
if (!fs.existsSync(path.dirname(SERVER_DEST))) {
  fs.mkdirSync(path.dirname(SERVER_DEST), { recursive: true });
}
if (fs.existsSync(SERVER_SRC)) {
  fs.copyFileSync(SERVER_SRC, SERVER_DEST);
}

// Sync client to runtime dir
if (fs.existsSync(CLIENT_DIR)) {
  if (!fs.existsSync(path.dirname(CLIENT_DEST))) {
    fs.mkdirSync(path.dirname(CLIENT_DEST), { recursive: true });
  }
  try { fs.cpSync(CLIENT_DIR, CLIENT_DEST, { recursive: true, force: true }); } catch {}
}

const PORT = process.env.WEB_PORT || '4321';
const WATCH = process.argv.includes('--watch');

console.log(`\x1b[36m✦ Starting Custom-PI Web Server...\x1b[0m`);
console.log(`\x1b[36m  Port: ${PORT}\x1b[0m`);
if (WATCH) console.log(`\x1b[33m  Watch mode enabled (auto-restart on file changes)\x1b[0m`);
console.log('');

let child = null;

function startServer() {
  if (child) {
    try { child.kill('SIGTERM'); } catch {}
  }
  // Re-sync server file before starting
  if (fs.existsSync(SERVER_SRC)) {
    fs.copyFileSync(SERVER_SRC, SERVER_DEST);
  }
  child = spawn('node', [SERVER_SRC], {
    stdio: 'inherit',
    env: { ...process.env, WEB_PORT: PORT },
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    if (!WATCH) process.exit(code || 0);
    child = null;
  });
}

startServer();

// Watch mode: restart on file changes to server source or client build
if (WATCH) {
  const watchDirs = [
    path.join(__dirname, '..', 'assets', 'web'),
  ];
  const debounceTimers = new Map();
  for (const dir of watchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename || filename.includes('node_modules') || filename.startsWith('.')) return;
        const ext = path.extname(filename);
        if (ext !== '.mjs' && ext !== '.js' && ext !== '.tsx' && ext !== '.ts' && ext !== '.css' && ext !== '.html') return;
        const key = filename;
        if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
        debounceTimers.set(key, setTimeout(() => {
          debounceTimers.delete(key);
          console.log(`\x1b[33m[watch] ${filename} changed, restarting...\x1b[0m`);
          startServer();
        }, 300));
      });
      console.log(`\x1b[32m  Watching: ${path.relative(__dirname, dir)}\x1b[0m`);
    } catch (e) {
      console.log(`\x1b[31m  Watch error for ${dir}: ${e.message}\x1b[0m`);
    }
  }
}

process.on('SIGINT', () => { if (child) child.kill('SIGINT'); process.exit(0); });
process.on('SIGTERM', () => { if (child) child.kill('SIGTERM'); process.exit(0); });

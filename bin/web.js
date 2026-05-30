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

console.log(`\x1b[36m✦ Starting Custom-PI Web Server...\x1b[0m`);
console.log(`\x1b[36m  Port: ${PORT}\x1b[0m\n`);

// Run with node directly (server is .mjs ESM)
const child = spawn('node', [SERVER_DEST], {
  stdio: 'inherit',
  env: { ...process.env, WEB_PORT: PORT },
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

process.on('SIGINT', () => { child.kill('SIGINT'); process.exit(0); });
process.on('SIGTERM', () => { child.kill('SIGTERM'); process.exit(0); });

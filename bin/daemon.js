#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PI_DIR = path.join(os.homedir(), '.pi', 'agent');
const DAEMON_SRC = path.join(__dirname, '..', 'assets', 'extensions', 'subagents', 'src', 'daemon', 'daemon.ts');
const DAEMON_DEST = path.join(PI_DIR, 'daemon', 'daemon.mjs');
const PID_FILE = path.join(PI_DIR, 'daemon', 'daemon.pid');
const LOG_FILE = path.join(PI_DIR, 'daemon', 'daemon.log');
const PORT = process.env.DAEMON_PORT || '4322';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
  console.log(line.trim());
}

function start() {
  ensureDir(path.dirname(PID_FILE));
  ensureDir(path.dirname(LOG_FILE));

  if (fs.existsSync(PID_FILE)) {
    try {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      try { process.kill(oldPid, 0); log(`Daemon already running (PID: ${oldPid})`); process.exit(0); } catch {}
    } catch {}
  }

  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');

  log(`╔══════════════════════════════════════════════╗`);
  log(`║     CUSTOM-PI DAEMON v1.9.0                 ║`);
  log(`║     PID: ${String(process.pid).padEnd(33)}║`);
  log(`║     Port: ${PORT.padEnd(33)}║`);
  log(`╚══════════════════════════════════════════════╝`);
  log('Daemon started. Running in background mode.');

  const piDir = path.join(os.homedir(), '.pi', 'agent');
  const extensionSrc = path.join(__dirname, '..', 'assets', 'extensions', 'subagents', 'src');
  
  const watcher = fs.watch(extensionSrc, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.ts')) {
      log(`[watch] Source file changed: ${filename}`);
    }
  });

  const handleExit = () => {
    watcher.close();
    try { fs.unlinkSync(PID_FILE); } catch {}
    log('Daemon stopped.');
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
  process.on('SIGHUP', () => { log('Received SIGHUP - reloading configuration'); });

  setInterval(() => {
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    log(`[heartbeat] Uptime: ${hours}h ${minutes}m ${seconds}s | PID: ${process.pid}`);
  }, 300000);
}

function stop() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('Daemon PID file not found. Is it running?');
    process.exit(1);
  }
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    process.kill(pid, 'SIGTERM');
    console.log(`Daemon (PID: ${pid}) stopped.`);
  } catch (err) {
    console.error(`Failed to stop daemon: ${err.message}`);
    try { fs.unlinkSync(PID_FILE); } catch {}
  }
}

function status() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('Daemon is not running.');
    process.exit(1);
  }
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    process.kill(pid, 0);
    console.log(`Daemon is running (PID: ${pid}).`);
    if (fs.existsSync(LOG_FILE)) {
      const logs = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
      const lastLines = logs.slice(-5);
      console.log('\nLast log entries:');
      lastLines.forEach(l => console.log(`  ${l}`));
    }
  } catch {
    console.log('Daemon PID file exists but process is not running.');
    console.log('Removing stale PID file...');
    try { fs.unlinkSync(PID_FILE); } catch {}
  }
}

const cmd = process.argv[2];
switch (cmd) {
  case 'start': start(); break;
  case 'stop': stop(); break;
  case 'restart': stop(); setTimeout(start, 1000); break;
  case 'status': status(); break;
  default:
    console.log('Usage: node daemon.js {start|stop|restart|status}');
    console.log('');
    console.log('  start    Start the background daemon');
    console.log('  stop     Stop the background daemon');
    console.log('  restart  Restart the background daemon');
    console.log('  status   Check daemon status');
}

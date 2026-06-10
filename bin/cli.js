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

// Ensure destination directories exist
const destDirs = [
  PI_DIR,
  path.join(PI_DIR, 'agents'),
  path.join(PI_DIR, 'themes'),
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
  { src: 'mcp-servers.json', dest: 'mcp-servers.json', onlyIfMissing: true },
  { src: 'themes/custom-pi-quantum.json', dest: 'themes/custom-pi-quantum.json' },
  { src: 'agents/builder.md', dest: 'agents/builder.md' },
  { src: 'agents/researcher.md', dest: 'agents/researcher.md' },
  { src: 'agents/reviewer.md', dest: 'agents/reviewer.md' },
  { src: 'agents/ceo.md', dest: 'agents/ceo.md' },
  { src: 'agents/security-auditor.md', dest: 'agents/security-auditor.md' },
  { src: 'agents/pr-reviewer.md', dest: 'agents/pr-reviewer.md' },
  // operator.md removed — not needed
  { src: 'extensions/subagents/package.json', dest: 'extensions/subagents/package.json' },
  { src: 'extensions/subagents/src/index.ts', dest: 'extensions/subagents/src/index.ts' },
  { src: 'extensions/subagents/src/types.d.ts', dest: 'extensions/subagents/src/types.d.ts' },
  { src: 'extensions/subagents/src/logger.ts', dest: 'extensions/subagents/src/logger.ts' },
  { src: 'extensions/subagents/src/acp-types.ts', dest: 'extensions/subagents/src/acp-types.ts' },
  { src: 'extensions/subagents/src/gateguard.ts', dest: 'extensions/subagents/src/gateguard.ts' },
  { src: 'extensions/subagents/src/model-router.ts', dest: 'extensions/subagents/src/model-router.ts' },
  { src: 'extensions/subagents/src/context-monitor.ts', dest: 'extensions/subagents/src/context-monitor.ts' },
  { src: 'extensions/subagents/src/stack-detector.ts', dest: 'extensions/subagents/src/stack-detector.ts' },
  { src: 'extensions/subagents/src/memory-types.ts', dest: 'extensions/subagents/src/memory-types.ts' },
  { src: 'extensions/subagents/src/memory-embedding.ts', dest: 'extensions/subagents/src/memory-embedding.ts' },
  { src: 'extensions/subagents/src/memory-store.ts', dest: 'extensions/subagents/src/memory-store.ts' },
  { src: 'extensions/subagents/src/memory-retrieval.ts', dest: 'extensions/subagents/src/memory-retrieval.ts' },
  { src: 'extensions/subagents/src/soul-loader.ts', dest: 'extensions/subagents/src/soul-loader.ts' },
  { src: 'extensions/subagents/src/memory-file-store.ts', dest: 'extensions/subagents/src/memory-file-store.ts' },
  { src: 'extensions/subagents/src/memory-nudge.ts', dest: 'extensions/subagents/src/memory-nudge.ts' },
  { src: 'extensions/subagents/src/background-review.ts', dest: 'extensions/subagents/src/background-review.ts' },
  { src: 'extensions/subagents/src/state-db.ts', dest: 'extensions/subagents/src/state-db.ts' },
  { src: 'extensions/subagents/src/skill-types.ts', dest: 'extensions/subagents/src/skill-types.ts' },
  { src: 'extensions/subagents/src/skill-store.ts', dest: 'extensions/subagents/src/skill-store.ts' },
  { src: 'extensions/subagents/src/skill-retrieval.ts', dest: 'extensions/subagents/src/skill-retrieval.ts' },
  { src: 'extensions/subagents/src/curator.ts', dest: 'extensions/subagents/src/curator.ts' },
  { src: 'extensions/subagents/src/cron-scheduler.ts', dest: 'extensions/subagents/src/cron-scheduler.ts' },
  { src: 'extensions/subagents/src/secret-vault.ts', dest: 'extensions/subagents/src/secret-vault.ts' },
  { src: 'extensions/subagents/src/cost-tracker.ts', dest: 'extensions/subagents/src/cost-tracker.ts' },
  { src: 'extensions/subagents/src/work-products.ts', dest: 'extensions/subagents/src/work-products.ts' },
  { src: 'extensions/subagents/src/storage-driver.ts', dest: 'extensions/subagents/src/storage-driver.ts' },
  { src: 'extensions/subagents/src/verification-engine.ts', dest: 'extensions/subagents/src/verification-engine.ts' },
  { src: 'extensions/subagents/src/tui-colors.ts', dest: 'extensions/subagents/src/tui-colors.ts' },
  { src: 'extensions/subagents/src/animations.ts', dest: 'extensions/subagents/src/animations.ts' },
  { src: 'extensions/subagents/src/tui/index.ts', dest: 'extensions/subagents/src/tui/index.ts' },
  { src: 'extensions/subagents/src/tui/types.ts', dest: 'extensions/subagents/src/tui/types.ts' },
  { src: 'extensions/subagents/src/tui/screen.ts', dest: 'extensions/subagents/src/tui/screen.ts' },
  { src: 'extensions/subagents/src/tui/style-pool.ts', dest: 'extensions/subagents/src/tui/style-pool.ts' },
  { src: 'extensions/subagents/src/tui/ansi-writer.ts', dest: 'extensions/subagents/src/tui/ansi-writer.ts' },
  { src: 'extensions/subagents/src/tui/screen-renderer.ts', dest: 'extensions/subagents/src/tui/screen-renderer.ts' },
  { src: 'extensions/subagents/src/tui/tui-manager.ts', dest: 'extensions/subagents/src/tui/tui-manager.ts' },
  { src: 'extensions/subagents/src/tui/tui-app.ts', dest: 'extensions/subagents/src/tui/tui-app.ts' },
  { src: 'extensions/subagents/src/tui/config/pulse-config.json', dest: 'extensions/subagents/src/tui/config/pulse-config.json' },
  { src: 'extensions/subagents/src/tui/input/vim-input.ts', dest: 'extensions/subagents/src/tui/input/vim-input.ts' },
  { src: 'extensions/subagents/src/tui/utils/measure-text.ts', dest: 'extensions/subagents/src/tui/utils/measure-text.ts' },
  { src: 'extensions/subagents/src/tui/components/animation.ts', dest: 'extensions/subagents/src/tui/components/animation.ts' },
  { src: 'extensions/subagents/src/tui/components/anim-engine.ts', dest: 'extensions/subagents/src/tui/components/anim-engine.ts' },
  { src: 'extensions/subagents/src/tui/components/question-modal.ts', dest: 'extensions/subagents/src/tui/components/question-modal.ts' },
  { src: 'extensions/subagents/src/tui/components/toast.ts', dest: 'extensions/subagents/src/tui/components/toast.ts' },
  { src: 'extensions/subagents/src/tui/app/pulse-controller.ts', dest: 'extensions/subagents/src/tui/app/pulse-controller.ts' },
  // ── Phase 0: Foundation ──────────────────────────────────
  { src: 'extensions/subagents/src/event-bus/event-bus.ts', dest: 'extensions/subagents/src/event-bus/event-bus.ts' },
  { src: 'extensions/subagents/src/state-graph/property-graph.ts', dest: 'extensions/subagents/src/state-graph/property-graph.ts' },
  { src: 'extensions/subagents/src/state-graph/hybrid-search.ts', dest: 'extensions/subagents/src/state-graph/hybrid-search.ts' },
  { src: 'extensions/subagents/src/daemon/daemon.ts', dest: 'extensions/subagents/src/daemon/daemon.ts' },
  { src: 'extensions/subagents/src/ascension-bootstrap.ts', dest: 'extensions/subagents/src/ascension-bootstrap.ts' },
  // ── Phase 1: Cognition ────────────────────────────────────
  { src: 'extensions/subagents/src/cognition/goal-decomposer.ts', dest: 'extensions/subagents/src/cognition/goal-decomposer.ts' },
  { src: 'extensions/subagents/src/cognition/episodic-memory.ts', dest: 'extensions/subagents/src/cognition/episodic-memory.ts' },
  { src: 'extensions/subagents/src/cognition/theory-of-mind.ts', dest: 'extensions/subagents/src/cognition/theory-of-mind.ts' },
  { src: 'extensions/subagents/src/cognition/metacognition.ts', dest: 'extensions/subagents/src/cognition/metacognition.ts' },
  // ── Phase 2: Perception ───────────────────────────────────
  { src: 'extensions/subagents/src/perception/environment-sensor.ts', dest: 'extensions/subagents/src/perception/environment-sensor.ts' },
  { src: 'extensions/subagents/src/perception/web-sentience.ts', dest: 'extensions/subagents/src/perception/web-sentience.ts' },
  // ── Phase 3: Autonomy ─────────────────────────────────────
  { src: 'extensions/subagents/src/autonomy/initiative-engine.ts', dest: 'extensions/subagents/src/autonomy/initiative-engine.ts' },
  { src: 'extensions/subagents/src/autonomy/financial-autonomy.ts', dest: 'extensions/subagents/src/autonomy/financial-autonomy.ts' },
  { src: 'extensions/subagents/src/autonomy/self-healer.ts', dest: 'extensions/subagents/src/autonomy/self-healer.ts' },
  { src: 'extensions/subagents/src/autonomy/security-autopilot.ts', dest: 'extensions/subagents/src/autonomy/security-autopilot.ts' },
  // ── Phase 4: Swarm ────────────────────────────────────────
  { src: 'extensions/subagents/src/swarm/hive-mind.ts', dest: 'extensions/subagents/src/swarm/hive-mind.ts' },
  { src: 'extensions/subagents/src/swarm/mcp-ecosystem.ts', dest: 'extensions/subagents/src/swarm/mcp-ecosystem.ts' },
  // ── Phase 5: Execution ────────────────────────────────────
  { src: 'extensions/subagents/src/execution/fullstack-generator.ts', dest: 'extensions/subagents/src/execution/fullstack-generator.ts' },
  { src: 'extensions/subagents/src/execution/database-intelligence.ts', dest: 'extensions/subagents/src/execution/database-intelligence.ts' },
  // ── Phase 6: Evolution ────────────────────────────────────
  { src: 'extensions/subagents/src/evolution/self-modifier.ts', dest: 'extensions/subagents/src/evolution/self-modifier.ts' },
  { src: 'extensions/subagents/src/evolution/continuous-learning.ts', dest: 'extensions/subagents/src/evolution/continuous-learning.ts' },
  // ── Phase 7: Omega ────────────────────────────────────────
  { src: 'extensions/subagents/src/omega/long-term-planner.ts', dest: 'extensions/subagents/src/omega/long-term-planner.ts' },
  { src: 'extensions/subagents/src/omega/causal-reasoner.ts', dest: 'extensions/subagents/src/omega/causal-reasoner.ts' },
  { src: 'extensions/subagents/src/omega/universal-tool-creator.ts', dest: 'extensions/subagents/src/omega/universal-tool-creator.ts' },
  // ── Phase 8: Plugin System ────────────────────────────────
  { src: 'extensions/subagents/src/plugin-system/plugin-marketplace.ts', dest: 'extensions/subagents/src/plugin-system/plugin-marketplace.ts' },
];

for (const f of filesToCopy) {
  const srcPath = path.join(assetsDir, f.src);
  const destPath = path.join(PI_DIR, f.dest);
  if (f.onlyIfMissing && fs.existsSync(destPath)) {
    continue;
  }
  const destParent = path.dirname(destPath);
  if (!fs.existsSync(destParent)) {
    fs.mkdirSync(destParent, { recursive: true });
  }
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
    fs.writeFileSync(modelsJsonPath, JSON.stringify(cfg, null, 2));
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

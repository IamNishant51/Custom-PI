const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PI_DIR = path.join(os.homedir(), '.pi', 'agent');
const PACK_DIR = path.resolve(__dirname, '..');

console.log('🔄 Syncing local configurations to package assets...');

const filesToSync = [
  { src: 'SYSTEM.md', dest: 'SYSTEM.md' },
  { src: 'settings.json', dest: 'settings.json' },
  { src: 'models.json', dest: 'models.json' },
  { src: 'themes/custom-pi-quantum.json', dest: 'themes/custom-pi-quantum.json' },
  { src: 'agents/builder.md', dest: 'agents/builder.md' },
  { src: 'agents/researcher.md', dest: 'agents/researcher.md' },
  { src: 'agents/reviewer.md', dest: 'agents/reviewer.md' },
  { src: 'agents/ceo.md', dest: 'agents/ceo.md' },
  { src: 'extensions/subagents/package.json', dest: 'extensions/subagents/package.json' },
  { src: 'extensions/subagents/src/index.ts', dest: 'extensions/subagents/src/index.ts' },
  { src: 'extensions/subagents/src/types.d.ts', dest: 'extensions/subagents/src/types.d.ts' },
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
  { src: 'web/web-server.mjs', dest: 'web/web-server.mjs' }
];

const assetDirs = [
  path.join(PACK_DIR, 'assets'),
  path.join(PACK_DIR, 'assets', 'agents'),
  path.join(PACK_DIR, 'assets', 'extensions'),
  path.join(PACK_DIR, 'assets', 'extensions', 'subagents'),
  path.join(PACK_DIR, 'assets', 'extensions', 'subagents', 'src')
];

for (const dir of assetDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

for (const f of filesToSync) {
  const srcPath = path.join(PI_DIR, f.src);
  const destPath = path.join(PACK_DIR, 'assets', f.dest);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`- Synced: ${f.src}`);
  } else {
    console.warn(`- Warning: Source file not found in active config: ${srcPath}`);
  }
}

// Build web client
console.log('\n🔨 Building web client...');
try {
  execSync('npm run build:web', { cwd: PACK_DIR, stdio: 'inherit' });
} catch (e) {
  console.warn('⚠️ Web client build failed (non-fatal):', e.message);
}

console.log('\n📈 Bumping package version...');
const pkgJsonPath = path.join(PACK_DIR, 'package.json');
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

const versionParts = pkgJson.version.split('.').map(Number);
versionParts[2] += 1; // Bump patch version
const newVersion = versionParts.join('.');
pkgJson.version = newVersion;

fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2), 'utf8');
console.log(`- Version bumped to: ${newVersion}`);

console.log('\n🚀 Publishing new version to NPM...');
try {
  execSync('npm publish', { cwd: PACK_DIR, stdio: 'inherit' });
  console.log(`\n🎉 Success! Published custom-pi@${newVersion} to NPM.`);
} catch (e) {
  console.error('\n❌ Failed to publish to NPM:', e.message);
  console.log('Ensure you are logged in using `npm login` before running this command.');
}

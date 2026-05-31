const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST = path.join(__dirname, '..', 'assets', 'web', 'client', 'dist', 'index.html');
if (fs.existsSync(DIST)) {
  process.exit(0);
}

console.log('\x1b[36mBuilding web client...\x1b[0m');
const CLIENT_DIR = path.join(__dirname, '..', 'assets', 'web', 'client');
try {
  execSync('npm install', { cwd: CLIENT_DIR, stdio: 'inherit' });
  execSync('npm run build', { cwd: CLIENT_DIR, stdio: 'inherit' });
} catch {
  console.log('\x1b[33mWeb client build skipped (not critical).\x1b[0m');
}

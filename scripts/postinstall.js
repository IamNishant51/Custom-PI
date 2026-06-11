const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST = path.join(__dirname, '..', 'assets', 'web', 'client', 'dist', 'index.html');
if (fs.existsSync(DIST)) {
  process.exit(0);
}

console.log('\x1b[36mWeb client dist not found. To build it, run:\x1b[0m');
console.log('\x1b[36m  cd assets/web/client && npm install && npm run build\x1b[0m');

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function patchLibraryFiles() {
  const modelsPath = path.join(__dirname, '..', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'models.js');
  if (fs.existsSync(modelsPath)) {
    let content = fs.readFileSync(modelsPath, 'utf8');
    if (content.includes('model.cost.input') || content.includes('usage.cost.input = (model.cost.input')) {
      content = content.replace(
        /export function calculateCost\(model, usage\) \{[\s\S]*?\n\}/,
        `export function calculateCost(model, usage) {\n    const cost = model.cost || {};\n    usage.cost.input = ((cost.input || 0) / 1000000) * usage.input;\n    usage.cost.output = ((cost.output || 0) / 1000000) * usage.output;\n    usage.cost.cacheRead = ((cost.cacheRead || 0) / 1000000) * usage.cacheRead;\n    usage.cost.cacheWrite = ((cost.cacheWrite || 0) / 1000000) * usage.cacheWrite;\n    usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;\n    return usage.cost;\n}`
      );
      fs.writeFileSync(modelsPath, content, 'utf8');
      console.log('\x1b[32mSuccessfully patched models.js for cost safety\x1b[0m');
    }
  }

  const openrouterPath = path.join(__dirname, '..', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'images', 'openrouter.js');
  if (fs.existsSync(openrouterPath)) {
    let content = fs.readFileSync(openrouterPath, 'utf8');
    if (content.includes('model.cost.input')) {
      content = content.replace(/model\.cost\.input/g, '(model.cost?.input || 0)');
      content = content.replace(/model\.cost\.output/g, '(model.cost?.output || 0)');
      content = content.replace(/model\.cost\.cacheRead/g, '(model.cost?.cacheRead || 0)');
      content = content.replace(/model\.cost\.cacheWrite/g, '(model.cost?.cacheWrite || 0)');
      fs.writeFileSync(openrouterPath, content, 'utf8');
      console.log('\x1b[32mSuccessfully patched openrouter.js for cost safety\x1b[0m');
    }
  }
}

try {
  patchLibraryFiles();
  console.log('\x1b[32m✓ custom-pi: assets synced correctly\x1b[0m');
} catch (e) {
  console.error('\x1b[31m✗ custom-pi postinstall failed:\x1b[0m', e.message);
  console.error('\x1b[31m  Try: sudo npm install -g custom-pi\x1b[0m');
  process.exit(1);
}

const DIST = path.join(__dirname, '..', 'assets', 'web', 'client', 'dist', 'index.html');
if (fs.existsSync(DIST)) {
  process.exit(0);
}

console.log('\x1b[36mWeb client dist not found. To build it, run:\x1b[0m');
console.log('\x1b[36m  cd assets/web/client && npm install && npm run build\x1b[0m');

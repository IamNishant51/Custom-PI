const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const COLORS = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${COLORS[color] || ''}${message}${COLORS.reset}`);
}

// 1. Load env variables
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  });
}

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  log('red', '❌ Error: GITHUB_TOKEN or GH_TOKEN is not set in the environment or .env file.');
  log('yellow', 'Please provide a GitHub Personal Access Token to authenticate wiki operations.');
  process.exit(1);
}

const WIKI_DIR = path.join(process.cwd(), 'wiki-temp');

// Cleaning previous run
if (fs.existsSync(WIKI_DIR)) {
  log('yellow', '🧹 Cleaning up existing wiki-temp directory...');
  fs.rmSync(WIKI_DIR, { recursive: true, force: true });
}

// 2. Clone the Wiki Repository using GIT_ASKPASS to avoid token in URL
const gitAskpassPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'git-askpass-')), 'askpass.sh');
const gitAskpassScript = `#!/bin/sh\necho "${token}"`;
fs.writeFileSync(gitAskpassPath, gitAskpassScript, { mode: 0o500 });
log('cyan', '📦 Cloning the GitHub Wiki repository...');
try {
  execSync(`git clone https://github.com/IamNishant51/Custom-PI.wiki.git "${WIKI_DIR}"`, {
    stdio: 'pipe',
    env: { ...process.env, GIT_ASKPASS: gitAskpassPath, GIT_USERNAME: 'x-token-auth', GIT_PASSWORD: token }
  });
  log('green', '✅ Wiki repository cloned successfully.');
} catch (e) {
  log('red', '❌ Error: Failed to clone Wiki repository.');
  log('yellow', 'Please make sure you have visited the Wiki page on GitHub web UI:');
  log('yellow', '👉 https://github.com/IamNishant51/Custom-PI/wiki');
  log('yellow', 'and clicked "Create the first page" (usually named Home) and saved it to initialize the wiki repository.');
  process.exit(1);
}

// 3. Read wiki pages from docs/wiki/
const WIKI_SRC_DIR = path.join(__dirname, '..', 'docs', 'wiki');
log('cyan', '✍️ Reading Wiki pages from docs/wiki/...');
const wikiFiles = fs.readdirSync(WIKI_SRC_DIR).filter(f => f.endsWith('.md'));
if (wikiFiles.length === 0) {
  log('red', '❌ No markdown files found in docs/wiki/');
  process.exit(1);
}
wikiFiles.forEach(filename => {
  const srcPath = path.join(WIKI_SRC_DIR, filename);
  const destPath = path.join(WIKI_DIR, filename);
  fs.copyFileSync(srcPath, destPath);
  log('cyan', `- Copied: ${filename}`);
});

// 4. Commit and Push
log('cyan', '📤 Committing and pushing Wiki pages...');
try {
  const gitOpts = { cwd: WIKI_DIR, stdio: 'inherit' };
  execSync('git add .', gitOpts);
  
  // Set temporary identity if git not configured globally
  try {
    execSync('git config user.name "Custom-PI Release Bootstrapper"', gitOpts);
    execSync('git config user.email "iamnishantunavane@gmail.com"', gitOpts);
  } catch (e) {
    // Ignore if fails
  }

  execSync('git commit -m "docs: deploy comprehensive project wiki documentation"', gitOpts);
  
  // Get active branch name dynamically
  const activeBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: WIKI_DIR, encoding: 'utf8' }).trim();
  log('cyan', `- Pushing wiki pages to branch: ${activeBranch}...`);
  execSync(`git push origin ${activeBranch}`, gitOpts);
  
  log('green', '\n🎉 Success! Custom-PI GitHub Wiki has been successfully updated and published.');
  log('green', '🔗 Wiki Home URL: https://github.com/IamNishant51/Custom-PI/wiki');
} catch (e) {
  log('red', '❌ Error: Failed to commit or push wiki pages.');
  console.error(e.message);
  process.exit(1);
} finally {
  // Clean up
  if (fs.existsSync(WIKI_DIR)) {
    log('yellow', '🧹 Cleaning up wiki-temp directory...');
    fs.rmSync(WIKI_DIR, { recursive: true, force: true });
  }
}

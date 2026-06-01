const fs = require('fs');
const path = require('path');
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

// 1. Load env variables from .env if present
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      // Remove optional quotes around the value
      const cleanedValue = value.replace(/^['"]|['"]$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = cleanedValue;
      }
    }
  });
}

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  log('red', '❌ Error: GITHUB_TOKEN or GH_TOKEN is not set in the environment or .env file.');
  log('yellow', 'Please create a GitHub Personal Access Token (PAT) with `repo` permissions and set it:');
  log('cyan', 'Option A: Add GITHUB_TOKEN=your_token to a .env file in the project root.');
  log('cyan', 'Option B: Run with environment variable: GITHUB_TOKEN=your_token npm run release');
  process.exit(1);
}

// 2. Read package.json to get version and repository URL
const pkgJsonPath = path.join(process.cwd(), 'package.json');
if (!fs.existsSync(pkgJsonPath)) {
  log('red', '❌ Error: package.json not found in the current directory.');
  process.exit(1);
}

const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
const version = pkgJson.version;
const tagName = `v${version}`;

log('cyan', `🚀 Preparing to create GitHub Release for ${COLORS.bold}${tagName}${COLORS.reset}${COLORS.cyan}...`);

// 3. Parse GitHub owner and repository
let repoUrl = '';
if (pkgJson.repository) {
  repoUrl = typeof pkgJson.repository === 'string' ? pkgJson.repository : pkgJson.repository.url || '';
}

let owner = '';
let repo = '';

const githubRegex = /github\.com[\/:]([^\/]+)\/([^\/\.]+?)(?:\.git)?$/;
let match = repoUrl.match(githubRegex);
if (match) {
  owner = match[1];
  repo = match[2];
} else {
  // fallback to git remote
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    match = remoteUrl.match(githubRegex);
    if (match) {
      owner = match[1];
      repo = match[2];
    }
  } catch (e) {
    // Ignore fallback failure
  }
}

if (!owner || !repo) {
  log('red', '❌ Error: Could not determine GitHub owner and repository name.');
  log('yellow', 'Please ensure repository is configured in package.json or git remote origin is set to a GitHub URL.');
  process.exit(1);
}

log('cyan', `- Repository detected: ${owner}/${repo}`);

// 4. Check for uncommitted changes
let isClean = true;
try {
  const statusOutput = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (statusOutput) {
    isClean = false;
    log('yellow', '⚠️ Warning: You have uncommitted changes in your repository:');
    console.log(statusOutput);
  }
} catch (e) {
  log('yellow', '⚠️ Warning: Could not check git status.');
}

// 5. Get current branch
let currentBranch = 'main';
try {
  currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
} catch (e) {
  log('yellow', `⚠️ Warning: Could not determine current branch, defaulting to 'main'.`);
}

// 6. Get commits since the last tag for the release notes
let prevTag = '';
try {
  prevTag = execSync('git describe --tags --abbrev=0 HEAD~1', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
} catch (e) {
  // No previous tags found or command failed, which is fine
}

let changelog = '';
if (prevTag) {
  try {
    changelog = execSync(`git log ${prevTag}..HEAD --oneline`, { encoding: 'utf8' }).trim();
    log('cyan', `- Commits since last tag (${prevTag}):`);
    console.log(changelog.split('\n').map(line => `  * ${line}`).join('\n'));
  } catch (e) {
    log('yellow', '⚠️ Warning: Could not generate git changelog.');
  }
} else {
  try {
    changelog = execSync('git log --oneline -n 20', { encoding: 'utf8' }).trim();
    log('cyan', '- Recent commits (no previous tag found):');
    console.log(changelog.split('\n').map(line => `  * ${line}`).join('\n'));
  } catch (e) {
    // Ignore
  }
}

// Format markdown release notes body
let releaseBody = `## Release ${tagName}\n\n`;
if (changelog) {
  releaseBody += `### Changes in this Release\n\n`;
  releaseBody += changelog.split('\n').map(line => `* ${line}`).join('\n');
} else {
  releaseBody += `Features and improvements in this release.`;
}

// 7. Create and push tag
let tagExists = false;
try {
  execSync(`git show-ref --tags ${tagName}`, { stdio: 'ignore' });
  tagExists = true;
  log('yellow', `ℹ️ Tag ${tagName} already exists locally.`);
} catch (e) {
  // Tag doesn't exist
}

if (!tagExists) {
  try {
    log('cyan', `🏷️ Creating local tag ${tagName}...`);
    execSync(`git tag -a ${tagName} -m "Release ${tagName}"`, { stdio: 'inherit' });
    log('green', `✅ Created tag ${tagName} successfully.`);
  } catch (e) {
    log('red', `❌ Error: Failed to create tag ${tagName}.`);
    console.error(e.message);
    process.exit(1);
  }
}

try {
  log('cyan', `📤 Pushing tag ${tagName} to GitHub origin...`);
  execSync(`git push origin ${tagName}`, { stdio: 'inherit' });
  log('green', `✅ Pushed tag ${tagName} successfully.`);
} catch (e) {
  log('red', `❌ Error: Failed to push tag ${tagName} to origin.`);
  console.error(e.message);
  process.exit(1);
}

// 8. Call GitHub API to create release
async function createGitHubRelease() {
  log('cyan', `🌐 Connecting to GitHub API to create release...`);

  const url = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const body = {
    tag_name: tagName,
    target_commitish: currentBranch,
    name: tagName,
    body: releaseBody,
    draft: false,
    prerelease: false,
    generate_release_notes: true
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'custom-pi-release-script',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (response.ok) {
      log('green', `\n🎉 Success! GitHub Release ${COLORS.bold}${tagName}${COLORS.reset}${COLORS.green} has been published.`);
      log('green', `🔗 Release URL: ${data.html_url}`);
    } else {
      log('red', `\n❌ GitHub API Error (${response.status}): ${data.message || response.statusText}`);
      if (data.errors) {
        console.error('Details:', data.errors);
      }
      process.exit(1);
    }
  } catch (err) {
    log('red', `\n❌ Network error while calling GitHub API:`);
    console.error(err);
    process.exit(1);
  }
}

createGitHubRelease();

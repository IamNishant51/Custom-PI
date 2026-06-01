const { readFileSync, readdirSync, existsSync, statSync } = require("fs");
const { join, extname } = require("path");

const AGENTS_DIR = join(__dirname, "..", "..", "assets", "agents");

const REQUIRED_FRONTMATTER = ["name", "description", "systemPrompt", "tools"];

function validateAgent(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const errors = [];

  if (!content.startsWith("---")) {
    errors.push("Missing YAML frontmatter (must start with ---)");
    return errors;
  }

  const endMatch = content.indexOf("\n---\n", 4);
  if (endMatch === -1) {
    errors.push("Unclosed YAML frontmatter (missing closing ---)");
    return errors;
  }

  const frontmatter = content.slice(4, endMatch);

  for (const field of REQUIRED_FRONTMATTER) {
    if (!frontmatter.includes(`${field}:`)) {
      errors.push(`Missing required frontmatter field: ${field}`);
    }
  }

  return errors;
}

let allPassed = true;
let totalFiles = 0;
let totalErrors = 0;

if (!existsSync(AGENTS_DIR)) {
  console.log("No agents directory found — skipping.");
  process.exit(0);
}

const files = readdirSync(AGENTS_DIR).filter(f => extname(f) === ".md");
totalFiles = files.length;

for (const file of files) {
  const filePath = join(AGENTS_DIR, file);
  if (!statSync(filePath).isFile()) continue;
  const errors = validateAgent(filePath);
  if (errors.length > 0) {
    console.log(`FAIL: ${file}`);
    errors.forEach(e => console.log(`  - ${e}`));
    totalErrors += errors.length;
    allPassed = false;
  } else {
    console.log(`OK:   ${file}`);
  }
}

console.log(`\n${totalFiles} agent files checked. ${totalErrors > 0 ? totalErrors + " errors." : "All valid."}`);
process.exit(allPassed ? 0 : 1);

const { readFileSync, readdirSync, existsSync, statSync } = require("fs");
const { join } = require("path");

const SKILLS_DIRS = [
  join(require("os").homedir(), ".pi", "skills", "agent"),
  join(require("os").homedir(), ".pi", "skills", "user"),
];

const REQUIRED_FRONTMATTER = ["name", "description"];

function validateSkill(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const errors = [];

  if (!content.startsWith("---")) {
    errors.push("Missing YAML frontmatter");
    return errors;
  }

  const endMatch = content.indexOf("\n---\n", 4);
  if (endMatch === -1) {
    errors.push("Unclosed YAML frontmatter");
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

for (const skillsDir of SKILLS_DIRS) {
  if (!existsSync(skillsDir)) continue;

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) {
      console.log(`WARN: ${entry.name} has no SKILL.md`);
      continue;
    }
    totalFiles++;
    const errors = validateSkill(skillFile);
    if (errors.length > 0) {
      console.log(`FAIL: ${entry.name}`);
      errors.forEach(e => console.log(`  - ${e}`));
      totalErrors += errors.length;
      allPassed = false;
    } else {
      console.log(`OK:   ${entry.name}`);
    }
  }
}

console.log(`\n${totalFiles} skill files checked. ${totalErrors > 0 ? totalErrors + " errors." : "All valid."}`);
process.exit(allPassed ? 0 : 1);

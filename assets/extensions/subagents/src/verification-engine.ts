export interface VerificationAssertion {
  id: string;
  ruleName: string;
  severity: "blocker" | "warning";
  assertionFn: (codeDiff: string, fileContext: string) => Promise<{ passed: boolean; reason?: string }>;
}

// ── Blockers ────────────────────────────────────────────────────────────────

export const secretsLeakedAssertion: VerificationAssertion = {
  id: "VERIFY_002",
  ruleName: "No Exposed Secrets or Credentials",
  severity: "blocker",
  assertionFn: async (diff) => {
    const genericApiKey = /(api[_-]?key|secret|password|passwd|authorization)\s*[:=]\s*["'][a-zA-Z0-9_\-]{16,}["']/i;
    const githubPat = /ghp_[a-zA-Z0-9]{36}/;
    const githubOauth = /gho_[a-zA-Z0-9]{36}/;
    const slackToken = /xoxb-[0-9]{11}-[0-9]{12}-[a-zA-Z0-9]{24}/;
    const slackUserToken = /xoxp-[0-9]{11}-[0-9]{12}-[a-zA-Z0-9]{24}/;
    const awsKey = /AKIA[0-9A-Z]{16}/;
    const bearerToken = /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/;
    const openaiKey = /sk-[a-zA-Z0-9]{20,}/;
    const anthropicKey = /sk-ant-[a-zA-Z0-9]{20,}/;

    if (githubPat.test(diff)) return { passed: false, reason: "Detected a hardcoded GitHub Personal Access Token." };
    if (githubOauth.test(diff)) return { passed: false, reason: "Detected a hardcoded GitHub OAuth token." };
    if (slackToken.test(diff) || slackUserToken.test(diff)) return { passed: false, reason: "Detected a hardcoded Slack token." };
    if (awsKey.test(diff)) return { passed: false, reason: "Detected a hardcoded AWS Access Key." };
    if (openaiKey.test(diff)) return { passed: false, reason: "Detected a hardcoded OpenAI API key." };
    if (anthropicKey.test(diff)) return { passed: false, reason: "Detected a hardcoded Anthropic API key." };
    if (bearerToken.test(diff)) return { passed: false, reason: "Detected a hardcoded Bearer token." };
    if (genericApiKey.test(diff)) return { passed: false, reason: "Detected a potential API key or credential being hardcoded." };
    return { passed: true };
  }
};

export const evalAssertion: VerificationAssertion = {
  id: "VERIFY_005",
  ruleName: "No eval() Usage",
  severity: "blocker",
  assertionFn: async (diff) => {
    if (/\beval\s*\(/.test(diff)) {
      return { passed: false, reason: "eval() is a security risk and code injection vector. Use safer alternatives like JSON.parse() or Function constructor." };
    }
    return { passed: true };
  }
};

export const newFunctionAssertion: VerificationAssertion = {
  id: "VERIFY_006",
  ruleName: "No new Function() Usage",
  severity: "blocker",
  assertionFn: async (diff) => {
    if (/new\s+Function\s*\(/.test(diff)) {
      return { passed: false, reason: "new Function() is a code injection vector similar to eval(). Use module-level functions or JSON.parse() instead." };
    }
    return { passed: true };
  }
};

export const setTimeoutStringAssertion: VerificationAssertion = {
  id: "VERIFY_007",
  ruleName: "No setTimeout with String Argument",
  severity: "blocker",
  assertionFn: async (diff) => {
    if (/setTimeout\s*\(\s*["'`]/.test(diff)) {
      return { passed: false, reason: "setTimeout with a string argument is equivalent to eval(). Pass a function instead." };
    }
    return { passed: true };
  }
};

export const childProcessExecAssertion: VerificationAssertion = {
  id: "VERIFY_008",
  ruleName: "Prefer execFileSync Over execSync",
  severity: "blocker",
  assertionFn: async (diff) => {
    if (/\bexecSync\s*\(/.test(diff) && !/execFileSync\s*\(/.test(diff)) {
      return { passed: false, reason: "execSync() is vulnerable to shell injection. Use execFileSync() with array arguments instead." };
    }
    return { passed: true };
  }
};

// ── Warnings ────────────────────────────────────────────────────────────────

export const windowMutationAssertion: VerificationAssertion = {
  id: "VERIFY_001",
  ruleName: "No Global Window Mutations",
  severity: "blocker",
  assertionFn: async (diff) => {
    const windowMutationRegex = /window\.[a-zA-Z0-9_]+\s*=\s*(?!function)/g;
    if (windowMutationRegex.test(diff)) {
      return {
        passed: false,
        reason: "Detected direct global window property assignment. Use local state, props, or Context instead."
      };
    }
    return { passed: true };
  }
};

export const lazyPlaceholdersAssertion: VerificationAssertion = {
  id: "VERIFY_003",
  ruleName: "No Placeholder or TODO Implementations",
  severity: "warning",
  assertionFn: async (diff) => {
    const placeholderRegex = /(\/\/|#|\/\*)\s*(todo:?\s*implement|implement\s*later|code\s*goes\s*here|add\s*logic\s*here)/i;
    if (placeholderRegex.test(diff)) {
      return {
        passed: false,
        reason: "Detected placeholder comments (e.g. 'TODO: implement' or 'code goes here'). Please write complete functional code."
      };
    }
    return { passed: true };
  }
};

export const absolutePathsAssertion: VerificationAssertion = {
  id: "VERIFY_004",
  ruleName: "No Hardcoded Absolute Host Paths",
  severity: "warning",
  assertionFn: async (diff) => {
    const hostPathRegex = /["']\/(home|etc|var|usr|bin|tmp)\/[a-zA-Z0-9_\-\.\/]+["']/g;
    if (hostPathRegex.test(diff)) {
      return {
        passed: false,
        reason: "Detected hardcoded absolute host paths. Use relative paths resolved against the project workspace."
      };
    }
    return { passed: true };
  }
};

export const consoleLogAssertion: VerificationAssertion = {
  id: "VERIFY_009",
  ruleName: "No console.log in Production Code",
  severity: "warning",
  assertionFn: async (diff) => {
    if (/\bconsole\.(log|debug)\s*\(/.test(diff)) {
      return { passed: false, reason: "console.log/debug left in code. Use a proper logger or remove for production." };
    }
    return { passed: true };
  }
};

export const varDeclarationAssertion: VerificationAssertion = {
  id: "VERIFY_010",
  ruleName: "No var Declarations",
  severity: "warning",
  assertionFn: async (diff) => {
    if (/\bvar\s+[a-zA-Z]/.test(diff)) {
      return { passed: false, reason: "'var' is function-scoped and error-prone. Use 'const' or 'let' instead." };
    }
    return { passed: true };
  }
};

export const emptyCatchAssertion: VerificationAssertion = {
  id: "VERIFY_011",
  ruleName: "No Empty Catch Blocks",
  severity: "warning",
  assertionFn: async (diff) => {
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(diff) || /catch\s*\{\s*\}/.test(diff)) {
      return { passed: false, reason: "Empty catch block silently swallows errors. Add error logging or re-throw." };
    }
    return { passed: true };
  }
};

export const syncIoAssertion: VerificationAssertion = {
  id: "VERIFY_012",
  ruleName: "Avoid Synchronous File I/O in Async Context",
  severity: "warning",
  assertionFn: async (diff) => {
    if (/async\s/.test(diff) && /\bfs\.(readFileSync|writeFileSync|existsSync|mkdirSync)\s*\(/.test(diff)) {
      return { passed: false, reason: "Synchronous file I/O in async context blocks the event loop. Use fs/promises instead." };
    }
    return { passed: true };
  }
};

export const hardcodedPortAssertion: VerificationAssertion = {
  id: "VERIFY_013",
  ruleName: "No Hardcoded Ports Without env Fallback",
  severity: "warning",
  assertionFn: async (diff) => {
    const portRegex = /(?:port|PORT)\s*[:=]\s*(\d{4,5})\b/g;
    let match;
    while ((match = portRegex.exec(diff)) !== null) {
      const port = parseInt(match[1]);
      if (port >= 1024 && port <= 65535 && !diff.includes(`process.env`) && !diff.includes(`env.`)) {
        return { passed: false, reason: `Hardcoded port ${port} detected. Use process.env or a config variable for portability.` };
      }
    }
    return { passed: true };
  }
};

export const processExitAssertion: VerificationAssertion = {
  id: "VERIFY_014",
  ruleName: "No process.exit() in Library Code",
  severity: "warning",
  assertionFn: async (diff) => {
    if (/\bprocess\.exit\s*\(/.test(diff)) {
      return { passed: false, reason: "process.exit() in library code can terminate the entire process unexpectedly. Throw an error instead." };
    }
    return { passed: true };
  }
};

export const memoryLeakAssertion: VerificationAssertion = {
  id: "VERIFY_015",
  ruleName: "No Potential Memory Leaks",
  severity: "warning",
  assertionFn: async (diff) => {
    if (/setInterval\s*\(/.test(diff) && !/clearInterval/.test(diff)) {
      return { passed: false, reason: "setInterval without corresponding clearInterval may cause memory leaks. Store the timer ID and clean up." };
    }
    if (/addEventListener\s*\(/.test(diff) && !/removeEventListener/.test(diff) && !/once/.test(diff)) {
      return { passed: false, reason: "addEventListener without removeEventListener may cause memory leaks. Consider using { once: true } or cleaning up." };
    }
    return { passed: true };
  }
};

// ── Assertion Registry ──────────────────────────────────────────────────────

export const ASSERTIONS: VerificationAssertion[] = [
  // Blockers
  secretsLeakedAssertion,
  evalAssertion,
  newFunctionAssertion,
  setTimeoutStringAssertion,
  childProcessExecAssertion,
  // Warnings
  windowMutationAssertion,
  lazyPlaceholdersAssertion,
  absolutePathsAssertion,
  consoleLogAssertion,
  varDeclarationAssertion,
  emptyCatchAssertion,
  syncIoAssertion,
  hardcodedPortAssertion,
  processExitAssertion,
  memoryLeakAssertion,
];

export async function runVerification(codeDiff: string, fileContext: string): Promise<{
  passed: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const assertion of ASSERTIONS) {
    try {
      const res = await assertion.assertionFn(codeDiff, fileContext);
      if (!res.passed) {
        if (assertion.severity === "blocker") {
          errors.push(`[BLOCKER] ${assertion.ruleName}: ${res.reason}`);
        } else {
          warnings.push(`[WARNING] ${assertion.ruleName}: ${res.reason}`);
        }
      }
    } catch {
      // Ignore assertion evaluation errors
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings
  };
}

export interface VerificationAssertion {
  id: string;
  ruleName: string;
  severity: "blocker" | "warning";
  assertionFn: (codeDiff: string, fileContext: string) => Promise<{ passed: boolean; reason?: string }>;
}

export const windowMutationAssertion: VerificationAssertion = {
  id: "VERIFY_001",
  ruleName: "No Global Window Mutations",
  severity: "blocker",
  assertionFn: async (diff) => {
    const windowMutationRegex = /window\.[a-zA-Z0-9_]+\s*=/g;
    if (windowMutationRegex.test(diff)) {
      return {
        passed: false,
        reason: "Detected direct global window property assignment. Use local state, props, or Context instead."
      };
    }
    return { passed: true };
  }
};

export const secretsLeakedAssertion: VerificationAssertion = {
  id: "VERIFY_002",
  ruleName: "No Exposed Secrets or Credentials",
  severity: "blocker",
  assertionFn: async (diff) => {
    // Detect standard token/secret formats
    const genericApiKey = /(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["'][a-zA-Z0-9_\-]{16,}["']/i;
    const githubPat = /ghp_[a-zA-Z0-9]{36}/;
    const slackToken = /xoxb-[0-9]{11}-[0-9]{12}-[a-zA-Z0-9]{24}/;
    
    if (githubPat.test(diff)) {
      return { passed: false, reason: "Detected a hardcoded GitHub Personal Access Token." };
    }
    if (slackToken.test(diff)) {
      return { passed: false, reason: "Detected a hardcoded Slack token." };
    }
    if (genericApiKey.test(diff)) {
      return { passed: false, reason: "Detected a potential API Key or credential being hardcoded." };
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
    // Exclude /dev/null and standard web URLs, focus on root directory indicators
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

export const ASSERTIONS: VerificationAssertion[] = [
  windowMutationAssertion,
  secretsLeakedAssertion,
  lazyPlaceholdersAssertion,
  absolutePathsAssertion
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
    } catch (err: any) {
      // Ignore or log validation evaluation errors
    }
  }
  
  return {
    passed: errors.length === 0,
    errors,
    warnings
  };
}

// ── AI Evaluation Harness ──────────────────────────────────────────
// Defines test tasks, runs them against LLM, scores outputs.

const EVAL_TASKS = [
  {
    id: "code_gen_simple",
    category: "code_gen",
    prompt: "Write a JavaScript function that returns the Fibonacci sequence up to n terms.",
    checks: ["fibonacci", "function", "return"],
    difficulty: "easy",
  },
  {
    id: "code_gen_read_file",
    category: "tool_use",
    prompt: "Use the read_file tool to read /etc/hostname and report its contents.",
    checks: ["read_file", "/etc/hostname"],
    difficulty: "medium",
  },
  {
    id: "qa_factual",
    category: "qa",
    prompt: "What is the capital of France?",
    checks: ["Paris"],
    difficulty: "easy",
  },
  {
    id: "reasoning_logic",
    category: "reasoning",
    prompt: "If a bat and ball cost $1.10 in total, and the bat costs $1.00 more than the ball, how much does the ball cost?",
    checks: ["5", "0.05", "5 cents", "five cents"],
    difficulty: "medium",
  },
  {
    id: "code_gen_debug",
    category: "code_gen",
    prompt: "This code has a bug: 'function add(a,b) { return a - b }'. Fix it to return the sum.",
    checks: ["a + b", "return"],
    difficulty: "easy",
  },
];

function scoreResponse(response, checks) {
  if (!response || typeof response !== "string") return { passed: false, score: 0, details: "No response" };
  const lower = response.toLowerCase();
  const passed = checks.filter(c => lower.includes(c.toLowerCase()));
  const score = passed.length / checks.length;
  return { passed: score >= 0.5, score, details: `Passed ${passed.length}/${checks.length} checks: ${passed.join(", ") || "none"}` };
}

export function getEvalTasks() {
  return EVAL_TASKS.map(t => ({ id: t.id, category: t.category, prompt: t.prompt, difficulty: t.difficulty }));
}

export async function runEval(runTask) {
  const results = [];
  for (const task of EVAL_TASKS) {
    const start = Date.now();
    let response = "";
    let error = null;
    try {
      response = await runTask(task.prompt);
    } catch (e) {
      error = e.message;
    }
    const latency = Date.now() - start;
    const scored = scoreResponse(response, task.checks);
    results.push({
      id: task.id,
      category: task.category,
      difficulty: task.difficulty,
      prompt: task.prompt,
      latency,
      ...scored,
      error,
    });
  }
  const passed = results.filter(r => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length > 0 ? Math.round(passed / results.length * 100) : 0,
    results,
    timestamp: new Date().toISOString(),
  };
}

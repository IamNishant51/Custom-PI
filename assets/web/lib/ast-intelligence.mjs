import path from "node:path";

export function detectAstLanguage(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
  };
  return map[ext] || null;
}

export function extractFunctions(content, language) {
  const funcPatterns = {
    javascript: /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?:::?\s*[A-Z]\w*)?\s*=>|(\w+)\s*\([^)]*\)\s*\{|async\s+(\w+)\s*\([^)]*\))/g,
    typescript: /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*[:=]\s*(?:async\s*)?\([^)]*\)|(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{|async\s+(\w+)\s*\([^)]*\))/g,
    python: /def\s+(\w+)\s*\(/g,
    rust: /fn\s+(\w+)\s*\(/g,
    go: /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/g,
    java: /(?:public|private|protected|static)?\s*(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*(?:\{|throws)/g,
  };
  const pattern = funcPatterns[language] || funcPatterns.javascript;
  const functions = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const name = match.slice(1).find(Boolean);
    if (name) functions.push(name);
  }
  return functions;
}

export function extractClasses(content, language) {
  const classPatterns = {
    javascript: /class\s+(\w+)/g,
    typescript: /class\s+(\w+)/g,
    python: /class\s+(\w+)/g,
    java: /(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/g,
    rust: /struct\s+(\w+)|enum\s+(\w+)/g,
  };
  const pattern = classPatterns[language] || classPatterns.javascript;
  const classes = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const name = match.slice(1).find(Boolean);
    if (name) classes.push(name);
  }
  return classes;
}

export function extractImports(content, language) {
  const importPatterns = {
    javascript: /(?:import\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g,
    typescript: /(?:import\s+(?:\{[^}]*\}\s+from\s+|type\s+\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g,
    python: /(?:import\s+(\w+)|from\s+(\w+)\s+import)/g,
    rust: /(?:use\s+([\w:]+)|extern\s+crate\s+(\w+))/g,
    go: /(?:import\s+(?:"([^"]+)"|\(([^)]+)\)))/g,
  };
  const pattern = importPatterns[language] || importPatterns.javascript;
  const imports = new Set();
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const imp = match.slice(1).find(Boolean);
    if (imp) imports.add(imp.trim().split("\n")[0].trim());
  }
  return [...imports];
}

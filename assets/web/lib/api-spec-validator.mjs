import { parse as parseYaml } from "yaml";

function parseSpec(specStr, specType) {
  if (specType === "graphql") return { raw: specStr, type: "graphql" };
  try {
    const parsed = JSON.parse(specStr);
    return { raw: specStr, type: "openapi", parsed };
  } catch {
    try {
      const parsed = parseYaml(specStr);
      return { raw: specStr, type: "openapi", parsed };
    } catch {
      return { raw: specStr, type: "unknown" };
    }
  }
}

function mapTypeToTS(schema) {
  if (schema.$ref) return schema.$ref.split("/").pop();
  if (schema.type === "array") return `${mapTypeToTS(schema.items || { type: "any" })}[]`;
  const map = { string: "string", integer: "number", number: "number", boolean: "boolean", object: "Record<string, any>" };
  return map[schema.type] || "any";
}

function mapGraphQLTypeToTS(type) {
  const map = { String: "string", Int: "number", Float: "number", Boolean: "boolean", ID: "string" };
  return map[type.trim()] || type.trim();
}

function extractRefName(responseObj) {
  const content = responseObj.content?.["application/json"]?.schema;
  if (!content) return null;
  if (content.$ref) return content.$ref.split("/").pop();
  if (content.type === "array" && content.items?.$ref) return `${content.items.$ref.split("/").pop()}[]`;
  return null;
}

export function validateOpenAPI(specStr) {
  const spec = parseSpec(specStr, "openapi");
  if (spec.type !== "openapi" || !spec.parsed) return "❌ Could not parse as OpenAPI JSON/YAML";
  const issues = [];
  const doc = spec.parsed;
  if (!doc.openapi && !doc.swagger) issues.push("❌ Missing 'openapi' or 'swagger' version field");
  if (!doc.info) issues.push("❌ Missing 'info' object (title, version)");
  if (!doc.paths || Object.keys(doc.paths).length === 0) issues.push("❌ No paths defined in the spec");
  if (doc.paths) {
    for (const [path, methods] of Object.entries(doc.paths)) {
      if (!methods || typeof methods !== "object") continue;
      for (const [method, op] of Object.entries(methods)) {
        if (["get", "post", "put", "patch", "delete", "options", "head", "trace"].includes(method)) {
          if (!op.operationId) issues.push(`⚠️ Path ${path.toUpperCase()} ${method} missing operationId`);
          if (!op.responses) issues.push(`❌ Path ${path.toUpperCase()} ${method} missing responses`);
          else if (!op.responses["200"] && !op.responses["201"] && !op.responses["204"]) issues.push(`⚠️ Path ${path.toUpperCase()} ${method} missing success response (200/201/204)`);
        }
      }
    }
  }
  if (!issues.length) return "✅ OpenAPI spec is valid and well-formed.";
  return `## Validation Results\n${issues.join("\n")}`;
}

export function lintOpenAPI(specStr) {
  const spec = parseSpec(specStr, "openapi");
  if (!spec.parsed) return ["❌ Could not parse spec"];
  const issues = [];
  const doc = spec.parsed;
  const p = doc.paths || {};
  for (const [path, methods] of Object.entries(p)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      if (!op.summary) issues.push(`📝 ${method.toUpperCase()} ${path} — missing summary`);
      if (!op.tags || op.tags.length === 0) issues.push(`🏷️ ${method.toUpperCase()} ${path} — no tags (consider grouping by domain)`);
      if (op.requestBody && !op.requestBody.content) issues.push(`📦 ${method.toUpperCase()} ${path} — requestBody has no content type`);
      if (op.parameters) {
        const hasPage = op.parameters.some(p => p.name === "page" || p.name === "offset");
        const hasLimit = op.parameters.some(p => p.name === "limit" || p.name === "per_page");
        if (method === "get" && hasPage !== hasLimit) issues.push(`📄 ${method.toUpperCase()} ${path} — pagination: use both page/offset AND limit/per_page`);
      }
    }
  }
  if (!doc.components?.schemas && !doc.definitions) issues.push("🧩 No reusable schemas/components defined");
  if (doc.info && !doc.info.description) issues.push("📋 No API description in info object");
  return issues;
}

export function diffOpenAPI(oldSpecStr, newSpecStr) {
  const oldSpec = parseSpec(oldSpecStr, "openapi");
  const newSpec = parseSpec(newSpecStr, "openapi");
  if (!oldSpec.parsed || !newSpec.parsed) return ["Could not parse one or both specs"];
  const changes = [];
  const oldPaths = oldSpec.parsed.paths || {};
  const newPaths = newSpec.parsed.paths || {};
  for (const [path, methods] of Object.entries(newPaths)) {
    if (!oldPaths[path]) { changes.push(`➕ New path: ${path}`); continue; }
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      if (!oldPaths[path][method]) { changes.push(`➕ New endpoint: ${method.toUpperCase()} ${path}`); continue; }
      const oldOp = oldPaths[path][method];
      const oldParams = new Set((oldOp.parameters || []).map(p => p.name));
      const newParams = new Set((op.parameters || []).map(p => p.name));
      for (const p of oldParams) { if (!newParams.has(p)) changes.push(`⚠️ Removed required parameter: "${p}" from ${method.toUpperCase()} ${path} — BREAKING`); }
      if (oldOp.responses?.["200"] && op.responses?.["200"]) {
        const oldSchema = JSON.stringify(oldOp.responses["200"]);
        const newSchema = JSON.stringify(op.responses["200"]);
        if (oldSchema !== newSchema) changes.push(`⚠️ Response schema changed for ${method.toUpperCase()} ${path} — potentially BREAKING`);
      }
    }
  }
  for (const path of Object.keys(oldPaths)) { if (!newPaths[path]) changes.push(`🗑️ Removed path: ${path} — BREAKING`); }
  return changes;
}

export function generateStubsOpenAPI(specStr, lang) {
  const spec = parseSpec(specStr, "openapi");
  if (!spec.parsed) return "Could not parse OpenAPI spec";
  const doc = spec.parsed;
  const baseName = doc.info?.title?.replace(/\s+/g, "") || "Api";
  let code = "";
  if (lang === "typescript") {
    code += `// ${baseName} API Client — Auto-generated\n\n`;
    if (doc.components?.schemas) {
      for (const [name, schema] of Object.entries(doc.components.schemas)) {
        const props = schema.properties || {};
        const fields = Object.entries(props).map(([p, ps]) => `  ${p}${schema.required?.includes(p) ? "" : "?"}: ${mapTypeToTS(ps)};`).join("\n");
        code += `interface ${name} {\n${fields}\n}\n\n`;
      }
    }
    const p = doc.paths || {};
    for (const [path, methods] of Object.entries(p)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const name = op.operationId || `${method}${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const params = (op.parameters || []).map(p => `${p.name}: ${mapTypeToTS(p.schema || { type: "string" })}`).join(", ");
        code += `async ${name}(${params}): Promise<${op.responses?.["200"] ? extractRefName(op.responses["200"]) || "any" : "any"}> {\n`;
        code += `  return this.request("${method.toUpperCase()}", \`${path}\`, { ${(op.parameters || []).map(p => p.name).join(", ")} });\n`;
        code += `}\n\n`;
      }
    }
    code += `// Usage:\n// const client = new ${baseName}Client({ baseUrl: "https://api.example.com" });\n`;
  } else if (lang === "python") {
    code += `# ${baseName} API Client — Auto-generated\n\nclass ${baseName}Client:\n`;
    code += `  def __init__(self, base_url: str, api_key: str | None = None):\n`;
    code += `    self.base_url = base_url.rstrip("/")\n    self.session = requests.Session()\n`;
    code += `    if api_key:\n      self.session.headers["Authorization"] = f"Bearer {api_key}"\n\n`;
    const p = doc.paths || {};
    for (const [path, methods] of Object.entries(p)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const name = op.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
        code += `  def ${name}(self):\n    ...  # TODO: implement\n\n`;
      }
    }
  }
  return code || `Stub generation for ${lang} is not yet implemented.`;
}

export function generateStubsGraphQL(specStr, lang) {
  const typeRegex = /(?:type|interface|input|enum)\s+(\w+)(?:\s+implements\s+\w+)?\s*\{([^}]+)\}/g;
  let match;
  let code = "";
  if (lang === "typescript") {
    code += "// GraphQL Types — Auto-generated from SDL\n\n";
    while ((match = typeRegex.exec(specStr)) !== null) {
      const [_, name, fields] = match;
      const fieldLines = fields.trim().split("\n").map(f => {
        const trimmed = f.trim();
        if (!trimmed || trimmed.startsWith("#")) return null;
        const parts = trimmed.split(":");
        if (parts.length < 2) return null;
        const fieldName = parts[0].trim();
        const fieldType = parts.slice(1).join(":").trim().replace(/!$/, "").replace(/\[([^\]]+)\]/, "$1[]");
        return `  ${fieldName}: ${mapGraphQLTypeToTS(fieldType)};`;
      }).filter(Boolean);
      code += `interface ${name} {\n${fieldLines.join("\n")}\n}\n\n`;
    }
  }
  return code || "# TypeScript stub generation for GraphQL\n\n// Copy your SDL above this line\nexport type {};\n";
}

export function validateGraphQLSchema(schemaStr) {
  const issues = [];
  if (!schemaStr.includes("type Query") && !schemaStr.includes("type Mutation") && !schemaStr.includes("type Subscription")) {
    issues.push("❌ No Query, Mutation, or Subscription type found (root types define entry points)");
  }
  const definedTypes = [...schemaStr.matchAll(/(?:type|interface|input|enum)\s+(\w+)/g)].map(m => m[1]);
  const usedTypes = [...schemaStr.matchAll(/:(\w+)/g)].map(m => m[1]);
  const unresolved = usedTypes.filter(t => !definedTypes.includes(t) && !["String", "Int", "Float", "Boolean", "ID"].includes(t));
  if (unresolved.length) issues.push(`❌ Unresolved type references: ${[...new Set(unresolved)].join(", ")}`);
  if (schemaStr.includes("type Query")) {
    const queryFields = schemaStr.match(/type Query\s*\{([^}]+)\}/);
    if (!queryFields || !queryFields[1].trim()) issues.push("⚠️ Query type is empty (no entry points defined)");
  }
  if (!issues.length) return "✅ GraphQL schema is valid and well-formed.";
  return `## Validation Results\n${issues.join("\n")}`;
}

export function lintGraphQLSchema(schemaStr) {
  const issues = [];
  if (!schemaStr.match(/#.*/g)) issues.push("💬 No documentation comments found (consider documenting types and fields)");
  const types = [...schemaStr.matchAll(/type\s+(\w+)\s*\{([^}]+)\}/g)];
  for (const [, name, fields] of types) {
    const fieldLines = fields.split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of fieldLines) {
      if (line.endsWith("!")) issues.push(`📝 ${name}.${line.split(":")[0]?.trim()} — non-nullable field without default`);
    }
  }
  return issues;
}

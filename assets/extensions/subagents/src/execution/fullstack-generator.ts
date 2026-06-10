import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { bus, Topics } from "../event-bus/event-bus";

export type TechStack = "nextjs" | "express" | "fastify" | "react" | "vue" | "svelte" | "python-fastapi" | "python-flask" | "go-gin" | "rust-actix";
export type Database = "postgres" | "sqlite" | "mysql" | "mongodb" | "redis";
export type AuthProvider = "jwt" | "session" | "oauth" | "clerk" | "next-auth" | "none";

interface ProjectSpec {
  name: string;
  description: string;
  stack: TechStack;
  database: Database;
  auth: AuthProvider;
  features: string[];
  apiEndpoints: string[];
  models: string[];
  frontendComponents: string[];
}

interface GeneratedFile {
  path: string;
  content: string;
}

export class FullstackGenerator {
  generateProject(spec: ProjectSpec): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const basePath = spec.name;

    files.push(...this.generateConfigFiles(spec));
    files.push(...this.generateDatabase(spec));
    files.push(...this.generateAuth(spec));
    files.push(...this.generateApi(spec));
    files.push(...this.generateModels(spec));
    files.push(...this.generateFrontend(spec));
    files.push(...this.generateDeployment(spec));

    bus.emit(Topics.PLAN_CREATED, {
      goal: `Generate ${spec.name}`,
      fileCount: files.length,
      stack: spec.stack,
    }, { source: "fullstack-generator" });

    return files;
  }

  generateReadme(spec: ProjectSpec): string {
    return `# ${spec.name}

${spec.description}

## Tech Stack
- **Backend:** ${spec.stack}
- **Database:** ${spec.database}
- **Auth:** ${spec.auth}
- **Features:** ${spec.features.join(", ")}

## Getting Started
\`\`\`bash
npm install
npm run dev
\`\`\`

## API Endpoints
${spec.apiEndpoints.map(e => `- \`${e}\``).join("\n")}

## Environment Variables
\`\`\`
DATABASE_URL=
JWT_SECRET=
PORT=3000
\`\`\`
`;
  }

  private generateConfigFiles(spec: ProjectSpec): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    files.push({
      path: `${spec.name}/package.json`,
      content: JSON.stringify({
        name: spec.name,
        version: "1.0.0",
        description: spec.description,
        main: "src/index.js",
        scripts: {
          dev: "node --watch src/index.js",
          start: "node src/index.js",
          build: "echo 'No build step required'",
        },
        dependencies: {
          "express": "^4.18.2",
          ...(spec.auth === "jwt" ? { "jsonwebtoken": "^9.0.2" } : {}),
          ...(spec.database === "sqlite" ? { "better-sqlite3": "^12.10.0" } : {}),
          ...(spec.database === "postgres" ? { "pg": "^8.13.0" } : {}),
        },
      }, null, 2),
    });

    files.push({
      path: `${spec.name}/.env.example`,
      content: `PORT=3000\nDATABASE_URL=${spec.database}://localhost:5432/${spec.name}\n${spec.auth !== "none" ? "JWT_SECRET=change-me\n" : ""}`,
    });

    files.push({
      path: `${spec.name}/.gitignore`,
      content: `node_modules/\n.env\n*.log\ndist/\nbuild/\n`,
    });

    return files;
  }

  private generateDatabase(spec: ProjectSpec): GeneratedFile[] {
    if (spec.database === "sqlite") {
      const dbDir = path.join(spec.name, "src", "db");
      return [{
        path: `${dbDir}/index.js`,
        content: `const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.DATABASE_URL || path.join(__dirname, "..", "..", "data", "${spec.name}.db");
require("fs").mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

${spec.models.map(m => {
  const parts = m.split(":");
  const name = parts[0].toLowerCase();
  const fields = parts[1] ? parts[1].split(",") : ["id INTEGER PRIMARY KEY AUTOINCREMENT"];
  return `db.exec(\`CREATE TABLE IF NOT EXISTS ${name} (${fields.join(", ")})\`);`;
}).join("\n\n")}

module.exports = db;
`,
      }];
    }
    return [];
  }

  private generateAuth(spec: ProjectSpec): GeneratedFile[] {
    if (spec.auth === "jwt") {
      return [{
        path: `${spec.name}/src/middleware/auth.js`,
        content: `const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = { generateToken, authenticate };
`,
      }];
    }
    return [];
  }

  private generateApi(spec: ProjectSpec): GeneratedFile[] {
    const endpoints = spec.apiEndpoints.map(endpoint => {
      const [method, route] = endpoint.split(/\s+/);
      return { method: method?.toLowerCase() || "get", route: route || "/api" };
    });

    const routeHandlers = endpoints.map(ep => {
      const handlerName = ep.route.replace(/[\/:]/g, "_").replace(/_{2,}/g, "_").replace(/^_|_$/g, "") || "root";
      return `router.${ep.method}("${ep.route}", async (req, res) => {
  try {
    res.json({ message: "${handlerName} endpoint", data: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});`;
    });

    return [{
      path: `${spec.name}/src/routes/index.js`,
      content: `const express = require("express");
const router = express.Router();

${routeHandlers.join("\n\n")}

module.exports = router;
`,
    }];
  }

  private generateModels(spec: ProjectSpec): GeneratedFile[] {
    return spec.models.map(model => {
      const [name, fieldsStr] = model.split(":");
      const fields = fieldsStr ? fieldsStr.split(",").map(f => {
        const [fieldName, fieldType] = f.trim().split(/\s+/);
        return { name: fieldName, type: fieldType || "TEXT" };
      }) : [];

      return {
        path: `${spec.name}/src/models/${name.toLowerCase()}.js`,
        content: `class ${name.charAt(0).toUpperCase() + name.slice(1)} {
  constructor(data = {}) {
    ${fields.map(f => `this.${f.name} = data.${f.name} || null;`).join("\n    ")}
  }

  validate() {
    const errors = [];
    ${fields.filter(f => f.name !== "id").map(f => `if (!this.${f.name}) errors.push("${f.name} is required");`).join("\n    ")}
    return errors;
  }

  toJSON() {
    return { ${fields.map(f => `"${f.name}": this.${f.name}`).join(", ")} };
  }
}

module.exports = ${name.charAt(0).toUpperCase() + name.slice(1)};
`,
      };
    });
  }

  private generateFrontend(spec: ProjectSpec): GeneratedFile[] {
    if (spec.stack === "react" || spec.stack === "nextjs") {
      return [{
        path: `${spec.name}/src/public/index.html`,
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${spec.name}</title>
</head>
<body>
  <div id="root"></div>
  <script src="/app.js"></script>
</body>
</html>`,
      }, {
        path: `${spec.name}/src/public/app.js`,
        content: `// ${spec.name} - Frontend Entry Point
console.log("${spec.name} frontend loaded");

async function loadData() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    document.getElementById("root").innerHTML = \`<h1>\${data.message}</h1>\`;
  } catch (err) {
    console.error("Failed to load data:", err);
  }
}

document.addEventListener("DOMContentLoaded", loadData);
`,
      }];
    }
    return [];
  }

  private generateDeployment(spec: ProjectSpec): GeneratedFile[] {
    return [{
      path: `${spec.name}/Dockerfile`,
      content: `FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "src/index.js"]
`,
    }, {
      path: `${spec.name}/docker-compose.yml`,
      content: `version: "3.8"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    volumes:
      - ./data:/app/data
    restart: unless-stopped
`,
    }];
  }
}

export const fullstackGenerator = new FullstackGenerator();

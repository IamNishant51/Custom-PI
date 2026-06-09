# 🛠️ Tool Arsenal & Plugins

Custom-PI features an advanced arsenal of 32+ custom tools that enable wide-ranging integrations, web browsing, diagnostic analysis, and automated tasks.

## 🔍 Tool Reference Sheet

| Group | Tool | Description |
|---|---|---|
| **Search & Web** | `web_search` | Dynamic search with fallbacks (DuckDuckGo ➔ Algolia HN ➔ Wikipedia). |
| | `web_fetch` | Fetches web page content, parses HTML/JSON, automatically sets User-Agents. |
| | `internal_url` | Resolves internal protocol URIs like `memory://`, `vault://`, and `issue://`. |
| **Automation** | `browser` | Starts headless Chromium using Playwright to navigate, click, type, screenshot, and extract data. |
| | `ssh_exec` | Secure SSH client supporting password and key-based remote command execution. |
| **Code Intelligence**| `lsp` | Connects to TS/JS, Python, Rust, and Go language servers for hover definitions, renames, and diagnostics. |
| | `ast_grep` | Uses structural AST queries to find classes, functions, and imports in 11 languages. |
| | `hashline_edit` | Generates content-hash validated patches to prevent corrupted edits. |
| **Communications**| `github` | Integrates with GitHub API to manage issues, pull requests, and search files. |
| | `send_email` | Uses Gmail API OAuth 2.0 Device Flow to compose and send emails. |
| **Social** | `post_to_reddit` | Submits posts using Reddit OAuth password grant. |
| | `post_to_bluesky` | Connects to AT Protocol to post text feeds. |
| | `post_to_discord` | Broadcasts messages via Discord webhooks. |
| | `post_to_telegram`| Sends text and status updates using Telegram Bot API. |
| **Encryption/RAG**| `memory_store` | Indexes semantic memory vectors with recency decay factors. |
| | `vault_set` | Inserts or updates credentials in the encrypted AES-256 vault. |
| **Media** | `generate_image` | Generates images using DALL-E 3, Gemini, or Grok depending on keys. |
| | `text_to_speech` | Generates voice audio base64 buffers using Edge-TTS. |
| | `render_mermaid`| Renders diagrams into SVG formats with ASCII fallbacks. |

---

## 🔌 Custom Plugin System

You can extend Custom-PI by writing custom Javascript/TypeScript plugins. Custom-PI reads files inside `~/.pi/agent/plugins/`.

### Defining a Plugin
Create a `plugin.js` inside the plugins directory:

```javascript
module.exports = {
  name: "my_custom_tool",
  description: "A custom tool that performs calculations",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression to evaluate" }
    },
    required: ["expression"]
  },
  async execute({ expression }) {
    const fn = new Function("return " + expression);
    const result = fn();
    return { status: "success", result };
  }
};
```

Plugins are dynamically loaded and registered on startup. All execution is sandboxed, and destructive commands are subject to user approval gates.
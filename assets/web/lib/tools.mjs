export const TOOLS = [
  {
    name: "list_dir",
    description: "List files and directories in a folder. Supports ~ for home directory (e.g. ~/Desktop).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path to list. Use ~/Desktop or /home/user/Desktop" } },
      required: ["path"],
    },
  },
  {
    name: "view_file",
    description: "Read the contents of a file from the local filesystem.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path to the file to read" } },
      required: ["path"],
    },
  },
  {
    name: "read",
    description: "Read the contents of a file from the local filesystem.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path to the file to read" } },
      required: ["path"],
    },
  },
  {
    name: "write",
    description: "Create or overwrite a file with the specified content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write" },
        content: { type: "string", description: "The complete content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit",
    description: "Edit a file by replacing exact text. Use this for surgical changes instead of write.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit" },
        oldText: { type: "string", description: "The exact text to search for and replace" },
        newText: { type: "string", description: "The replacement text" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "bash",
    description: "Run a bash shell command on the host system.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "The shell command to execute" } },
      required: ["command"],
    },
  },
  {
    name: "glob",
    description: "Find files by glob pattern.",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "Glob pattern to match" } },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description: "Search file contents for a pattern.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Pattern to search for" },
        path: { type: "string", description: "Optional path to search in" },
        regex: { type: "boolean", description: "Set to true to treat pattern as a regex (default: literal string match)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "memory_store",
    description: "Store a fact into persistent memory.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        type: { type: "string", enum: ["fact", "decision", "preference", "pattern", "skill"] },
        importance: { type: "number" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["content", "type"],
    },
  },
  {
    name: "memory_search",
    description: "Search persistent memory semantically.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, k: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "vault_set",
    description: "Store a secret in the encrypted vault.",
    parameters: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
    },
  },
  {
    name: "vault_get",
    description: "Retrieve a secret from the vault.",
    parameters: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "delegate_to_subagent",
    description: "Delegate a task to a specialized sub-agent. Give it a clear, detailed task description.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Name of the sub-agent to use" },
        task: { type: "string", description: "Detailed task description for the sub-agent" },
      },
      required: ["agentId", "task"],
    },
  },
  {
    name: "search_obsidian",
    description: "Search the Obsidian vault for notes matching a query.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "write_obsidian_note",
    description: "Write a note in the Obsidian vault.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title (becomes filename)" },
        content: { type: "string", description: "Note content in markdown format" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "ask_user",
    description: "Pause and ask the user a question. Wait for their response before continuing. Use this when you need approval, clarification, or additional information from the user.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user" },
        options: { type: "array", items: { type: "string" }, description: "Optional list of predefined answer options" },
      },
      required: ["question"],
    },
  },
  {
    name: "request_post_approval",
    description: "Show a formatted post preview to the user and ask for approval before publishing. Use this to let the user review how the post will look on the target platform.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", description: "Target platform: twitter, reddit, bluesky, discord, or telegram" },
        content: { type: "string", description: "The post body content to show for approval" },
        title: { type: "string", description: "Optional post title (used for Reddit)" },
        platformSpecific: { type: "string", description: "Additional platform context (subreddit for Reddit, etc.)" },
        assetUrl: { type: "string", description: "Optional filename of a previously generated asset to display alongside the post (e.g. 'asset_123_0.png')" },
      },
      required: ["platform", "content"],
    },
  },
  {
    name: "post_to_twitter",
    description: "Post a tweet to Twitter/X with optional image attachment. Uses Playwright browser automation.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The tweet content to post (max 280 characters)" },
        mediaPath: { type: "string", description: "Absolute path to an image file to attach to the tweet" },
        topic: { type: "string", description: "Topic label for dedup tracking (e.g. 'AI news', 'product launch')" },
        force: { type: "boolean", description: "Skip duplicate check and post anyway" },
      },
      required: ["text"],
    },
  },
  {
    name: "web_search",
    description: "Search the web for information. Uses multiple free providers as fallback chain.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        count: { type: "number", description: "Number of results (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch and extract the main content from a URL. Returns readable text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser",
    description: "Headless browser automation. Supports navigate, click, type, screenshot, extract. Uses Playwright.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["navigate", "click", "type", "screenshot", "extract"], description: "The browser action to perform" },
        url: { type: "string", description: "URL to navigate to (for navigate action)" },
        selector: { type: "string", description: "CSS selector for click/type/extract actions" },
        text: { type: "string", description: "Text to type (for type action)" },
      },
      required: ["action"],
    },
  },
  {
    name: "github",
    description: "GitHub API integration. Supports creating issues, listing issues, reading files, searching code. Requires GITHUB_TOKEN in vault.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_issue", "list_issues", "read_file", "search_code", "get_pr", "list_prs"], description: "The GitHub action" },
        repo: { type: "string", description: "Repository (owner/repo format)" },
        title: { type: "string", description: "Issue/PR title (for create actions)" },
        body: { type: "string", description: "Issue/PR body content" },
        path: { type: "string", description: "File path (for read_file action)" },
        query: { type: "string", description: "Search query (for search_code action)" },
        number: { type: "number", description: "Issue/PR number" },
      },
      required: ["action"],
    },
  },
  {
    name: "post_to_reddit",
    description: "Post a message to a Reddit subreddit with optional image. Uses Playwright browser automation.",
    parameters: {
      type: "object",
      properties: {
        subreddit: { type: "string", description: "Subreddit name (e.g., 'artificial')" },
        title: { type: "string", description: "Post title" },
        text: { type: "string", description: "Post body text" },
        mediaPath: { type: "string", description: "Absolute path to an image file to attach" },
        topic: { type: "string", description: "Topic label for dedup tracking" },
        force: { type: "boolean", description: "Skip duplicate check" },
      },
      required: ["subreddit", "title", "text"],
    },
  },
  {
    name: "post_to_bluesky",
    description: "Post a message to Bluesky with optional image attachment. Uses Bluesky API directly.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Post content (max 300 chars)" },
        mediaPath: { type: "string", description: "Absolute path to an image file to upload and attach" },
        topic: { type: "string", description: "Topic label for dedup tracking" },
        force: { type: "boolean", description: "Skip duplicate check" },
      },
      required: ["text"],
    },
  },
  {
    name: "send_email",
    description: "Send an email via Gmail. Requires GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET in vault. Uses OAuth 2.0 device flow.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body text" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "post_to_discord",
    description: "Post a message to a Discord channel via webhook, with optional image attachment. Requires DISCORD_WEBHOOK_URL in vault.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message content" },
        mediaPath: { type: "string", description: "Absolute path to an image file to attach" },
        topic: { type: "string", description: "Topic label for dedup tracking" },
        force: { type: "boolean", description: "Skip duplicate check" },
      },
      required: ["message"],
    },
  },
  {
    name: "post_to_telegram",
    description: "Post a message or photo to Telegram. Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in vault.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message text or caption" },
        mediaPath: { type: "string", description: "Absolute path to an image file to send as photo" },
        topic: { type: "string", description: "Topic label for dedup tracking" },
        force: { type: "boolean", description: "Skip duplicate check" },
      },
      required: ["message"],
    },
  },
  {
    name: "memory_edit",
    description: "Edit or delete stored memories by ID.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["edit", "delete"], description: "Action to perform" },
        id: { type: "string", description: "Memory entry ID" },
        content: { type: "string", description: "Updated content (for edit action)" },
        tags: { type: "array", items: { type: "string" }, description: "Updated tags" },
      },
      required: ["action", "id"],
    },
  },
  {
    name: "todo_write",
    description: "Write or update a task list with phased action plans.",
    parameters: {
      type: "object",
      properties: {
        phase: { type: "string", description: "Phase name (e.g., 'Phase 1: Setup')" },
        items: { type: "array", items: { type: "object", properties: { description: { type: "string" }, done: { type: "boolean" } } }, description: "List of tasks" },
      },
      required: ["phase", "items"],
    },
  },
  {
    name: "hashline_edit",
    description: "Edit files using the hashline format — a compact, line-anchored patch language with content-hash validation. Format: ¶path#TAG\\nreplace N..M:\\n+new content\\ndelete N\\ninsert after N:\\n+content\\ninsert head:\\n+content\\ninsert tail:\\n+content",
    parameters: {
      type: "object",
      properties: {
        patch: { type: "string", description: "Hashline patch string. Format: ¶path#HASH\\nreplace N..N:\\n+new content\\n Or: ¶path#HASH\\ndelete N\\n Or: ¶path#HASH\\ninsert after N:\\n+content" },
      },
      required: ["patch"],
    },
  },
  {
    name: "internal_url",
    description: "Access resources via internal URL protocols. Supported: memory:// (memory access), vault:// (credential lookup), local:// (workspace files), omp:// (embedded docs), issue:// (GitHub issues), pr:// (GitHub PRs), skill:// (skill files), rule:// (rule files). Example: memory://fact, vault://KEY_NAME, local://path/to/file",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Internal URL to resolve" },
      },
      required: ["url"],
    },
  },
  {
    name: "lsp",
    description: "Query language intelligence via LSP. Actions: diagnostics, goto_def, references, hover, symbols, rename, code_actions.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["diagnostics", "goto_def", "references", "hover", "symbols", "rename", "code_actions"] },
        file_path: { type: "string", description: "Path to the file" },
        line: { type: "number", description: "Line number (0-indexed)" },
        character: { type: "number", description: "Character offset (0-indexed)" },
        new_name: { type: "string", description: "New name for rename action" },
      },
      required: ["action", "file_path"],
    },
  },
  {
    name: "session",
    description: "Session management: checkpoints, rewind, compaction, status.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "checkpoint", "save", "list", "restore", "compact"], description: "Session action" },
        label: { type: "string", description: "Checkpoint label (for checkpoint action)" },
        id: { type: "string", description: "Checkpoint ID (for restore action)" },
        max_age_days: { type: "number", description: "Max age in days for compaction (default 30)" },
      },
      required: ["action"],
    },
  },
  {
    name: "generate_image",
    description: "Generate an image from a text prompt. Defaults to free Pollinations.ai (no API key needed). Also supports OpenAI (DALL-E 3), Gemini, Grok, and DesignAPI with API keys.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the image to generate" },
        provider: { type: "string", enum: ["free", "designapi", "openai", "gemini", "grok"], description: "Image generation provider. Default: 'free' (Pollinations.ai, no key needed). Set to 'openai', 'gemini', 'grok', or 'designapi' for key-based providers." },
        size: { type: "string", description: "Image size (e.g. 1024x1024, depends on provider/model)" },
        count: { type: "number", description: "Number of images to generate (default 4, max 4). More images = more choices for the user." },
        model: { type: "string", description: "Model for Pollinations (flux, gptimage, seedream, etc.) or DesignAPI (flux-pro, dall-e-3, etc.)" },
        save: { type: "boolean", description: "Save image to local assets folder and return file path (default: true)" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "request_asset_selection",
    description: "Show generated images to the user and ask which one to use for the post. Call this after generate_image returns multiple images. The user will pick one, and the rest will be deleted.",
    parameters: {
      type: "object",
      properties: {
        filenames: { type: "array", items: { type: "string" }, description: "Array of generated image filenames for the user to choose from" },
        prompt: { type: "string", description: "Original image generation prompt for context" },
      },
      required: ["filenames"],
    },
  },
  {
    name: "get_posted_content",
    description: "Search previously posted social media content to avoid reposting the same topic. Use this before writing new posts to check what has already been covered.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic or keyword to search for in posted history" },
        platform: { type: "string", description: "Filter by platform (twitter, reddit, bluesky, discord, telegram)" },
        days: { type: "number", description: "How many days back to look (default: 30)" },
      },
      required: [],
    },
  },
  {
    name: "text_to_speech",
    description: "Convert text to speech audio. Uses free browser SpeechSynthesis API or edge TTS fallback.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to convert to speech" },
        voice: { type: "string", description: "Voice preference (default: en-US)" },
      },
      required: ["text"],
    },
  },
  {
    name: "ssh_exec",
    description: "Execute commands on remote servers via SSH. Uses key-based auth. Requires SSH_KEY or SSH_PASSWORD in vault for each host.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string", description: "Remote host (user@hostname or IP)" },
        command: { type: "string", description: "Command to execute" },
        port: { type: "number", description: "SSH port (default: 22)" },
        timeout: { type: "number", description: "Command timeout in seconds (default: 30)" },
      },
      required: ["host", "command"],
    },
  },
  {
    name: "plugin",
    description: "Plugin system: list, create, enable, disable, and manage plugins.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create", "enable", "disable", "info", "remove"] },
        name: { type: "string", description: "Plugin name" },
        description: { type: "string", description: "Plugin description (for create action)" },
        version: { type: "string", description: "Plugin version (for create action)" },
      },
      required: ["action"],
    },
  },
  {
    name: "pattern_search",
    description: "Pattern-based code search across source files. Uses regex matching (not AST-based).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "count", "functions", "classes", "imports"], description: "AST action" },
        pattern: { type: "string", description: "Pattern to search (for search action)" },
        file_path: { type: "string", description: "File to analyze (optional, searches all if omitted)" },
        language: { type: "string", description: "Language (auto-detected from file extension if not specified)" },
      },
      required: ["action"],
    },
  },
  {
    name: "render_mermaid",
    description: "Render Mermaid diagram code to SVG or ASCII art. Falls back to ASCII representation if mermaid CLI is not installed.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Mermaid diagram code" },
        format: { type: "string", enum: ["svg", "ascii", "url"], description: "Output format (default: ascii)" },
      },
      required: ["code"],
    },
  },
  {
    name: "plan",
    description: "Planning/goals mode: create, track, and manage multi-step plans and objectives.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "status", "update_step", "complete", "abandon", "resume"], description: "Plan action" },
        name: { type: "string", description: "Plan name (for create action)" },
        goal: { type: "string", description: "Plan goal/objective" },
        steps: { type: "array", items: { type: "string" }, description: "Array of step descriptions (for create action)" },
        plan_id: { type: "string", description: "Plan ID" },
        step_id: { type: "string", description: "Step ID (for update_step action)" },
        step_status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked"], description: "New step status" },
      },
      required: ["action"],
    },
  },
  {
    name: "pr_review",
    description: "Automated pull request review workflow. Fetches PR diff, runs parallel reviews via specialized agents, and compiles results with CEO approval gate.",
    parameters: {
      type: "object",
      properties: {
        prUrl: { type: "string", description: "Full GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)" },
        repo: { type: "string", description: "Repository in owner/repo format (alternative to prUrl)" },
        prNumber: { type: "number", description: "PR number (use with repo)" },
        localBranch: { type: "string", description: "Local git branch to diff against main (alternative to URL)" },
        reviewers: { type: "array", items: { type: "string" }, description: "Optional list of reviewer agents to use (default: all available)" },
        autoApprove: { type: "boolean", description: "Skip CEO gate for minor changes (default: false)" },
      },
    },
  },
  {
    name: "database_migration",
    description: "Generate SQL migration scripts by diffing two database schemas. Supports PostgreSQL, SQLite, and MySQL dialects. Can also extract schema from a live database connection.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["diff", "generate", "extract", "validate"], description: "Action: diff two schemas, generate from description, extract from live DB, or validate a migration script" },
        sourceSchema: { type: "string", description: "Source (current) SQL schema — CREATE TABLE statements" },
        targetSchema: { type: "string", description: "Target (desired) SQL schema — CREATE TABLE statements (for diff action)" },
        description: { type: "string", description: "Natural language description of desired schema changes (for generate action)" },
        dialect: { type: "string", enum: ["postgresql", "sqlite", "mysql"], description: "SQL dialect (default: postgresql)" },
        connectionString: { type: "string", description: "Database connection string (for extract action, e.g., postgresql://user:pass@host:5432/db)" },
        migrationName: { type: "string", description: "Name/timestamp for the migration (default: auto-generated)" },
        migrationScript: { type: "string", description: "SQL migration script to validate (for validate action)" },
      },
      required: ["action"],
    },
  },
  {
    name: "api_spec_validator",
    description: "Validate API specifications (OpenAPI/Swagger, GraphQL) against contracts, detect breaking changes, lint for best practices, and generate client/server stubs.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["validate", "diff", "lint", "generate-stubs"], description: "Action to perform" },
        spec: { type: "string", description: "API specification content (YAML/JSON OpenAPI or SDL GraphQL)" },
        specType: { type: "string", enum: ["openapi", "graphql"], description: "Type of API specification (default: auto-detect from content)" },
        oldSpec: { type: "string", description: "Previous version of the spec (for diff/breaking change detection)" },
        format: { type: "string", enum: ["json", "yaml"], description: "Output format for generated stubs (default: json)" },
        language: { type: "string", enum: ["typescript", "javascript", "python", "go"], description: "Target language for stub generation (default: typescript)" },
        endpoint: { type: "string", description: "Live endpoint URL to fetch and validate spec against (e.g., https://api.example.com/openapi.json)" },
      },
      required: ["action"],
    },
  },
  {
    name: "graphql_introspect",
    description: "Introspect a GraphQL endpoint to fetch schema, types, queries, mutations, and subscriptions. Supports custom headers for authentication.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "GraphQL endpoint URL (e.g., https://api.example.com/graphql)" },
        headers: { type: "object", description: "Optional HTTP headers (e.g., Authorization, Content-Type)" },
        includeDirectives: { type: "boolean", description: "Include directive definitions in schema (default: false)" },
        includeDeprecated: { type: "boolean",description: "Include deprecated fields/enums (default: false)" },
      },
      required: ["url"],
    },
  },
];

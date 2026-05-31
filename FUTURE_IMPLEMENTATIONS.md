# Future Implementations — pi-custom-pack

Detailed plans for upcoming features, organized by priority and effort.

---

## Priority Matrix

| Feature | Effort | Impact | Dependencies |
|---|---|---|---|
| Real-time agent chat | Medium | High | None |
| Human-in-the-loop (ask_user) | Medium | High | Real-time chat (can be built standalone) |
| Reddit posting (API) | Low | Medium | Reddit app credentials |
| Twitter browser automation | Medium | Medium | Playwright + Chromium install |
| Bluesky posting | Low | Low | Bluesky account + app password |
| Email (Gmail) integration | High | High | Google Cloud OAuth 2.0 setup |
| GitHub integration | Medium | Medium | GitHub PAT |
| Discord/Telegram posting | Low | Medium | Webhook URL / Bot token |

---

## 1. Real-time Agent Chat (Milestone 3)

### Goal
Allow the user to send messages directly to individual sub-agents or the CEO during a swarm execution. Agents can see user messages in their context and respond.

### Architecture

#### WebSocket Protocol

Add a new message type `agent_chat`:

```typescript
// Client → Server (user sends message to agent)
{
  "type": "agent_chat",
  "agentId": "agent_1",       // target agent, or "ceo" for CEO
  "message": "Use the repo link: https://github.com/..."
}

// Server → Client (agent responds to user)
{
  "type": "agent_chat",
  "agentId": "agent_1",
  "message": "Got it, I'll include the repo link in the tweet.",
  "fromAgent": true           // true = agent speaking, false = user speaking
}
```

#### Server-Side Changes (`web-server.mjs`)

In the WebSocket `message` handler, add a case for `"agent_chat"`:

```
case "agent_chat":
  // Store message in agent's chat buffer
  chatBuffers[msg.agentId] = chatBuffers[msg.agentId] || [];
  chatBuffers[msg.agentId].push({ role: "user", content: msg.message });

  // Broadcast to all clients
  broadcast({ type: "agent_chat", agentId: msg.agentId, message: msg.message, fromAgent: false });

  // If swarm is running, inject into agent's next prompt
  if (currentSwarmState?.agents?.find(a => a.id === msg.agentId)) {
    // The agent will pick up chat buffer in its next context window
  }
  break;
```

#### Context Injection

In `executeSwarmCampaign`, when building the agent's system prompt, prepend any pending chat messages:

```javascript
const chatHistory = chatBuffers[agentId] || [];
const chatContext = chatHistory.length
  ? "\n[User messages during execution:\n" + chatHistory.map(m => `- ${m.role}: ${m.content}`).join("\n") + "\n]"
  : "";
const fullPrompt = agentPrompt + chatContext + taskPrompt;
```

#### UI Changes (`SubAgentPanel.tsx`)

- Each agent card gets a collapsible chat input at the bottom.
- When user types and sends, emit `agent_chat` via WebSocket.
- Show a chat bubble history per agent (user messages right-aligned, agent responses left-aligned).
- CEO gets its own chat panel in the CEO console section.

```tsx
// AgentChat component
function AgentChat({ agentId, ws }: { agentId: string; ws: WebSocket }) {
  const [messages, setMessages] = useState<{ from: "user" | "agent"; text: string }[]>([]);
  const [input, setInput] = useState("");

  const send = () => {
    if (!input.trim()) return;
    ws.send(JSON.stringify({ type: "agent_chat", agentId, message: input }));
    setMessages(prev => [...prev, { from: "user", text: input }]);
    setInput("");
  };

  // Listen for agent_chat messages targeting this agent
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "agent_chat" && msg.agentId === agentId && msg.fromAgent) {
        setMessages(prev => [...prev, { from: "agent", text: msg.message }]);
      }
    };
    ws?.addEventListener("message", handler);
    return () => ws?.removeEventListener("message", handler);
  }, [ws, agentId]);

  return (
    <div className="agent-chat">
      {messages.map((m, i) => (
        <div key={i} className={`chat-bubble ${m.from}`}>{m.text}</div>
      ))}
      <div className="chat-input-row">
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Message agent..." />
        <button onClick={send}>Send</button>
      </div>
    </div>
  );
}
```

### Files to Modify
- `assets/web/web-server.mjs` — WS handler + context injection
- `assets/web/client/src/components/SubAgentPanel.tsx` — chat UI per agent
- `assets/web/client/src/styles/globals.css` — chat bubble styles

---

## 2. Human-in-the-Loop — `ask_user` Tool (Milestone 2)

### Goal
Agents can pause execution and ask the user a question. The user sees the question in the UI, types an answer, and execution resumes with the answer injected into the agent's context.

### Architecture

#### New Tool Definition

```javascript
{
  name: "ask_user",
  description: "Pause and ask the user a question. Wait for their response before continuing. Use this when you need approval, clarification, or additional information.",
  parameters: {
    question: { type: "string", description: "The question to ask the user" }
  },
  required: ["question"]
}
```

#### Server-Side Flow

1. Agent calls `ask_user("Should I post this tweet?")`
2. Server pauses the agent's execution loop
3. Server broadcasts a `user_question` event to all clients
4. UI shows a modal/notification with the question and an answer input
5. User types answer and clicks Submit
6. Client sends `user_answer` via WebSocket
7. Server receives the answer, injects it into the agent's context, resumes execution

```javascript
// In executeTool handler:
case "ask_user": {
  const questionId = crypto.randomUUID();
  pendingQuestions[questionId] = {
    question: args.question,
    resolve: null,  // will be set below
    reject: null
  };

  broadcast({
    type: "user_question",
    id: questionId,
    agentId: currentAgentId,
    question: args.question
  });

  // Wait for answer
  const answer = await new Promise((resolve, reject) => {
    pendingQuestions[questionId].resolve = resolve;
    pendingQuestions[questionId].reject = reject;
    // Timeout after 5 minutes
    setTimeout(() => reject("Timeout waiting for user input"), 300000);
  });

  return `User answered: ${answer}`;
}
```

#### WebSocket Handler for Answer

```javascript
case "user_answer": {
  const q = pendingQuestions[msg.questionId];
  if (q) {
    q.resolve(msg.answer);
    delete pendingQuestions[msg.questionId];
    broadcast({ type: "user_question_resolved", id: msg.questionId });
  }
  break;
}
```

#### UI Changes

- New `QuestionModal` component that appears when `user_question` is received.
- Shows the question text and an input field.
- Submit button sends `user_answer` via WebSocket.
- Can be integrated into the status bar or as an overlay modal.

```tsx
function QuestionModal({ ws }: { ws: WebSocket }) {
  const [question, setQuestion] = useState<{ id: string; text: string; agentId: string } | null>(null);
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "user_question") {
        setQuestion({ id: msg.id, text: msg.question, agentId: msg.agentId });
      }
      if (msg.type === "user_question_resolved") {
        setQuestion(null);
        setAnswer("");
      }
    };
    ws?.addEventListener("message", handler);
    return () => ws?.removeEventListener("message", handler);
  }, [ws]);

  if (!question) return null;

  const submit = () => {
    ws?.send(JSON.stringify({ type: "user_answer", questionId: question.id, answer }));
  };

  return (
    <div className="question-modal-overlay">
      <div className="question-modal">
        <div className="question-agent">Agent {question.agentId} asks:</div>
        <div className="question-text">{question.text}</div>
        <textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Your answer..." />
        <button onClick={submit} disabled={!answer.trim()}>Submit</button>
      </div>
    </div>
  );
}
```

### Pause/Resume Integration
The `ask_user` tool should automatically pause the swarm (set `_swarmPaused = true`) so other agents don't continue while waiting.

### Files to Modify
- `assets/web/web-server.mjs` — TOOLS array, executeTool handler, pendingQuestions state
- `assets/web/client/src/components/SubAgentPanel.tsx` — QuestionModal
- `assets/web/client/src/App.tsx` — mount QuestionModal at app level
- `assets/web/client/src/styles/globals.css` — modal styles

---

## 3. Twitter Browser Automation (Free Alternative to Paid API)

### Goal
Post tweets without paying for Twitter API by automating the browser using Playwright.

### Prerequisites
Playwright (Python) is already installed at `/home/nishant/.global-python-env/bin/playwright` with Chromium in `~/.cache/ms-playwright/chromium-1223`.

### Implementation

#### Approach 1: Python script called from Node.js

Create `scripts/twitter-post.py`:

```python
#!/usr/bin/env python3
"""Post a tweet using Playwright browser automation.
Usage: python3 twitter-post.py "Tweet text"
"""
import sys, json, os
from playwright.sync_api import sync_playwright

COOKIE_FILE = os.path.expanduser("~/.pi/agent/twitter_cookies.json")

def post_tweet(text):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        # Load saved cookies if available
        if os.path.exists(COOKIE_FILE):
            with open(COOKIE_FILE) as f:
                context.add_cookies(json.load(f))
        else:
            # First time: need interactive login
            print(json.dumps({"error": "NO_COOKIES", "message": "Login required. Run interactive login first."}))
            browser.close()
            return

        page = context.new_page()
        page.goto("https://twitter.com")

        # Check if still logged in
        if page.url.startswith("https://twitter.com/login"):
            print(json.dumps({"error": "SESSION_EXPIRED", "message": "Cookies expired. Re-login required."}))
            browser.close()
            return

        # Click tweet button
        page.click('a[data-testid="SideNav_NewTweet_Button"]')
        page.wait_for_selector('div[data-testid="tweetTextarea_0"]')

        # Type tweet
        page.fill('div[data-testid="tweetTextarea_0"]', text[:280])

        # Click tweet button
        page.click('div[data-testid="tweetButton"]')

        # Wait for confirmation
        page.wait_for_selector('div[data-testid="toast"]', timeout=10000)

        print(json.dumps({"ok": True, "text": text[:280]}))
        browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No text provided"}))
        sys.exit(1)
    post_tweet(sys.argv[1])
```

#### Login Script (`scripts/twitter-login.py`)

For the first-time setup, user runs an interactive login:

```python
#!/usr/bin/env python3
"""Interactive Twitter login to save cookies for future automated posts."""
import json, os
from playwright.sync_api import sync_playwright

COOKIE_FILE = os.path.expanduser("~/.pi/agent/twitter_cookies.json")

def login():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # visible for login
        context = browser.new_context()
        page = context.new_page()
        page.goto("https://twitter.com/login")

        print("Please log in to Twitter in the browser window.")
        print("After login, press Enter here to save cookies...")
        input()

        cookies = context.cookies()
        with open(COOKIE_FILE, "w") as f:
            json.dump(cookies, f)
        print(f"Cookies saved to {COOKIE_FILE}")

        browser.close()

if __name__ == "__main__":
    login()
```

#### Node.js Integration

In `web-server.mjs`, update `postToTwitter` to call the Python script:

```javascript
async function postToTwitter(text) {
  const { execFile } = await import("node:child_process");
  const scriptPath = path.join(__dirname, "scripts", "twitter-post.py");

  return new Promise((resolve) => {
    execFile("python3", [scriptPath, text.slice(0, 280)], (err, stdout) => {
      if (err) return resolve(`Twitter error: ${err.message}`);
      try {
        const result = JSON.parse(stdout);
        if (result.ok) resolve(`Tweet posted!`);
        else if (result.error === "NO_COOKIES") resolve(`Login required — run: python3 scripts/twitter-login.py`);
        else if (result.error === "SESSION_EXPIRED") resolve(`Session expired — run: python3 scripts/twitter-login.py`);
        else resolve(`Twitter error: ${result.message || stdout}`);
      } catch {
        resolve(`Twitter error: ${stdout}`);
      }
    });
  });
}
```

### Files to Create
- `scripts/twitter-post.py`
- `scripts/twitter-login.py`

### Files to Modify
- `assets/web/web-server.mjs` — `postToTwitter` function

### Caveats
- Requires interactive login once (cookie expires after ~months or on password change)
- Twitter may flag automated browser activity
- Headless mode detection can be bypassed with `--disable-blink-features=AutomationControlled`
- Respect Twitter's rate limits (no more than ~300 tweets/day)

---

## 4. Reddit Posting (Free API)

### Goal
Post to Reddit subreddits using Reddit's free API.

### Setup (User)
1. Go to https://www.reddit.com/prefs/apps
2. Click **"Create App"**
3. Name: `pi-custom-pack`
4. Type: **script**
5. Redirect URI: `http://localhost:4321`
6. Copy **client_id** (string under app name) and **client_secret**
7. Store in vault: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`
8. Your Reddit username and password are needed for script app auth

### Implementation

#### Tool Definition
```javascript
{
  name: "post_to_reddit",
  description: "Post a message to a Reddit subreddit. Requires Reddit API credentials in vault (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD).",
  parameters: {
    subreddit: { type: "string", description: "Subreddit name (e.g., 'artificial')" },
    title: { type: "string", description: "Post title" },
    text: { type: "string", description: "Post body text" }
  },
  required: ["subreddit", "title", "text"]
}
```

#### Auth Flow (OAuth 2.0 Client Credentials)

```javascript
async function postToReddit(subreddit, title, text) {
  const clientId = vaultGet("REDDIT_CLIENT_ID");
  const clientSecret = vaultGet("REDDIT_CLIENT_SECRET");
  const username = vaultGet("REDDIT_USERNAME");
  const password = vaultGet("REDDIT_PASSWORD");

  if (!clientId || !clientSecret || !username || !password) {
    return "Reddit credentials not configured. Store REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD in vault.";
  }

  // Get access token
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "pi-custom-pack/1.0 (by /u/" + username + ")"
    },
    body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return `Reddit auth failed: ${JSON.stringify(tokenData)}`;

  // Post to subreddit
  const postRes = await fetch(`https://oauth.reddit.com/r/${subreddit}/submit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "pi-custom-pack/1.0 (by /u/" + username + ")"
    },
    body: `kind=self&sr=${encodeURIComponent(subreddit)}&title=${encodeURIComponent(title.slice(0, 300))}&text=${encodeURIComponent(text.slice(0, 40000))}`
  });
  const postData = await postRes.json();

  if (postData.jquery || postData.json?.errors?.length === 0) {
    return `Posted to r/${subreddit}!`;
  }
  return `Reddit error: ${JSON.stringify(postData)}`;
}
```

### Important Notes
- Reddit rate limit: 60 requests/minute for OAuth clients
- Posts to new subreddits may be filtered by AutoModerator
- User-Agent header is required by Reddit API
- Subreddit must exist and be public
- Account needs sufficient karma to post in some subreddits

### Files to Modify
- `assets/web/web-server.mjs` — TOOLS array, executeTool handler, postToReddit function

---

## 5. Bluesky Posting (Free API)

### Goal
Post to Bluesky using the AT Protocol (free, no payment needed).

### Setup (User)
1. Create account at https://bsky.app (if not already)
2. Go to Settings → App Passwords → **Create App Password**
3. Name: `pi-custom-pack`
4. Copy the generated password
5. Store in vault: `BLUESKY_IDENTIFIER` (your handle/email), `BLUESKY_APP_PASSWORD`

### Implementation

#### Tool Definition
```javascript
{
  name: "post_to_bluesky",
  description: "Post a message to Bluesky (AT Protocol). Requires BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD in vault.",
  parameters: {
    text: { type: "string", description: "Post content (max 300 chars)" }
  },
  required: ["text"]
}
```

#### Auth + Post

```javascript
async function postToBluesky(text) {
  const identifier = vaultGet("BLUESKY_IDENTIFIER");
  const password = vaultGet("BLUESKY_APP_PASSWORD");
  if (!identifier || !password) {
    return "Bluesky credentials not configured. Store BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD in vault.";
  }

  // 1. Create session (auth)
  const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password })
  });
  const session = await sessionRes.json();
  if (!session.accessJwt) return `Bluesky auth failed: ${JSON.stringify(session)}`;

  // 2. Create post
  const now = new Date().toISOString();
  const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.accessJwt}`
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: text.slice(0, 300),
        createdAt: now
      }
    })
  });
  const postData = await postRes.json();

  if (postData.uri) return `Posted to Bluesky! URI: ${postData.uri}`;
  return `Bluesky error: ${JSON.stringify(postData)}`;
}
```

### Files to Modify
- `assets/web/web-server.mjs` — TOOLS array, executeTool handler, postToBluesky function

---

## 6. Gmail Integration (Email)

### Goal
AI agents can send and read emails via Gmail API.

### Setup (User)
1. Go to https://console.cloud.google.com
2. Create a new project (or select existing)
3. Enable **Gmail API**
4. Configure **OAuth consent screen** (External, add your email as test user)
5. Create **OAuth 2.0 Client ID** (Desktop app type)
6. Copy **Client ID** and **Client Secret**
7. Store in vault: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`
8. First use requires OAuth consent flow (browser redirect)

### Implementation

#### OAuth 2.0 Flow

Since this runs on a local server, use the **OAuth 2.0 Device Authorization Grant** (device flow):

```javascript
async function gmailAuth() {
  const clientId = vaultGet("GMAIL_CLIENT_ID");
  const clientSecret = vaultGet("GMAIL_CLIENT_SECRET");

  // Step 1: Get device code
  const deviceRes = await fetch("https://oauth2.googleapis.com/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${clientId}&scope=https://www.googleapis.com/auth/gmail.send%20https://www.googleapis.com/auth/gmail.readonly`
  });
  const device = await deviceRes.json();

  // Broadcast verification URL + code to UI
  broadcast({
    type: "gmail_auth_required",
    verificationUrl: device.verification_url,
    userCode: device.user_code
  });

  // Step 2: Poll for token
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `client_id=${clientId}&client_secret=${clientSecret}&device_code=${device.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
    });
    const token = await tokenRes.json();
    if (token.access_token) {
      vaultSet("GMAIL_ACCESS_TOKEN", token.access_token);
      vaultSet("GMAIL_REFRESH_TOKEN", token.refresh_token);
      return token.access_token;
    }
  }
  throw new Error("Gmail auth timeout");
}
```

#### Tools

```javascript
{
  name: "send_email",
  description: "Send an email via Gmail. Requires Gmail API credentials in vault.",
  parameters: {
    to: { type: "string", description: "Recipient email address" },
    subject: { type: "string", description: "Email subject" },
    body: { type: "string", description: "Email body text" }
  },
  required: ["to", "subject", "body"]
}

{
  name: "read_emails",
  description: "Read recent emails from Gmail inbox.",
  parameters: {
    maxResults: { type: "number", description: "Number of emails to read (default 5)" }
  }
}
```

#### Implementation Details

```javascript
async function sendEmail(to, subject, body) {
  let token = vaultGet("GMAIL_ACCESS_TOKEN");
  if (!token) token = await gmailAuth();

  // Base64URL encode the email
  const email = [
    `From: me`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body
  ].join("\r\n");
  const encoded = Buffer.from(email).toString("base64url");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: encoded })
  });

  // If 401, refresh token
  if (res.status === 401) {
    const newToken = await refreshGmailToken();
    vaultSet("GMAIL_ACCESS_TOKEN", newToken);
    return sendEmail(to, subject, body); // retry
  }

  const data = await res.json();
  if (data.id) return `Email sent to ${to}! Message ID: ${data.id}`;
  return `Gmail error: ${JSON.stringify(data)}`;
}

async function refreshGmailToken() {
  const clientId = vaultGet("GMAIL_CLIENT_ID");
  const clientSecret = vaultGet("GMAIL_CLIENT_SECRET");
  const refreshToken = vaultGet("GMAIL_REFRESH_TOKEN");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refreshToken}&grant_type=refresh_token`
  });
  const data = await res.json();
  return data.access_token;
}
```

### Files to Modify
- `assets/web/web-server.mjs` — TOOLS array, executeTool handler, sendEmail, readEmails, gmailAuth, refreshGmailToken
- `assets/web/client/src/App.tsx` — Gmail auth notification UI

---

## 7. GitHub Integration

### Goal
AI agents can create issues, read repos, and manage GitHub projects.

### Setup (User)
1. Go to https://github.com/settings/tokens
2. Generate a **Fine-grained token** (or classic PAT)
3. Select repos you want to grant access to
4. Scopes: `repo` (full control) or `public_repo` (public only)
5. Store in vault: `GITHUB_TOKEN`, `GITHUB_USERNAME`

### Tools

```javascript
{
  name: "github_create_issue",
  description: "Create a GitHub issue in a repository.",
  parameters: {
    repo: { type: "string", description: "Repository name (e.g., 'owner/repo')" },
    title: { type: "string", description: "Issue title" },
    body: { type: "string", description: "Issue description" }
  },
  required: ["repo", "title"]
}

{
  name: "github_read_file",
  description: "Read a file from a GitHub repository.",
  parameters: {
    repo: { type: "string", description: "Repository name (e.g., 'owner/repo')" },
    path: { type: "string", description: "File path in repo" },
    branch: { type: "string", description: "Branch name (default: main)" }
  },
  required: ["repo", "path"]
}

{
  name: "github_list_issues",
  description: "List open issues in a repository.",
  parameters: {
    repo: { type: "string", description: "Repository name (e.g., 'owner/repo')" }
  },
  required: ["repo"]
}
```

### Implementation Pattern

```javascript
async function githubApi(endpoint, method = "GET", body = null) {
  const token = vaultGet("GITHUB_TOKEN");
  if (!token) return { error: "GITHUB_TOKEN not in vault" };

  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "pi-custom-pack/1.0"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json();
  if (!res.ok) return { error: data.message || JSON.stringify(data) };
  return data;
}

async function githubCreateIssue(repo, title, body) {
  const result = await githubApi(`/repos/${repo}/issues`, "POST", { title, body: body || "" });
  if (result.error) return `GitHub error: ${result.error}`;
  return `Issue created: ${result.html_url}`;
}

async function githubReadFile(repo, path, branch = "main") {
  const result = await githubApi(`/repos/${repo}/contents/${path}?ref=${branch}`);
  if (result.error) return `GitHub error: ${result.error}`;
  const content = Buffer.from(result.content, "base64").toString("utf8");
  return `\`${path}\` (${repo}, ${branch}):\n\n${content}`;
}

async function githubListIssues(repo) {
  const result = await githubApi(`/repos/${repo}/issues?state=open&per_page=20`);
  if (result.error) return `GitHub error: ${result.error}`;
  if (!result.length) return "No open issues.";
  return result.map(i => `- #${i.number}: ${i.title} (${i.html_url})`).join("\n");
}
```

### Files to Modify
- `assets/web/web-server.mjs` — TOOLS array, executeTool handler, githubApi, githubCreateIssue, githubReadFile, githubListIssues

---

## 8. Discord/Telegram Posting

### Goal
AI agents can post messages to Discord channels or Telegram groups.

### Discord (Webhook — Simplest)

#### Setup
1. Go to Discord Server → Channel Settings → Integrations → Webhooks
2. Create webhook, copy URL
3. Store in vault: `DISCORD_WEBHOOK_URL`

#### Tool
```javascript
{
  name: "post_to_discord",
  description: "Post a message to a Discord channel via webhook.",
  parameters: {
    message: { type: "string", description: "Message content" }
  },
  required: ["message"]
}
```

#### Implementation
```javascript
async function postToDiscord(message) {
  const url = vaultGet("DISCORD_WEBHOOK_URL");
  if (!url) return "Discord webhook not configured. Store DISCORD_WEBHOOK_URL in vault.";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message.slice(0, 2000) })
  });

  if (res.ok) return "Posted to Discord!";
  return `Discord error: ${res.status} ${await res.text()}`;
}
```

### Telegram (Bot API)

#### Setup
1. Message @BotFather on Telegram to create a bot
2. Copy the bot token
3. Get your chat ID (message @userinfobot)
4. Store in vault: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

#### Tool
```javascript
{
  name: "post_to_telegram",
  description: "Post a message to Telegram.",
  parameters: {
    message: { type: "string", description: "Message text" }
  },
  required: ["message"]
}
```

### Files to Modify
- `assets/web/web-server.mjs` — TOOLS array, executeTool handler, postToDiscord, postToTelegram

---

## 9. Swarm Approval Workflow

### Goal
Before executing any high-impact action (posting to social media, sending emails, etc.), the swarm must ask for user approval.

### Implementation

Combine `ask_user` tool with automated approval workflows:

1. CEO generates plan → presents to user for approval
2. User approves/rejects/modifies
3. CEO executes approved plan
4. Each major action (tweet, email, etc.) can require separate approval

#### Swarm Pre-Approval Mode

Add a setting:

```javascript
const APPROVAL_MODE = true;  // true = ask before any tool execution
```

When enabled, the agent must call `ask_user` before executing any external tool:

```javascript
case "tool_request": {
  // ...
  if (APPROVAL_MODE && isExternalTool(toolName)) {
    const approved = await askForApproval(agentId, toolName, args);
    if (!approved) return "Action cancelled by user.";
  }
  // execute tool
}
```

### Files to Modify
- `assets/web/web-server.mjs` — approval mode logic

---

## 10. Integration Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    Web UI (React)                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │Agent Chat│  │Question  │  │Auth Modal│  │Settings  │   │
│  │Component │  │Modal     │  │(Gmail)   │  │Panel     │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│              Web Server (web-server.mjs)                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  executeTool()                       │   │
│  │  ┌──────────┬──────────┬──────────┬──────────┐      │   │
│  │  │post_to   │post_to   │send_     │github_   │ ...  │   │
│  │  │twitter   │reddit    │email     │create_   │      │   │
│  │  │          │          │          │issue     │      │   │
│  │  └──────────┴──────────┴──────────┴──────────┘      │   │
│  │  ┌─────────────────────────────────────────┐        │   │
│  │  │         Vault (encrypted)                │        │   │
│  │  │  TWITTER_* │ REDDIT_* │ GMAIL_* │ GITHUB_*│      │   │
│  │  └─────────────────────────────────────────┘        │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ask_user() — pauses execution, waits for user input │   │
│  │  agent_chat — real-time messaging to sub-agents      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Credential Storage

All credentials go in the encrypted vault (`~/.pi/agent/.vault/vault.json`):

| Service | Vault Keys |
|---|---|
| Twitter (OAuth 2.0) | `TWITTER_CONSUMER_KEY`, `TWITTER_SECRET_KEY`, `TWITTER_ACCESS_TOKEN`, `TWITTER_REFRESH_TOKEN` |
| Twitter (browser) | (cookies file: `~/.pi/agent/twitter_cookies.json`) |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD` |
| Bluesky | `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` |
| Gmail | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_ACCESS_TOKEN`, `GMAIL_REFRESH_TOKEN` |
| GitHub | `GITHUB_TOKEN`, `GITHUB_USERNAME` |
| Discord | `DISCORD_WEBHOOK_URL` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

### Tool Registration Pattern

Each new tool follows this pattern:

1. Define in `TOOLS` array (name, description, parameters schema)
2. Implement handler function (async, returns string result)
3. Add `case` in `executeTool()` switch statement
4. Add `post_to_<service>` to the CEO's plan prompt (so CEO knows to assign it)
5. Add to `availableToolsList` in swarm agent prompt

---

## Implementation Order (Recommended)

| Phase | Features | Estimated Time |
|---|---|---|
| **Phase 1** | Real-time agent chat + ask_user tool | 2-3 hours |
| **Phase 2** | Reddit posting + Bluesky posting | 1-2 hours |
| **Phase 3** | Twitter browser automation | 1-2 hours |
| **Phase 4** | GitHub integration | 1-2 hours |
| **Phase 5** | Gmail integration (most complex) | 3-4 hours |
| **Phase 6** | Discord + Telegram + Approval workflow | 1-2 hours |

**Total estimated effort: 9-15 hours**

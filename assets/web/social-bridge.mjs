#!/usr/bin/env node
/**
 * social-bridge.mjs — Playwright-based social media automation server
 * Posts to Twitter/X and Reddit via browser automation. No API keys needed.
 *
 * Usage:
 *   node social-bridge.mjs              # start server on :9877
 *   node social-bridge.mjs --port 9878  # custom port
 *
 * Requires: playwright (npx playwright install chromium)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.SOCIAL_BRIDGE_PORT || "9877", 10);
const PI_DIR = path.join(os.homedir(), ".pi", "agent");
const PROFILES_DIR = path.join(PI_DIR, "browser-profiles");
const STATE_DIR = path.join(PI_DIR, "social-state");

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
ensureDir(PROFILES_DIR);
ensureDir(STATE_DIR);

// ── Rate Limiting ───────────────────────────────────────────────────────────

const RATE_FILE = path.join(STATE_DIR, "rate-limits.json");

function loadRates() {
  try { return JSON.parse(fs.readFileSync(RATE_FILE, "utf8")); } catch { return {}; }
}

function saveRates(rates) {
  fs.writeFileSync(RATE_FILE, JSON.stringify(rates, null, 2));
}

function checkRateLimit(platform) {
  const rates = loadRates();
  const today = new Date().toISOString().slice(0, 10);
  const key = `${platform}:${today}`;
  const entry = rates[key] || { count: 0, lastPost: 0 };
  const MAX_POSTS = 10;
  const MIN_INTERVAL_MS = platform === "reddit" ? 90_000 : 60_000;

  if (entry.count >= MAX_POSTS) {
    return { allowed: false, reason: `Daily limit reached for ${platform} (${entry.count}/${MAX_POSTS})` };
  }
  if (Date.now() - entry.lastPost < MIN_INTERVAL_MS) {
    const waitSec = Math.ceil((MIN_INTERVAL_MS - (Date.now() - entry.lastPost)) / 1000);
    return { allowed: false, reason: `Rate limited — wait ${waitSec}s between posts` };
  }
  return { allowed: true };
}

function recordPost(platform) {
  const rates = loadRates();
  const today = new Date().toISOString().slice(0, 10);
  const key = `${platform}:${today}`;
  const entry = rates[key] || { count: 0, lastPost: 0 };
  entry.count++;
  entry.lastPost = Date.now();
  rates[key] = entry;
  saveRates(rates);
}

// ── Browser Management ──────────────────────────────────────────────────────

let chromium = null;
const browsers = {};

async function getChromium() {
  if (!chromium) {
    const { chromium: chromiumModule } = await import("playwright");
    chromium = chromiumModule;
  }
  return chromium;
}

async function getBrowser(platform) {
  if (browsers[platform]) return browsers[platform];
  const chromiumModule = await getChromium();
  const profileDir = path.join(PROFILES_DIR, platform);
  ensureDir(profileDir);

  const browser = await chromiumModule.launchPersistentContext(profileDir, {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  browsers[platform] = browser;
  return browser;
}

async function closeBrowser(platform) {
  if (browsers[platform]) {
    try { await browsers[platform].close(); } catch {}
    delete browsers[platform];
  }
}

// ── Twitter/X Implementation ────────────────────────────────────────────────

const TWITTER_SELECTORS = {
  // Multiple fallback selectors for each action
  login: {
    username: ['input[autocomplete="username"]', 'input[name="text"]', 'input[data-testid="ocfEnterTextTextInput"]'],
    password: ['input[name="password"]', 'input[type="password"]', 'input[data-testid="ocfEnterTextTextInput"]'],
    nextButton: ['div[data-testid="LoginForm_Login_Button"]', 'button[data-testid="LoginForm_Login_Button"]', 'div[role="button"]:has-text("Next")'],
    loginButton: ['div[data-testid="LoginForm_Login_Button"]', 'button[data-testid="LoginForm_Login_Button"]'],
  },
  compose: {
    textBox: ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]', 'div.DraftEditor-root'],
    postButton: ['div[data-testid="tweetButtonInline"]', 'button[data-testid="tweetButtonInline"]', 'div[data-testid="tweetButton"]'],
  },
  home: {
    timeline: ['div[data-testid="primaryColumn"]', 'div[aria-label="Timeline"]'],
    tweetComposer: ['div[data-testid="tweetTextarea_0"]', 'a[href="/compose/post"]'],
  },
};

async function trySelectors(page, selectors, action = "click", options = {}) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      if (action === "click") { await el.click(); return true; }
      if (action === "fill") { await el.fill(options.text || ""); return true; }
      if (action === "type") {
        await el.click();
        // Clear existing text
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        // Type with clipboard paste for reliability
        await page.evaluate((text) => {
          const clipboardData = new DataTransfer();
          clipboardData.setData("text/plain", text);
          const event = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
          document.activeElement.dispatchEvent(event);
        }, options.text || "");
        return true;
      }
      if (action === "exists") { return true; }
    } catch {}
  }
  return false;
}

async function twitterLogin(username, password) {
  const browser = await getBrowser("twitter");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    await page.goto("https://x.com/login", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check if already logged in
    if (page.url().includes("/home") || page.url().includes("/x.com/home")) {
      return { ok: true, message: "Already logged in", username };
    }

    // Type username
    const usernameFilled = await trySelectors(page, TWITTER_SELECTORS.login.username, "type", { text: username });
    if (!usernameFilled) return { ok: false, error: "Could not find username field" };

    // Click Next
    await page.waitForTimeout(1000);
    await trySelectors(page, TWITTER_SELECTORS.login.nextButton, "click");
    await page.waitForTimeout(2000);

    // Check for unusual login activity (phone/email verification)
    const pageContent = await page.content();
    if (pageContent.includes("unusual") || pageContent.includes("phone") || pageContent.includes("Verify")) {
      return { ok: false, error: "Login requires verification — try logging in manually first with --no-headless" };
    }

    // Type password
    const passwordFilled = await trySelectors(page, TWITTER_SELECTORS.login.password, "type", { text: password });
    if (!passwordFilled) return { ok: false, error: "Could not find password field" };

    // Click login
    await page.waitForTimeout(1000);
    await trySelectors(page, TWITTER_SELECTORS.login.loginButton, "click");
    await page.waitForTimeout(5000);

    // Verify login success
    const finalUrl = page.url();
    if (finalUrl.includes("/home") || finalUrl.includes("/x.com/home")) {
      return { ok: true, message: "Logged in successfully", username };
    }

    return { ok: false, error: "Login may have failed — check credentials or try --no-headless" };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function twitterPost(text) {
  const rateCheck = checkRateLimit("twitter");
  if (!rateCheck.allowed) return { ok: false, error: rateCheck.reason };

  const browser = await getBrowser("twitter");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    // Navigate to home
    await page.goto("https://x.com/home", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check if logged in
    if (page.url().includes("login")) {
      return { ok: false, error: "Not logged in — run login first" };
    }

    // Click compose box
    const composeFound = await trySelectors(page, TWITTER_SELECTORS.compose.textBox, "click");
    if (!composeFound) return { ok: false, error: "Could not find tweet compose box" };
    await page.waitForTimeout(1000);

    // Type tweet text via clipboard paste
    await page.evaluate((t) => {
      const el = document.activeElement;
      if (el) {
        const cd = new DataTransfer();
        cd.setData("text/plain", t);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: cd, bubbles: true, cancelable: true }));
      }
    }, text);
    await page.waitForTimeout(1000);

    // Click post button
    const posted = await trySelectors(page, TWITTER_SELECTORS.compose.postButton, "click");
    if (!posted) return { ok: false, error: "Could not find Post button" };
    await page.waitForTimeout(3000);

    // Verify success (check for toast or URL change)
    const content = await page.content();
    const success = content.includes("sent") || content.includes("posted") || page.url().includes("/home");

    if (success) {
      recordPost("twitter");
      return { ok: true, message: "Tweet posted successfully" };
    }

    return { ok: false, error: "Post may have failed — check manually" };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function twitterReply(tweetUrl, text) {
  const rateCheck = checkRateLimit("twitter");
  if (!rateCheck.allowed) return { ok: false, error: rateCheck.reason };

  const browser = await getBrowser("twitter");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    await page.goto(tweetUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    if (page.url().includes("login")) {
      return { ok: false, error: "Not logged in" };
    }

    // Find reply compose box
    const replyBox = await trySelectors(page, [
      'div[data-testid="tweetTextarea_0"]',
      'div[role="textbox"][contenteditable="true"]',
    ], "click");
    if (!replyBox) return { ok: false, error: "Could not find reply box" };
    await page.waitForTimeout(1000);

    // Type reply
    await page.evaluate((t) => {
      const el = document.activeElement;
      if (el) {
        const cd = new DataTransfer();
        cd.setData("text/plain", t);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: cd, bubbles: true, cancelable: true }));
      }
    }, text);
    await page.waitForTimeout(1000);

    // Click reply button
    await trySelectors(page, [
      'div[data-testid="tweetButtonInline"]',
      'button[data-testid="tweetButtonInline"]',
    ], "click");
    await page.waitForTimeout(3000);

    recordPost("twitter");
    return { ok: true, message: "Reply posted successfully" };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ── Reddit Implementation ───────────────────────────────────────────────────

const REDDIT_SELECTORS = {
  login: {
    username: ['input[name="username"]', '#login-username'],
    password: ['input[name="password"]', '#login-password'],
    loginButton: ['button[type="submit"]', '.submit'],
  },
  submit: {
    title: ['textarea[name="title"]', '#title-field', 'input[name="title"]'],
    body: ['textarea[name="text"]', '#text-field', '.md textarea'],
    url: ['input[name="url"]', '#url-field', 'input[name="link_url"]'],
    submitButton: ['button[type="submit"]', '.submit-button', 'button.submit'],
  },
  comment: {
    textBox: ['textarea[name="text"]', '.comment-input textarea', 'div[contenteditable="true"]'],
    submitButton: ['button[type="submit"]', '.save-button'],
  },
};

async function redditLogin(username, password) {
  const browser = await getBrowser("reddit");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    await page.goto("https://old.reddit.com/login", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check if already logged in
    const hasNav = await page.$('a[href="/submit"]');
    if (hasNav) return { ok: true, message: "Already logged in", username };

    // Fill username
    const u = await page.$('input[name="user"]') || await page.$('#login-username');
    if (!u) return { ok: false, error: "Could not find username field" };
    await u.fill(username);

    // Fill password
    const p = await page.$('input[name="passwd"]') || await page.$('#login-password');
    if (!p) return { ok: false, error: "Could not find password field" };
    await p.fill(password);

    // Click login
    const btn = await page.$('button[type="submit"]') || await page.$('.submit');
    if (btn) await btn.click();
    await page.waitForTimeout(5000);

    // Verify
    const finalUrl = page.url();
    if (!finalUrl.includes("login")) {
      return { ok: true, message: "Logged in successfully", username };
    }

    return { ok: false, error: "Login failed — check credentials" };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function redditPost(subreddit, title, body, url) {
  const rateCheck = checkRateLimit("reddit");
  if (!rateCheck.allowed) return { ok: false, error: rateCheck.reason };

  const browser = await getBrowser("reddit");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    // Use old.reddit.com for simpler DOM
    const submitUrl = url
      ? `https://old.reddit.com/r/${subreddit}/submit?submit_type=link`
      : `https://old.reddit.com/r/${subreddit}/submit?submit_type=self`;
    await page.goto(submitUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    if (page.url().includes("login")) {
      return { ok: false, error: "Not logged in — run login first" };
    }

    // Fill title
    const titleField = await page.$('textarea[name="title"]') || await page.$('#title-field');
    if (!titleField) return { ok: false, error: "Could not find title field" };
    await titleField.fill(title);

    if (url) {
      // Link post
      const urlField = await page.$('input[name="url"]') || await page.$('#url-field');
      if (urlField) await urlField.fill(url);
    } else {
      // Text post
      const bodyField = await page.$('textarea[name="text"]') || await page.$('#text-field');
      if (bodyField && body) await bodyField.fill(body);
    }

    await page.waitForTimeout(1000);

    // Submit
    const submitBtn = await page.$('button[type="submit"]') || await page.$('.submit-button');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(5000);

    // Check for errors
    const content = await page.content();
    if (content.includes("error") || content.includes("too fast")) {
      return { ok: false, error: "Post may have been rate limited" };
    }

    recordPost("reddit");
    return { ok: true, message: `Posted to r/${subreddit} successfully` };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function redditComment(postUrl, text) {
  const rateCheck = checkRateLimit("reddit");
  if (!rateCheck.allowed) return { ok: false, error: rateCheck.reason };

  const browser = await getBrowser("reddit");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    // Convert to old.reddit.com for simpler DOM
    const oldUrl = postUrl.replace("www.reddit.com", "old.reddit.com").replace("reddit.com", "old.reddit.com");
    await page.goto(oldUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    if (page.url().includes("login")) {
      return { ok: false, error: "Not logged in" };
    }

    // Find comment box
    const commentBox = await page.$('textarea[name="text"]') || await page.$('.comment-input textarea');
    if (!commentBox) return { ok: false, error: "Could not find comment box" };
    await commentBox.fill(text);
    await page.waitForTimeout(1000);

    // Submit comment
    const submitBtn = await page.$('button[type="submit"]') || await page.$('.save-button');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(3000);

    recordPost("reddit");
    return { ok: true, message: "Comment posted successfully" };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // ── Health ──────────────────────────────────────────────────────────
    if (url.pathname === "/status" && req.method === "GET") {
      const twitterProfile = fs.existsSync(path.join(PROFILES_DIR, "twitter"));
      const redditProfile = fs.existsSync(path.join(PROFILES_DIR, "reddit"));
      const rates = loadRates();
      const today = new Date().toISOString().slice(0, 10);
      return jsonResponse(res, 200, {
        ok: true,
        platforms: {
          twitter: { configured: twitterProfile, sessionActive: !!browsers.twitter },
          reddit: { configured: redditProfile, sessionActive: !!browsers.reddit },
        },
        rateLimits: {
          twitter: rates[`twitter:${today}`] || { count: 0 },
          reddit: rates[`reddit:${today}`] || { count: 0 },
        },
      });
    }

    // ── Twitter Login ───────────────────────────────────────────────────
    if (url.pathname === "/twitter/login" && req.method === "POST") {
      const { username, password } = await parseBody(req);
      if (!username || !password) return jsonResponse(res, 400, { ok: false, error: "username and password required" });
      const result = await twitterLogin(username, password);
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    // ── Twitter Post ────────────────────────────────────────────────────
    if (url.pathname === "/twitter/post" && req.method === "POST") {
      const { text } = await parseBody(req);
      if (!text) return jsonResponse(res, 400, { ok: false, error: "text required" });
      const result = await twitterPost(text);
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    // ── Twitter Reply ───────────────────────────────────────────────────
    if (url.pathname === "/twitter/reply" && req.method === "POST") {
      const { url: tweetUrl, text } = await parseBody(req);
      if (!tweetUrl || !text) return jsonResponse(res, 400, { ok: false, error: "url and text required" });
      const result = await twitterReply(tweetUrl, text);
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    // ── Reddit Login ────────────────────────────────────────────────────
    if (url.pathname === "/reddit/login" && req.method === "POST") {
      const { username, password } = await parseBody(req);
      if (!username || !password) return jsonResponse(res, 400, { ok: false, error: "username and password required" });
      const result = await redditLogin(username, password);
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    // ── Reddit Post ─────────────────────────────────────────────────────
    if (url.pathname === "/reddit/post" && req.method === "POST") {
      const { subreddit, title, body, url: postUrl } = await parseBody(req);
      if (!subreddit || !title) return jsonResponse(res, 400, { ok: false, error: "subreddit and title required" });
      const result = await redditPost(subreddit, title, body || "", postUrl || "");
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    // ── Reddit Comment ──────────────────────────────────────────────────
    if (url.pathname === "/reddit/comment" && req.method === "POST") {
      const { url: postUrl, text } = await parseBody(req);
      if (!postUrl || !text) return jsonResponse(res, 400, { ok: false, error: "url and text required" });
      const result = await redditComment(postUrl, text);
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    // ── Disconnect Platform ────────────────────────────────────────────
    if (url.pathname === "/twitter/disconnect" && req.method === "POST") {
      await closeBrowser("twitter");
      const profileDir = path.join(PROFILES_DIR, "twitter");
      if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
      return jsonResponse(res, 200, { ok: true, message: "Twitter disconnected" });
    }
    if (url.pathname === "/reddit/disconnect" && req.method === "POST") {
      await closeBrowser("reddit");
      const profileDir = path.join(PROFILES_DIR, "reddit");
      if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
      return jsonResponse(res, 200, { ok: true, message: "Reddit disconnected" });
    }

    // ── Close Browser ───────────────────────────────────────────────────
    if (url.pathname === "/close" && req.method === "POST") {
      const { platform } = await parseBody(req);
      if (platform) await closeBrowser(platform);
      else { for (const p of Object.keys(browsers)) await closeBrowser(p); }
      return jsonResponse(res, 200, { ok: true, message: "Browser closed" });
    }

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    jsonResponse(res, 500, { ok: false, error: e.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`Social Bridge running on http://localhost:${PORT}`);
  console.log(`Browser profiles: ${PROFILES_DIR}`);
});

// Cleanup on exit
process.on("SIGINT", async () => { for (const p of Object.keys(browsers)) await closeBrowser(p); process.exit(0); });
process.on("SIGTERM", async () => { for (const p of Object.keys(browsers)) await closeBrowser(p); process.exit(0); });

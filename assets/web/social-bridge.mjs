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

// ── Logging ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

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
  if (browsers[platform]) {
    // Verify browser is still alive
    try { await browsers[platform].pages(); }
    catch { delete browsers[platform]; }
  }
  if (browsers[platform]) return browsers[platform];

  const chromiumModule = await getChromium();
  const profileDir = path.join(PROFILES_DIR, platform);
  ensureDir(profileDir);

  log(`Launching browser for ${platform}...`);
  const browser = await chromiumModule.launchPersistentContext(profileDir, {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
    ],
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    timeout: 60_000,
  });

  browsers[platform] = browser;
  log(`Browser launched for ${platform}`);
  return browser;
}

async function closeBrowser(platform) {
  if (browsers[platform]) {
    try { await browsers[platform].close(); } catch {}
    delete browsers[platform];
  }
}

// ── Helper: safe navigation (never use networkidle for Twitter) ─────────────

async function safeGoto(page, url, opts = {}) {
  // Twitter never reaches networkidle — use domcontentloaded + manual wait
  const isTwitter = url.includes("x.com") || url.includes("twitter.com");
  const waitUntil = isTwitter ? "domcontentloaded" : (opts.waitUntil || "domcontentloaded");
  await page.goto(url, { waitUntil, timeout: opts.timeout || 45_000 });
  // Give dynamic content time to render
  await page.waitForTimeout(isTwitter ? 4000 : 2000);
}

// ── Helper: wait for selector with fallbacks ────────────────────────────────

async function waitForAny(page, selectors, timeout = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return { element: el, selector: sel };
      } catch {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// ── Twitter/X Implementation ────────────────────────────────────────────────

const TWITTER_SELECTORS = {
  login: {
    username: ['input[autocomplete="username"]', 'input[name="text"]', 'input[data-testid="ocfEnterTextTextInput"]'],
    password: ['input[name="password"]', 'input[type="password"]'],
    nextButton: ['div[data-testid="LoginForm_Login_Button"]', 'button[data-testid="LoginForm_Login_Button"]', 'div[role="button"]'],
    loginButton: ['div[data-testid="LoginForm_Login_Button"]', 'button[data-testid="LoginForm_Login_Button"]'],
  },
  compose: {
    textBox: ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]', 'div.DraftEditor-root'],
    postButton: ['div[data-testid="tweetButtonInline"]', 'button[data-testid="tweetButtonInline"]', 'div[data-testid="tweetButton"]'],
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
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        // Clipboard paste — most reliable for React contenteditable
        await page.evaluate((text) => {
          const el = document.activeElement;
          if (el) {
            const cd = new DataTransfer();
            cd.setData("text/plain", text);
            el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: cd, bubbles: true, cancelable: true }));
          }
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
    log("Navigating to Twitter login...");
    await safeGoto(page, "https://x.com/login");

    // Check if already logged in
    const currentUrl = page.url();
    if (currentUrl.includes("/home") || currentUrl.includes("x.com/home")) {
      log("Already logged in");
      return { ok: true, message: "Already logged in", username };
    }

    // Wait for login form
    log("Waiting for login form...");
    const usernameField = await waitForAny(page, TWITTER_SELECTORS.login.username, 15_000);
    if (!usernameField) {
      // Maybe we're already on home page
      if (page.url().includes("/home")) return { ok: true, message: "Already logged in", username };
      return { ok: false, error: "Could not find login form — page may have changed" };
    }

    // Type username
    log("Typing username...");
    await usernameField.element.click();
    await page.keyboard.type(username, { delay: 50 });
    await page.waitForTimeout(500);

    // Click Next/Continue
    const nextBtn = await waitForAny(page, TWITTER_SELECTORS.login.nextButton, 5_000);
    if (nextBtn) {
      await nextBtn.element.click();
      await page.waitForTimeout(2000);
    }

    // Check for verification challenges
    const pageContent = await page.content();
    if (/unusual|verify|phone|checkpoint/i.test(pageContent)) {
      return { ok: false, error: "Login requires verification — open a real browser, log in manually, then the session will persist" };
    }

    // Wait for password field
    log("Waiting for password field...");
    const passwordField = await waitForAny(page, TWITTER_SELECTORS.login.password, 10_000);
    if (!passwordField) {
      // Maybe it went straight to home (SSO?)
      if (page.url().includes("/home")) return { ok: true, message: "Logged in successfully", username };
      return { ok: false, error: "Could not find password field" };
    }

    // Type password
    log("Typing password...");
    await passwordField.element.click();
    await page.keyboard.type(password, { delay: 50 });
    await page.waitForTimeout(500);

    // Click login button
    const loginBtn = await waitForAny(page, TWITTER_SELECTORS.login.loginButton, 5_000);
    if (loginBtn) {
      await loginBtn.element.click();
      await page.waitForTimeout(5000);
    }

    // Verify login success — wait up to 15s for home page
    log("Verifying login...");
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      const url = page.url();
      if (url.includes("/home")) {
        log("Login successful");
        return { ok: true, message: "Logged in successfully", username };
      }
      // Check for errors
      const content = await page.content();
      if (/wrong.*password|incorrect|suspended|locked/i.test(content)) {
        return { ok: false, error: "Login failed — wrong credentials or account locked" };
      }
    }

    return { ok: false, error: "Login timed out — check credentials or try again" };
  } catch (e) {
    log(`Login error: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}

async function twitterPost(text) {
  const rateCheck = checkRateLimit("twitter");
  if (!rateCheck.allowed) return { ok: false, error: rateCheck.reason };

  const browser = await getBrowser("twitter");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    log("Navigating to Twitter home...");
    await safeGoto(page, "https://x.com/home");

    // Check if logged in
    if (page.url().includes("login") || page.url().includes("Log")) {
      return { ok: false, error: "Not logged in — run login_twitter first" };
    }

    // Wait for compose box
    log("Looking for compose box...");
    const composeBox = await waitForAny(page, TWITTER_SELECTORS.compose.textBox, 15_000);
    if (!composeBox) {
      // Take screenshot for debugging
      await page.screenshot({ path: path.join(STATE_DIR, "twitter-debug.png") }).catch(() => {});
      return { ok: false, error: "Could not find tweet compose box — screenshot saved to social-state/twitter-debug.png" };
    }

    // Click and type
    log("Typing tweet...");
    await composeBox.element.click();
    await page.waitForTimeout(500);

    // Use clipboard paste for the text (most reliable for React)
    await page.evaluate((t) => {
      const el = document.activeElement;
      if (el) {
        const cd = new DataTransfer();
        cd.setData("text/plain", t);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: cd, bubbles: true, cancelable: true }));
      }
    }, text);
    await page.waitForTimeout(1500);

    // Find and click post button
    log("Clicking post button...");
    const postBtn = await waitForAny(page, TWITTER_SELECTORS.compose.postButton, 5_000);
    if (!postBtn) {
      await page.screenshot({ path: path.join(STATE_DIR, "twitter-debug.png") }).catch(() => {});
      return { ok: false, error: "Could not find Post button — screenshot saved" };
    }
    await postBtn.element.click();
    await page.waitForTimeout(4000);

    // Verify success
    const content = await page.content();
    const success = /sent|posted|your post/i.test(content) || page.url().includes("/home");

    if (success) {
      recordPost("twitter");
      log("Tweet posted successfully");
      return { ok: true, message: "Tweet posted successfully" };
    }

    await page.screenshot({ path: path.join(STATE_DIR, "twitter-debug.png") }).catch(() => {});
    return { ok: false, error: "Post may have failed — check social-state/twitter-debug.png" };
  } catch (e) {
    log(`Twitter post error: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}

async function twitterReply(tweetUrl, text) {
  const rateCheck = checkRateLimit("twitter");
  if (!rateCheck.allowed) return { ok: false, error: rateCheck.reason };

  const browser = await getBrowser("twitter");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    await safeGoto(page, tweetUrl);

    if (page.url().includes("login")) {
      return { ok: false, error: "Not logged in" };
    }

    // Find reply box
    const replyBox = await waitForAny(page, TWITTER_SELECTORS.compose.textBox, 10_000);
    if (!replyBox) return { ok: false, error: "Could not find reply box" };

    await replyBox.element.click();
    await page.waitForTimeout(500);

    await page.evaluate((t) => {
      const el = document.activeElement;
      if (el) {
        const cd = new DataTransfer();
        cd.setData("text/plain", t);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: cd, bubbles: true, cancelable: true }));
      }
    }, text);
    await page.waitForTimeout(1500);

    const postBtn = await waitForAny(page, TWITTER_SELECTORS.compose.postButton, 5_000);
    if (postBtn) await postBtn.element.click();
    await page.waitForTimeout(4000);

    recordPost("twitter");
    return { ok: true, message: "Reply posted successfully" };
  } catch (e) {
    log(`Twitter reply error: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}

// ── Reddit Implementation ───────────────────────────────────────────────────

async function redditLogin(username, password) {
  const browser = await getBrowser("reddit");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    log("Navigating to Reddit login...");
    await safeGoto(page, "https://old.reddit.com/login");

    // Check if already logged in
    const hasNav = await page.$('a[href="/submit"]');
    if (hasNav) {
      log("Already logged in to Reddit");
      return { ok: true, message: "Already logged in", username };
    }

    // Wait for login form
    const usernameField = await waitForAny(page, ['input[name="user"]', '#login-username', 'input[name="username"]'], 10_000);
    if (!usernameField) return { ok: false, error: "Could not find Reddit login form" };

    await usernameField.element.fill(username);
    await page.waitForTimeout(300);

    const passwordField = await waitForAny(page, ['input[name="passwd"]', '#login-password', 'input[name="password"]'], 5_000);
    if (!passwordField) return { ok: false, error: "Could not find password field" };

    await passwordField.element.fill(password);
    await page.waitForTimeout(300);

    const loginBtn = await waitForAny(page, ['button[type="submit"]', '.submit'], 5_000);
    if (loginBtn) await loginBtn.element.click();
    await page.waitForTimeout(5000);

    // Verify
    if (!page.url().includes("login")) {
      log("Reddit login successful");
      return { ok: true, message: "Logged in successfully", username };
    }

    return { ok: false, error: "Reddit login failed — check credentials" };
  } catch (e) {
    log(`Reddit login error: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}

async function redditPost(subreddit, title, body, url) {
  const rateCheck = checkRateLimit("reddit");
  if (!rateCheck.allowed) return { ok: false, error: rateCheck.reason };

  const browser = await getBrowser("reddit");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    const submitUrl = url
      ? `https://old.reddit.com/r/${subreddit}/submit?submit_type=link`
      : `https://old.reddit.com/r/${subreddit}/submit?submit_type=self`;

    log(`Posting to r/${subreddit}...`);
    await safeGoto(page, submitUrl);

    if (page.url().includes("login")) {
      return { ok: false, error: "Not logged in — run login_reddit first" };
    }

    // Wait for title field
    const titleField = await waitForAny(page, ['textarea[name="title"]', '#title-field', 'input[name="title"]'], 10_000);
    if (!titleField) {
      await page.screenshot({ path: path.join(STATE_DIR, "reddit-debug.png") }).catch(() => {});
      return { ok: false, error: "Could not find title field — screenshot saved" };
    }

    await titleField.element.fill(title);

    if (url) {
      const urlField = await page.$('input[name="url"]') || await page.$('#url-field');
      if (urlField) await urlField.fill(url);
    } else if (body) {
      const bodyField = await page.$('textarea[name="text"]') || await page.$('#text-field');
      if (bodyField) await bodyField.fill(body);
    }

    await page.waitForTimeout(1000);

    const submitBtn = await waitForAny(page, ['button[type="submit"]', '.submit-button'], 5_000);
    if (submitBtn) await submitBtn.element.click();
    await page.waitForTimeout(5000);

    const content = await page.content();
    if (/error|too fast|rate.?limit/i.test(content)) {
      return { ok: false, error: "Post may have been rate limited" };
    }

    recordPost("reddit");
    log(`Posted to r/${subreddit}`);
    return { ok: true, message: `Posted to r/${subreddit} successfully` };
  } catch (e) {
    log(`Reddit post error: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}

async function redditComment(postUrl, text) {
  const rateCheck = checkRateLimit("reddit");
  if (!rateCheck.allowed) return { ok: false, error: rateCheck.reason };

  const browser = await getBrowser("reddit");
  const page = browser.pages()[0] || await browser.newPage();

  try {
    const oldUrl = postUrl.replace(/(?:www\.)?reddit\.com/, "old.reddit.com");
    log("Commenting on Reddit post...");
    await safeGoto(page, oldUrl);

    if (page.url().includes("login")) return { ok: false, error: "Not logged in" };

    const commentBox = await waitForAny(page, ['textarea[name="text"]', '.comment-input textarea'], 10_000);
    if (!commentBox) return { ok: false, error: "Could not find comment box" };

    await commentBox.element.fill(text);
    await page.waitForTimeout(1000);

    const submitBtn = await waitForAny(page, ['button[type="submit"]', '.save-button'], 5_000);
    if (submitBtn) await submitBtn.element.click();
    await page.waitForTimeout(3000);

    recordPost("reddit");
    return { ok: true, message: "Comment posted successfully" };
  } catch (e) {
    log(`Reddit comment error: ${e.message}`);
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

    // ── Disconnect ──────────────────────────────────────────────────────
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
    log(`Server error: ${e.message}`);
    jsonResponse(res, 500, { ok: false, error: e.message || String(e) });
  }
});

server.listen(PORT, () => {
  log(`Social Bridge running on http://localhost:${PORT}`);
  log(`Browser profiles: ${PROFILES_DIR}`);
});

process.on("SIGINT", async () => { for (const p of Object.keys(browsers)) await closeBrowser(p); process.exit(0); });
process.on("SIGTERM", async () => { for (const p of Object.keys(browsers)) await closeBrowser(p); process.exit(0); });

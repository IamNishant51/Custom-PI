#!/usr/bin/env node
/**
 * social-bridge.mjs — Playwright social media automation (Twitter + Reddit)
 *
 * First-time setup: node social-bridge.mjs --setup-twitter
 *   Opens a visible browser, you log in manually, session is saved.
 *
 * Then the bridge handles posting headlessly using saved session.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = parseInt(process.env.SOCIAL_BRIDGE_PORT || "9877", 10);
const PI_DIR = path.join(os.homedir(), ".pi", "agent");
const PROFILES_DIR = path.join(PI_DIR, "browser-profiles");
const STATE_DIR = path.join(PI_DIR, "social-state");

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
ensureDir(PROFILES_DIR); ensureDir(STATE_DIR);
function log(msg) { console.log(`[social ${new Date().toISOString().slice(11, 19)}] ${msg}`); }

// ── Rate Limiting ───────────────────────────────────────────────────────────



function checkRate(platform) { return { ok: true }; }

// ── Browser ─────────────────────────────────────────────────────────────────

let chromium = null;
const contexts = {};

async function getCtx(platform, headless = true) {
  if (contexts[platform]) {
    try { await contexts[platform].pages(); } catch { delete contexts[platform]; }
  }
  if (contexts[platform]) return contexts[platform];
  if (!chromium) { chromium = (await import("playwright")).chromium; }
  const profileDir = path.join(PROFILES_DIR, platform);
  ensureDir(profileDir);
  log(`Launching ${platform} browser (headless=${headless})...`);
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-blink-features=AutomationControlled"],
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  contexts[platform] = ctx;
  return ctx;
}

// ── Twitter ─────────────────────────────────────────────────────────────────

async function twitterIsLoggedIn(page) {
  try {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(4000);
    const url = page.url();
    if (url.includes("/login") || url.includes("/Log")) return false;
    const hasTimeline = await page.$('div[data-testid="primaryColumn"]');
    const hasCompose = await page.$('a[data-testid="AppTabBar_Compose_Link"]');
    const hasNav = await page.$('nav[data-testid="AppTabBar"]');
    return !!(hasTimeline || hasCompose || hasNav);
  } catch { return false; }
}

async function twitterManualLogin() {
  const ctx = await getCtx("twitter", false); // visible browser
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    log("Opening Twitter login — please log in manually in the browser window...");
    await page.goto("https://x.com/login", { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Wait up to 120 seconds for user to complete login
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      const url = page.url();
      if (url.includes("/home")) {
        log("Login successful! Session saved.");
        return { ok: true, message: "Logged in successfully. Session saved." };
      }
    }
    return { ok: false, error: "Login timed out after 2 minutes" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function twitterAutoLogin(username, password) {
  const ctx = await getCtx("twitter", true);
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    // First check if already logged in
    const loggedIn = await twitterIsLoggedIn(page);
    if (loggedIn) return { ok: true, message: "Already logged in" };

    log("Navigating to Twitter login...");
    await page.goto("https://x.com/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);

    // Find and fill username — Twitter uses various input types
    log("Looking for username field...");
    let filled = false;
    for (const sel of ['input[autocomplete="username"]', 'input[name="text"]', 'input[type="text"]']) {
      try {
        const el = await page.waitForSelector(sel, { timeout: 5000, state: "visible" });
        if (el) { await el.click(); await page.waitForTimeout(300); await el.fill(username); filled = true; log(`Filled username with ${sel}`); break; }
      } catch {}
    }
    if (!filled) return { ok: false, error: "Could not find username input on login page" };

    await page.waitForTimeout(500);

    // Click Continue / Next button
    log("Clicking Continue...");
    for (const sel of ['button[data-testid="LoginForm_Login_Button"]', 'div[data-testid="LoginForm_Login_Button"]', 'div[role="button"]', 'button[type="button"]']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); log(`Clicked ${sel}`); break; }
      } catch {}
    }
    await page.waitForTimeout(3000);

    // Check if we're already at password step or if there's a verification challenge
    const pageText = await page.textContent("body").catch(() => "");
    if (/unusual|verify|phone|checkpoint|suspended/i.test(pageText)) {
      return { ok: false, error: "Twitter requires verification. Use manual login: restart bridge with --setup-twitter" };
    }

    // Find and fill password
    log("Looking for password field...");
    let passFilled = false;
    for (const sel of ['input[name="password"]', 'input[type="password"]']) {
      try {
        const el = await page.waitForSelector(sel, { timeout: 5000, state: "visible" });
        if (el) { await el.click(); await page.waitForTimeout(300); await el.fill(password); passFilled = true; log(`Filled password with ${sel}`); break; }
      } catch {}
    }
    if (!passFilled) {
      // Maybe we got redirected to home (SSO login?)
      if (await twitterIsLoggedIn(page)) return { ok: true, message: "Logged in" };
      return { ok: false, error: "Could not find password field" };
    }

    await page.waitForTimeout(500);

    // Click login button
    log("Clicking login...");
    for (const sel of ['div[data-testid="LoginForm_Login_Button"]', 'button[data-testid="LoginForm_Login_Button"]', 'div[role="button"]', 'button[type="submit"]']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); break; }
      } catch {}
    }

    // Wait for navigation to home
    log("Waiting for login to complete...");
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      if (await twitterIsLoggedIn(page)) {
        log("Login successful!");
        return { ok: true, message: "Logged in successfully" };
      }
      // Check for errors
      const text = await page.textContent("body").catch(() => "");
      if (/wrong.*password|incorrect|invalid/i.test(text)) {
        return { ok: false, error: "Wrong password" };
      }
    }

    return { ok: false, error: "Login timed out — try manual login with --setup-twitter" };
  } catch (e) {
    log(`Login error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function twitterPost(text) {

  // Close stale context to load fresh cookies from disk
  if (contexts.twitter) { try { await contexts.twitter.close(); } catch {} delete contexts.twitter; }
  const ctx = await getCtx("twitter", true);
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    const loggedIn = await twitterIsLoggedIn(page);
    if (!loggedIn) return { ok: false, error: "Not logged in to Twitter. Run login_twitter first." };

    log("On home page, looking for compose box...");

    // The compose box on x.com home — wait with retries
    let composeBox = null;
    for (const sel of [
      'div[data-testid="tweetTextarea_0"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[data-testid="tweetTextarea_0RichTextInputContent"]',
      'div[contenteditable="true"][data-testid="tweetTextarea_0"]',
    ]) {
      try {
        composeBox = await page.waitForSelector(sel, { timeout: 5000, state: "visible" });
        if (composeBox) { log(`Found compose with ${sel}`); break; }
      } catch {}
    }

    // If no inline compose, try clicking the compose button (opens modal)
    if (!composeBox) {
      log("No inline compose box, trying compose button...");
      for (const sel of ['a[data-testid="AppTabBar_Compose_Link"]', 'a[href="/compose/post"]']) {
        try {
          const btn = await page.$(sel);
          if (btn) { await btn.click(); await page.waitForTimeout(2000); break; }
        } catch {}
      }
      // Try again for modal compose
      for (const sel of [
        'div[data-testid="tweetTextarea_0"]',
        'div[role="textbox"][contenteditable="true"]',
      ]) {
        try {
          composeBox = await page.waitForSelector(sel, { timeout: 5000, state: "visible" });
          if (composeBox) { log(`Found modal compose with ${sel}`); break; }
        } catch {}
      }
    }

    if (!composeBox) {
      await page.screenshot({ path: path.join(STATE_DIR, "twitter-debug.png") });
      return { ok: false, error: "Could not find compose box — screenshot saved" };
    }

    // Click and type using clipboard
    await composeBox.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(text, { delay: 10 });
    await page.waitForTimeout(1500);

    // Dismiss hashtag autocomplete dropdown by pressing Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Check character count — Twitter counts emojis as 2, URLs as 23
    function twitterCharCount(s) {
      let count = 0;
      for (const ch of s) {
        const code = ch.codePointAt(0);
        if (code > 0xFFFF) count += 2;
        else count += 1;
      }
      // URLs count as 23 chars
      count += (s.match(/https?:\/\/\S+/g) || []).length * 22;
      return count;
    }
    const charCount = twitterCharCount(text);
    if (charCount > 280) {
      return { ok: false, error: `Tweet too long: ${charCount}/280 chars. Shorten the text.` };
    }

    // Find and click post button
    let posted = false;
    for (const sel of [
      'div[data-testid="tweetButtonInline"]',
      'button[data-testid="tweetButtonInline"]',
      'div[data-testid="tweetButton"]',
    ]) {
      try {
        const btn = await page.waitForSelector(sel, { timeout: 3000, state: "visible" });
        if (btn) { await btn.click(); posted = true; log(`Clicked post with ${sel}`); break; }
      } catch {}
    }

    if (!posted) {
      await page.screenshot({ path: path.join(STATE_DIR, "twitter-debug.png") });
      return { ok: false, error: "Could not find Post button — screenshot saved" };
    }

    await page.waitForTimeout(3000);
    log("Tweet posted!");
    return { ok: true, message: "Tweet posted successfully" };
  } catch (e) {
    log(`Post error: ${e.message}`);
    await page.screenshot({ path: path.join(STATE_DIR, "twitter-debug.png") }).catch(() => {});
    return { ok: false, error: e.message };
  }
}

async function twitterReply(tweetUrl, text) {

  if (contexts.twitter) { try { await contexts.twitter.close(); } catch {} delete contexts.twitter; }
  const ctx = await getCtx("twitter", true);
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    await page.goto(tweetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4000);

    if (page.url().includes("/login")) return { ok: false, error: "Not logged in" };

    let replyBox = null;
    for (const sel of ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]']) {
      try {
        replyBox = await page.waitForSelector(sel, { timeout: 5000, state: "visible" });
        if (replyBox) break;
      } catch {}
    }
    if (!replyBox) return { ok: false, error: "Could not find reply box" };

    await replyBox.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(text, { delay: 10 });
    await page.waitForTimeout(1500);

    for (const sel of ['div[data-testid="tweetButtonInline"]', 'button[data-testid="tweetButtonInline"]']) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      } catch {}
    }

    await page.waitForTimeout(3000);
    recordPost("twitter");
    return { ok: true, message: "Reply posted" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Reddit ──────────────────────────────────────────────────────────────────

async function redditManualLogin() {
  const ctx = await getCtx("reddit", false);
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    log("Opening Reddit login — please log in manually...");
    await page.goto("https://www.reddit.com/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      if (page.url().includes("/submit") || page.url().includes("/r/") || (await page.$('a[href="/submit"]'))) {
        log("Reddit login successful!");
        return { ok: true, message: "Logged in successfully" };
      }
    }
    return { ok: false, error: "Login timed out" };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function redditAutoLogin(username, password) {
  const ctx = await getCtx("reddit", true);
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    await page.goto("https://www.reddit.com/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);

    // Check if already logged in
    if (await page.$('a[href="/submit"]')) return { ok: true, message: "Already logged in" };

    // Fill username
    for (const sel of ['input[name="username"]', '#login-username', 'input[autocomplete="username"]']) {
      try {
        const el = await page.waitForSelector(sel, { timeout: 5000, state: "visible" });
        if (el) { await el.fill(username); log(`Filled Reddit username`); break; }
      } catch {}
    }
    await page.waitForTimeout(300);

    // Fill password
    for (const sel of ['input[name="password"]', '#login-password', 'input[type="password"]']) {
      try {
        const el = await page.waitForSelector(sel, { timeout: 5000, state: "visible" });
        if (el) { await el.fill(password); log(`Filled Reddit password`); break; }
      } catch {}
    }
    await page.waitForTimeout(300);

    // Click login
    for (const sel of ['button[type="submit"]', 'button[name="submit"]']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); break; }
      } catch {}
    }

    await page.waitForTimeout(5000);
    if (!page.url().includes("login")) {
      log("Reddit login successful!");
      return { ok: true, message: "Logged in" };
    }
    return { ok: false, error: "Login failed — check credentials" };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function redditPost(subreddit, title, body, url) {

  const ctx = await getCtx("reddit", true);
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    const submitUrl = url
      ? `https://old.reddit.com/r/${subreddit}/submit?submit_type=link`
      : `https://old.reddit.com/r/${subreddit}/submit?submit_type=self`;
    await page.goto(submitUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);

    if (page.url().includes("login")) return { ok: false, error: "Not logged in" };

    const titleEl = await page.waitForSelector('textarea[name="title"], #title-field, input[name="title"]', { timeout: 10_000, state: "visible" }).catch(() => null);
    if (!titleEl) { await page.screenshot({ path: path.join(STATE_DIR, "reddit-debug.png") }); return { ok: false, error: "Could not find title field" }; }
    await titleEl.fill(title);

    if (url) {
      const urlEl = await page.$('input[name="url"], #url-field');
      if (urlEl) await urlEl.fill(url);
    } else if (body) {
      const bodyEl = await page.$('textarea[name="text"], #text-field');
      if (bodyEl) await bodyEl.fill(body);
    }

    await page.waitForTimeout(1000);
    const submitBtn = await page.$('button[type="submit"], .submit-button');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(5000);

    return { ok: true, message: `Posted to r/${subreddit}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function redditComment(postUrl, text) {

  const ctx = await getCtx("reddit", true);
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    const oldUrl = postUrl.replace(/(?:www\.)?reddit\.com/, "old.reddit.com");
    await page.goto(oldUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    if (page.url().includes("login")) return { ok: false, error: "Not logged in" };

    const box = await page.waitForSelector('textarea[name="text"], .comment-input textarea', { timeout: 10_000, state: "visible" }).catch(() => null);
    if (!box) return { ok: false, error: "Could not find comment box" };
    await box.fill(text);
    await page.waitForTimeout(1000);

    const btn = await page.$('button[type="submit"], .save-button');
    if (btn) await btn.click();
    await page.waitForTimeout(3000);

    return { ok: true, message: "Comment posted" };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
  });
}
function json(res, s, d) { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); }

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/status" && req.method === "GET") {
      const tp = fs.existsSync(path.join(PROFILES_DIR, "twitter"));
      const rp = fs.existsSync(path.join(PROFILES_DIR, "reddit"));
      return json(res, 200, {
        ok: true,
        platforms: {
          twitter: { configured: tp, sessionActive: !!contexts.twitter },
          reddit: { configured: rp, sessionActive: !!contexts.reddit },
        },
      });
    }

    // Manual login (opens visible browser)
    if (url.pathname === "/twitter/setup" && req.method === "POST") {
      return json(res, 200, await twitterManualLogin());
    }
    if (url.pathname === "/reddit/setup" && req.method === "POST") {
      return json(res, 200, await redditManualLogin());
    }

    // Auto login (headless, username + password)
    if (url.pathname === "/twitter/login" && req.method === "POST") {
      const { username, password } = await parseBody(req);
      if (!username || !password) return json(res, 400, { ok: false, error: "username and password required" });
      return json(res, 200, await twitterAutoLogin(username, password));
    }
    if (url.pathname === "/reddit/login" && req.method === "POST") {
      const { username, password } = await parseBody(req);
      if (!username || !password) return json(res, 400, { ok: false, error: "username and password required" });
      return json(res, 200, await redditAutoLogin(username, password));
    }

    // Post
    if (url.pathname === "/twitter/post" && req.method === "POST") {
      const { text } = await parseBody(req);
      if (!text) return json(res, 400, { ok: false, error: "text required" });
      return json(res, 200, await twitterPost(text));
    }
    if (url.pathname === "/twitter/reply" && req.method === "POST") {
      const { url: u, text } = await parseBody(req);
      if (!u || !text) return json(res, 400, { ok: false, error: "url and text required" });
      return json(res, 200, await twitterReply(u, text));
    }
    if (url.pathname === "/reddit/post" && req.method === "POST") {
      const { subreddit, title, body, url: u } = await parseBody(req);
      if (!subreddit || !title) return json(res, 400, { ok: false, error: "subreddit and title required" });
      return json(res, 200, await redditPost(subreddit, title, body || "", u || ""));
    }
    if (url.pathname === "/reddit/comment" && req.method === "POST") {
      const { url: u, text } = await parseBody(req);
      if (!u || !text) return json(res, 400, { ok: false, error: "url and text required" });
      return json(res, 200, await redditComment(u, text));
    }

    // Disconnect
    if (url.pathname === "/twitter/disconnect" && req.method === "POST") {
      if (contexts.twitter) { try { await contexts.twitter.close(); } catch {} delete contexts.twitter; }
      const d = path.join(PROFILES_DIR, "twitter");
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
      return json(res, 200, { ok: true, message: "Twitter disconnected" });
    }
    if (url.pathname === "/reddit/disconnect" && req.method === "POST") {
      if (contexts.reddit) { try { await contexts.reddit.close(); } catch {} delete contexts.reddit; }
      const d = path.join(PROFILES_DIR, "reddit");
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
      return json(res, 200, { ok: true, message: "Reddit disconnected" });
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    log(`Error: ${e.message}`);
    json(res, 500, { ok: false, error: e.message });
  }
});

// ── CLI mode ────────────────────────────────────────────────────────────────

if (process.argv.includes("--setup-twitter")) {
  log("Starting manual Twitter login...");
  twitterManualLogin().then(r => { log(r.message || r.error); process.exit(r.ok ? 0 : 1); });
} else if (process.argv.includes("--setup-reddit")) {
  log("Starting manual Reddit login...");
  redditManualLogin().then(r => { log(r.message || r.error); process.exit(r.ok ? 0 : 1); });
} else {
  server.listen(PORT, () => {
    log(`Social Bridge running on http://localhost:${PORT}`);
    log(`Manual setup: node social-bridge.mjs --setup-twitter | --setup-reddit`);
  });
}

process.on("SIGINT", async () => { for (const p of Object.keys(contexts)) { try { await contexts[p].close(); } catch {} } process.exit(0); });
process.on("SIGTERM", async () => { for (const p of Object.keys(contexts)) { try { await contexts[p].close(); } catch {} } process.exit(0); });

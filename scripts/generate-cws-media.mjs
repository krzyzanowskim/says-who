// Generates Chrome Web Store media assets:
//   - docs/cws/screenshot-1-light.png (1280x800)
//   - docs/cws/screenshot-2-dark.png (1280x800)
//   - docs/cws/screenshot-3-settings.png (1280x800)
//   - docs/cws/promo-tile-440x280.png (440x280)
//   - docs/cws/marquee-1400x560.png (1400x560)
//
// Run: node scripts/generate-cws-media.mjs

import { chromium } from 'playwright-core';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timelineJson } from '../test/feed.mjs';
import { normalise } from '../extension/lib/text.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(root, 'extension');
const OUT = path.join(root, 'docs', 'cws');
await mkdir(OUT, { recursive: true });

const posts = JSON.parse(await readFile(path.join(root, 'test', 'posts.json'), 'utf8'));
const byId = (id) => posts.find((p) => p.id === id);

const shortPost = { id: 'short', author: 'Nell Aziz', handle: 'nellaziz', bio: 'CEO of an AI lab.', expect: 'flagged', take: 'hype', stake: 'founder', text: 'AI is so back 🚀' };
const aside = { id: 'aside', author: 'Dana Whitlock', handle: 'danawhitlock', bio: byId('founder-jobs').bio, link: 'lumenagents.ai', expect: 'kept', take: 'not_ai', stake: 'founder', text: 'Lunch.' };
byId('investor-prediction').image = true;
const feedPosts = [...posts.slice(0, 3), shortPost, ...posts.slice(3), aside];

const spread = (ids, winner) => Object.fromEntries(ids.map((k) => [k, k === winner ? 0.9 : 0.1 / (ids.length - 1)]));

function mockAnswer(body) {
  if (body.questions.known) {
    const famous = feedPosts.some((p) => p.mockKnown && `@${p.handle}` === body.state.author_handle);
    const choice = famous ? 'ai_insider' : 'unknown';
    return { model: 'mock-jev', answers: { known: { type: 'choice', choice, confidence: 0.98, probabilities: { [choice]: 0.98 } } }, usage: { input_tokens: 0, output_tokens: 0 } };
  }
  const text = body.state.post;
  const post = feedPosts.find((p) => normalise(p.text).slice(0, 50) === text.slice(0, 50));
  const take = post?.take ?? 'information';
  const stake = post?.stake ?? 'unstated';
  const answers = {
    take: { type: 'choice', choice: take, confidence: 0.9, probabilities: spread(Object.keys(body.questions.take.criteria), take) },
    stake: { type: 'choice', choice: stake, confidence: 0.9, probabilities: spread(Object.keys(body.questions.stake.criteria), stake) },
  };
  const basis = post?.source === 'post' ? 'post' : stake === 'unstated' ? 'neither' : 'profile';
  answers.basis = { type: 'choice', choice: basis, confidence: 0.9, probabilities: { [basis]: 0.9 } };
  if (body.questions.org) {
    const choice = post?.org && post.org in body.questions.org.criteria ? post.org : 'none_of_these';
    answers.org = { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.95 } };
  }
  if (body.questions.wares) {
    const choice = post?.product && post.product in body.questions.wares.criteria ? post.product : 'none_of_these';
    answers.wares = { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.95 } };
  }
  return { model: 'mock-jev', answers, usage: { input_tokens: 0, output_tokens: 0 } };
}

function customFeedHtml({ dark = false } = {}) {
  const bg = dark ? '#000000' : '#ffffff';
  const text = dark ? '#e7e9ea' : '#0f1419';
  const muted = dark ? '#71767b' : '#536471';
  const line = dark ? '#2f3336' : '#eff3f4';
  const cardBg = dark ? '#16181c' : '#f7f9f9';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>X</title>
<style>
  :root { --bg: ${bg}; --text: ${text}; --muted: ${muted}; --line: ${line}; --card: ${cardBg}; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .layout { display: flex; justify-content: center; min-height: 100vh; }
  .sidebar-left { width: 220px; padding: 12px 16px; border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 20px; }
  .logo { font-size: 24px; font-weight: 800; padding: 4px 12px; }
  .nav-item { display: flex; align-items: center; gap: 14px; font-size: 18px; font-weight: 600; padding: 10px 14px; border-radius: 9999px; }
  .nav-item.active { font-weight: 800; }
  .main-column { width: 600px; border-right: 1px solid var(--line); }
  .bar { position: sticky; top: 0; z-index: 5; height: 53px; background: color-mix(in srgb, var(--bg) 85%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); display: flex; align-items: center; padding: 0 16px; font-weight: 700; font-size: 19px; }
  .tabs { display: flex; width: 100%; height: 100%; }
  .tab { flex: 1; display: flex; justify-content: center; align-items: center; font-size: 15px; font-weight: 700; border-bottom: 4px solid #1d9bf0; }
  .tab.inactive { color: var(--muted); font-weight: 500; border-bottom: none; }
  .sidebar-right { width: 280px; padding: 12px 20px; display: flex; flex-direction: column; gap: 16px; }
  .search-box { background: var(--card); border-radius: 9999px; padding: 10px 16px; color: var(--muted); font-size: 14px; }
  .trend-box { background: var(--card); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
  .trend-title { font-weight: 800; font-size: 16px; }
  .trend-item { display: flex; flex-direction: column; font-size: 13px; gap: 2px; }
  .trend-item strong { font-size: 14px; color: var(--text); }
  .context { flex-basis: 100%; color: var(--muted); font-size: 13px; } .context a { color: inherit; text-decoration: none; }
  article { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-weight: 600; color: #333; }
  .main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .user { display: flex; gap: 4px; } .user a { color: inherit; text-decoration: none; font-weight: 700; }
  .user .muted, .user .muted a { color: var(--muted); font-weight: 400; }
  .text { display: flex; flex-direction: column; }
  .quote { margin-top: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 16px; }
  .media { height: 240px; margin-top: 12px; border-radius: 16px; }
  .actions { display: flex; justify-content: space-between; max-width: 425px; margin-top: 12px; }
  .actions button { background: none; border: 0; color: var(--muted); font: 13px/1 inherit; padding: 0; }
</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar-left">
    <div class="logo">𝕏</div>
    <div class="nav-item active"><span>Home</span></div>
    <div class="nav-item"><span>Explore</span></div>
    <div class="nav-item"><span>Notifications</span></div>
    <div class="nav-item"><span>Bookmarks</span></div>
  </aside>
  <div class="main-column">
    <div class="bar">
      <div class="tabs">
        <div class="tab">For you</div>
        <div class="tab inactive">Following</div>
      </div>
    </div>
    <main id="timeline" aria-label="Timeline: Your Home Timeline"></main>
  </div>
  <aside class="sidebar-right">
    <div class="search-box">Search</div>
    <div class="trend-box">
      <div class="trend-title">What's happening</div>
      <div class="trend-item"><span style="color:var(--muted)">Technology · Trending</span><strong>Artificial Intelligence</strong><span style="color:var(--muted)">284K posts</span></div>
      <div class="trend-item"><span style="color:var(--muted)">Tech · Trending</span><strong>LLMs & Agents</strong><span style="color:var(--muted)">92K posts</span></div>
    </div>
  </aside>
</div>
<script>
  const main = document.getElementById('timeline');
  const draw = (json) => {
    for (const entry of json.data.home.home_timeline_urt.instructions[0].entries) main.insertAdjacentHTML('beforeend', entry.html);
  };
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/i/api/graphql/test/HomeTimeline?half=1');
  xhr.onload = () => {
    draw(JSON.parse(xhr.responseText));
    fetch('/i/api/graphql/test/HomeTimeline?half=2').then((r) => r.json()).then(draw);
  };
  xhr.send();
</script>
</body>
</html>`;
}

async function captureTimelineScreenshot({ dark = false, outputPath }) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'sw-cws-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: dark ? 'dark' : 'light',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  await context.route('https://api.typesafe.ai/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockAnswer(body)) });
  });

  await context.route('https://x.com/**', (route) => {
    const url = route.request().url();
    if (url.includes('/i/api/graphql/')) {
      const part = url.includes('half=1') ? feedPosts.slice(0, 3) : feedPosts.slice(3, 6);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(timelineJson(part)) });
    }
    if (url.endsWith('/home')) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: customFeedHtml({ dark }) });
    }
    return route.fulfill({ status: 204, body: '' });
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  await worker.evaluate((apiKey) =>
    chrome.storage.local.set({ settings: { apiKey, enabled: true, threshold: 0.6, model: 'jev-latest' } }),
    'mock-key'
  );

  const page = await context.newPage();
  await page.goto('https://x.com/home');
  await page.waitForSelector('article');
  await page.waitForSelector('.sw-writing', { timeout: 15000 }).catch(() => {});
  // Wait for all handwriting animations to finish writing
  await page.waitForTimeout(1600);

  await page.screenshot({ path: outputPath });
  await context.close();
  await rm(profile, { recursive: true, force: true });
}

console.log('Generating Screenshot 1 (Light)...');
await captureTimelineScreenshot({ dark: false, outputPath: path.join(OUT, 'screenshot-1-light.png') });

console.log('Generating Screenshot 2 (Dark)...');
await captureTimelineScreenshot({ dark: true, outputPath: path.join(OUT, 'screenshot-2-dark.png') });

console.log('Generating Screenshot 3 (Settings & Popup)...');
{
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Read the kalam font and css to render a beautiful settings showcase
  const fontData = (await readFile(path.join(EXT, 'fonts', 'kalam-700-latin.woff2'))).toString('base64');
  const iconData = (await readFile(path.join(EXT, 'icons', 'icon-128.png'))).toString('base64');

  await page.setContent(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'SW Kalam';
    font-weight: 700;
    src: url('data:font/woff2;base64,${fontData}') format('woff2');
  }
  :root {
    --paper: #fdfdfb;
    --ink: #1d1c1a;
    --graphite: #5f5c57;
    --rule: #e4e1dc;
    --field: #ffffff;
    --pencil: #b8321f;
    --pencil-deep: #942616;
    --serif: 'Iowan Old Style', 'Charter', Cambria, Georgia, serif;
    --sans: system-ui, -apple-system, sans-serif;
    --hand: 'SW Kalam', cursive;
  }
  body {
    margin: 0;
    background: #f4f2ee;
    font-family: var(--sans);
    color: var(--ink);
    height: 800px;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 36px 48px;
    gap: 28px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .header-left img {
    width: 48px;
    height: 48px;
  }
  .title {
    font-family: var(--serif);
    font-size: 32px;
    font-weight: 700;
  }
  .tagline {
    font-size: 16px;
    color: var(--graphite);
    margin-top: 2px;
  }
  .badge {
    background: #ebe7e0;
    border: 1px solid var(--rule);
    padding: 6px 14px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 13px;
    color: var(--graphite);
  }
  .content {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 32px;
    flex: 1;
    min-height: 0;
  }
  .card {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.06);
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .card h2 {
    font-family: var(--serif);
    font-size: 20px;
    margin: 0 0 6px 0;
  }
  .card p {
    color: var(--graphite);
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
  }
  .range-box {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 8px;
  }
  .slider {
    flex: 1;
    height: 6px;
    background: var(--rule);
    border-radius: 3px;
    position: relative;
  }
  .slider-fill {
    width: 60%;
    height: 100%;
    background: var(--pencil);
    border-radius: 3px;
  }
  .slider-thumb {
    width: 18px;
    height: 18px;
    background: var(--pencil);
    border-radius: 50%;
    position: absolute;
    left: 60%;
    top: -6px;
  }
  .slider-val {
    font-weight: 700;
    font-size: 18px;
    color: var(--pencil);
    min-width: 44px;
  }
  .popup-preview {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .popup-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 18px;
    border-bottom: 1px solid var(--rule);
  }
  .popup-name {
    font-family: var(--serif);
    font-size: 17px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .popup-name img {
    width: 20px;
    height: 20px;
  }
  .pill {
    background: var(--pencil);
    color: white;
    font-size: 12px;
    font-weight: 700;
    padding: 2px 10px;
    border-radius: 12px;
  }
  .popup-body {
    padding: 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .popup-total {
    font-family: var(--serif);
    font-size: 38px;
    font-weight: 700;
    line-height: 1;
  }
  .popup-line {
    color: var(--graphite);
    font-size: 14px;
  }
  .popup-sample {
    margin-top: 14px;
    padding: 12px;
    background: #f7f5f0;
    border-radius: 8px;
    border-left: 3px solid var(--pencil);
  }
  .popup-sample-quote {
    font-size: 13px;
    color: var(--ink);
    margin-bottom: 6px;
  }
  .popup-sample-note {
    font-family: var(--hand);
    font-size: 16px;
    color: var(--pencil);
    font-weight: 700;
  }
  .popup-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    border-top: 1px solid var(--rule);
    font-size: 13px;
    color: var(--graphite);
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <img src="data:image/png;base64,${iconData}" alt="icon" />
      <div>
        <div class="title">Says Who</div>
        <div class="tagline">Discloses commercial AI stakes directly under posts on X</div>
      </div>
    </div>
    <div class="badge">Chrome Extension · Options & Controls</div>
  </div>

  <div class="content">
    <div class="card">
      <div>
        <h2>Confidence Threshold</h2>
        <p>Controls how certain the model must be before marking a post. Higher thresholds minimize false positives.</p>
        <div class="range-box">
          <div class="slider"><div class="slider-fill"></div><div class="slider-thumb"></div></div>
          <span class="slider-val">60%</span>
        </div>
      </div>
      <div>
        <h2>TypeSafe Jev Integration</h2>
        <p>Powered by TypeSafe's Jev classifier using your private API key. All evaluation queries run via HTTPS and are kept local to your browser session.</p>
      </div>
      <div>
        <h2>Privacy by Design</h2>
        <p>Only public post text and author bio metadata are evaluated. Your personal feed history and private credentials never leave your browser.</p>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:20px;">
      <div class="popup-preview">
        <div class="popup-top">
          <span class="popup-name"><img src="data:image/png;base64,${iconData}" alt="" />Says Who</span>
          <span class="pill">Active</span>
        </div>
        <div class="popup-body">
          <div class="popup-total">3 <span style="font-size:18px;color:var(--graphite)">posts marked</span></div>
          <div class="popup-line">Found on current timeline</div>
          <div class="popup-sample">
            <div class="popup-sample-quote">"Software engineering as a job is over within 2 years..."</div>
            <div class="popup-sample-note">Says the person selling AI agents.</div>
          </div>
        </div>
        <div class="popup-foot">
          <span>Settings</span>
          <span>18 verdicts cached</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`);

  await page.screenshot({ path: path.join(OUT, 'screenshot-3-settings.png') });
  await browser.close();
}

console.log('Generating Promo Tile (440x280)...');
{
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 440, height: 280 } });
  const fontData = (await readFile(path.join(EXT, 'fonts', 'kalam-700-latin.woff2'))).toString('base64');
  const iconData = (await readFile(path.join(EXT, 'icons', 'icon-128.png'))).toString('base64');

  await page.setContent(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'SW Kalam';
    font-weight: 700;
    src: url('data:font/woff2;base64,${fontData}') format('woff2');
  }
  body {
    margin: 0;
    width: 440px;
    height: 280px;
    box-sizing: border-box;
    background: #fdfdfb;
    border: 1px solid #e4e1dc;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .icon-wrap {
    margin-bottom: 12px;
  }
  .icon-wrap img {
    width: 64px;
    height: 64px;
    filter: drop-shadow(0 4px 10px rgba(0,0,0,0.08));
  }
  .title {
    font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
    font-size: 32px;
    font-weight: 800;
    color: #1d1c1a;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .subtitle {
    margin-top: 6px;
    font-size: 13px;
    font-weight: 500;
    color: #5f5c57;
  }
  .handnote {
    margin-top: 16px;
    font-family: 'SW Kalam', cursive;
    font-size: 19px;
    font-weight: 700;
    color: #b8321f;
    transform: rotate(-1.5deg);
  }
</style>
</head>
<body>
  <div class="icon-wrap"><img src="data:image/png;base64,${iconData}" alt="" /></div>
  <div class="title">Says Who</div>
  <div class="subtitle">AI commercial stakes detector for X</div>
  <div class="handnote">"Says someone whose money is riding on it."</div>
</body>
</html>`);

  await page.screenshot({ path: path.join(OUT, 'promo-tile-440x280.png') });
  await browser.close();
}

console.log('Generating Marquee Banner (1400x560)...');
{
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 560 } });
  const fontData = (await readFile(path.join(EXT, 'fonts', 'kalam-700-latin.woff2'))).toString('base64');
  const iconData = (await readFile(path.join(EXT, 'icons', 'icon-128.png'))).toString('base64');

  await page.setContent(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'SW Kalam';
    font-weight: 700;
    src: url('data:font/woff2;base64,${fontData}') format('woff2');
  }
  body {
    margin: 0;
    width: 1400px;
    height: 560px;
    box-sizing: border-box;
    background: #fdfdfb;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 60px 100px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 600px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .brand img {
    width: 80px;
    height: 80px;
  }
  .brand-title {
    font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
    font-size: 54px;
    font-weight: 800;
    color: #1d1c1a;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .desc {
    font-size: 20px;
    color: #5f5c57;
    line-height: 1.45;
  }
  .right {
    display: flex;
    flex-direction: column;
    gap: 18px;
    background: #ffffff;
    border: 1px solid #e4e1dc;
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.06);
    padding: 32px;
    width: 480px;
  }
  .card-quote {
    font-size: 16px;
    line-height: 1.4;
    color: #1d1c1a;
  }
  .card-note {
    font-family: 'SW Kalam', cursive;
    font-size: 22px;
    font-weight: 700;
    color: #b8321f;
    transform: rotate(-1.5deg);
  }
</style>
</head>
<body>
  <div class="left">
    <div class="brand">
      <img src="data:image/png;base64,${iconData}" alt="" />
      <div class="brand-title">Says Who</div>
    </div>
    <div class="desc">
      On X, marks posts about AI that come from people who build, sell, or invest in AI, and reveals what they gain from telling you.
    </div>
  </div>
  <div class="right">
    <div class="card-quote">"Calling it now: AGI by 2028, and every SaaS company that hasn't rebuilt around AI agents will be worth zero."</div>
    <div class="card-note">Says someone whose money is riding on it.</div>
  </div>
</body>
</html>`);

  await page.screenshot({ path: path.join(OUT, 'marquee-1400x560.png') });
  await browser.close();
}

console.log('All Chrome Web Store media generated in docs/cws/ !');

// Loads the unpacked extension into Chromium and opens real, public X profiles, logged
// out, to check the extension still finds posts and bios on the live site. It uses your
// TypeSafe key and sends those public posts to Jev.
//
//   node test/live.mjs <screenshot folder> <handle> [<handle> ...]
//
// X refuses headless browsers, so a window opens. Logged out, X serves its newer build;
// the timeline you see when logged in may be the older one, which test/e2e.mjs imitates.

import { chromium } from 'playwright-core';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
try { process.loadEnvFile(new URL('../.env', import.meta.url).pathname); } catch {}
const EXT = path.resolve('extension'); const OUT = process.argv[2];
const profile = await mkdtemp(path.join(os.tmpdir(), 'sw-live-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1100, height: 1400 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
let [worker] = context.serviceWorkers(); if (!worker) worker = await context.waitForEvent('serviceworker');
await worker.evaluate((apiKey) => chrome.storage.local.set({ settings: { apiKey, enabled: true, threshold: 0.6, minWords: 8, model: 'jev-latest' } }), process.env.TYPESAFE_API_KEY);
const page = await context.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const apis = []; page.on('response', (r) => { if (/graphql/.test(r.url())) apis.push(r.status() + ' ' + r.url().split('?')[0].split('/').pop()); });
for (const who of process.argv.slice(3)) {
  await page.goto(`https://x.com/${who}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('article', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => ({
    build: document.documentElement.dataset.saysWho, tap: Boolean(window.__saysWhoTap), url: location.href,
    articles: document.querySelectorAll('article').length,
    texts: document.querySelectorAll('[data-testid="tweetText"]').length,
    names: document.querySelectorAll('[data-testid="User-Name"]').length,
    bio: document.querySelector('[data-testid="UserDescription"]')?.textContent?.slice(0, 80),
    posts: [...document.querySelectorAll('article')].filter((a) => !a.parentElement.closest('article')).slice(0, 12).map((a) => ({
      state: a.dataset.sw, says: a.querySelector('.sw-says')?.textContent, why: a.querySelector('.sw-why')?.textContent?.slice(0, 70),
      text: a.querySelector('[data-testid="tweetText"], div[dir=auto]')?.textContent.slice(0, 60),
      overlap: (() => { const n = a.closest('[data-testid="cellInnerDiv"]'); const nx = n?.nextElementSibling; return n && nx ? Math.round(n.getBoundingClientRect().bottom - nx.getBoundingClientRect().top) : null; })(),
    })),
  }));
  console.log(who, JSON.stringify(info, null, 1));
  await page.screenshot({ path: path.join(OUT, `live-${who}.png`) });
}
console.log('graphql:', [...new Set(apis)].join(', ')); console.log('errors:', errors);
await context.close();

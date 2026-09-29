// Loads the unpacked extension into Chromium, serves the test feed at
// https://www.linkedin.com/feed/, scrolls through it and checks what happened.
//
//   node test/e2e.mjs                       mock Jev answers (no key needed)
//   TYPESAFE_API_KEY=... node test/e2e.mjs  real Jev
//   add --dark for the dark theme, --headed to watch

import { chromium } from 'playwright-core';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedHtml, postHtml, sduiFeedHtml } from './feed.mjs';
import { normalise } from '../extension/lib/text.js';

// A gitignored .env with TYPESAFE_API_KEY=... works as well as the environment variable.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
} catch {}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(root, 'extension');
const OUT = path.join(root, 'test', 'results');
const KEY = process.env.TYPESAFE_API_KEY;
const MOCK = !KEY || process.argv.includes('--mock');
const DARK = process.argv.includes('--dark');
const HEADED = process.argv.includes('--headed');
const SDUI = process.argv.includes('--sdui');
const SUFFIX = `${SDUI ? '-new' : ''}${DARK ? '-dark' : ''}`;
await mkdir(OUT, { recursive: true });

const posts = JSON.parse(await readFile(path.join(root, 'test', 'posts.json'), 'utf8'));
const shortPost = { id: 'short', author: 'Wren Hollis', expect: ['short'], text: 'Excited to announce I got a new job at Northwind! 🎉 #newjob' };
const reshare = {
  id: 'reshare',
  author: 'Pieter Galloway',
  expect: ['short'],
  text: 'So proud of this team. Congratulations everyone!',
};

// Feed order: a few long posts first so the top screenshot has variety, then the rest.
const order = ['new-job-sample', 'technical', 'launch', 'advice-list', 'grief', 'fundraise', 'parable-candidate', 'engagement-guide'];
const feedPosts = [...order.map((id) => posts.find((p) => p.id === id)), ...posts.filter((p) => !order.includes(p.id))];
feedPosts.find((p) => p.id === 'launch').image = true;
const withShort = [...feedPosts.slice(0, 3), shortPost, ...feedPosts.slice(3)];
let html;
if (SDUI) {
  // Someone else's "likes this" line sits above the author, and a long comment sits under a post.
  withShort.find((p) => p.id === 'launch').likedBy = 'Sam Reyes';
  withShort.find((p) => p.id === 'technical').comment =
    'Great write-up. We saw the same thing with statistics targets on a multi-tenant table, and raising it fixed our planner choices too. One thing to add: partial indexes need the exact same WHERE clause in the query, or the planner will not use them.';
  // Most real posts are clipped by CSS rather than cut short.
  for (const id of ['technical', 'advice-list', 'opinion', 'regulation']) withShort.find((p) => p.id === id).clamp = true;
  html = sduiFeedHtml(withShort, { dark: DARK });
} else {
  html = feedHtml(withShort, { dark: DARK });
  // A reshare: its own short commentary wraps someone else's long post.
  html = html.replace(
    '</main>',
    postHtml(reshare, 90, { nested: postHtml(posts.find((p) => p.id === 'milestone'), 91) }) + '\n</main>',
  );
}

// ---------- mock Jev ----------

function mockAnswer(body) {
  const text = body.state.post;
  const post = posts.find((p) => normalise(p.text).slice(0, 50) === text.slice(0, 50));
  const sad = /lost my father|depression/.test(text);
  const expect = post?.expect[0] ?? 'substantive';
  const purpose = expect === 'keep' ? (sad ? 'personal_life' : 'substantive') : expect;
  const ids = Object.keys(body.questions.purpose.criteria);
  const answers = {
    purpose: {
      type: 'choice',
      choice: purpose,
      confidence: 0.86,
      probabilities: Object.fromEntries(ids.map((k) => [k, k === purpose ? 0.9 : 0.1 / (ids.length - 1)])),
    },
    sensitive: { type: 'noul', noul: sad ? 0.96 : 0.02 },
    extra_asks_engagement: { type: 'noul', noul: /Agree\?|Comment "|Repost|like, comment|Change my mind|Tag someone/.test(text) ? 0.93 : 0.04 },
    extra_selling: { type: 'noul', noul: /course|40% off|free for your first/.test(text) ? 0.9 : 0.05 },
    extra_humblebrag: { type: 'noul', noul: post?.expect.includes('humblebrag') ? 0.9 : 0.1 },
  };
  answers.topic = { type: 'choice', choice: 'none_of_these', confidence: 0.9, probabilities: { none_of_these: 0.9 } };
  for (const [slot, want] of [['slot_joining', post?.org], ['slot_amount', post?.amount], ['slot_role', post?.role], ['slot_event', post?.event]]) {
    if (!body.questions[slot]) continue;
    const choice = want && want in body.questions[slot].criteria ? want : 'none_of_these';
    answers[slot] = { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.95 } };
  }
  return { model: 'mock-jev', answers, usage: { input_tokens: 0, output_tokens: 0 } };
}

// ---------- browser ----------

const profile = await mkdtemp(path.join(os.tmpdir(), 'lpe-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: !HEADED,
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: DARK ? 'dark' : 'light',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

let apiCalls = 0;
await context.route('https://api.typesafe.ai/**', async (route) => {
  apiCalls++;
  if (!MOCK) return route.continue();
  const body = JSON.parse(route.request().postData());
  await new Promise((r) => setTimeout(r, 700));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockAnswer(body)) });
});
await context.route('https://www.linkedin.com/**', (route) =>
  route.request().url().includes('/feed')
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    : route.fulfill({ status: 204, body: '' }),
);

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
await worker.evaluate(
  (apiKey) => chrome.storage.local.set({ settings: { apiKey, enabled: true, threshold: 0.5, minWords: 30, model: 'jev-latest' } }),
  KEY || 'mock-key',
);

const page = await context.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('page error:', m.text()));
page.on('pageerror', (e) => console.log('page exception:', e.message));
const shot = (name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}${SUFFIX}.png`), ...opts });

await page.goto('https://www.linkedin.com/feed/');
await page.waitForTimeout(250);
// Heights of every post as first drawn. Stamping must not change any of them.
const firstHeights = await page.evaluate(() =>
  [...document.querySelectorAll('[role="listitem"], [data-urn]')].filter((e) => !e.parentElement.closest('[role="listitem"], [data-urn]')).map((e) => Math.round(e.getBoundingClientRect().height)),
);
await shot('01-before');

// Catch a stamp part-way down.
await page.waitForSelector('.lpe-landing', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(140);
await shot('02-stamping');
await page.waitForTimeout(1600);
await shot('03-after');
// Before any scrolling: nothing below the screen has played yet, nothing fully in view is still waiting.
const playState = await page.evaluate(() =>
  [...document.querySelectorAll('.lpe-veil')].map((v) => {
    const n = v.querySelector('.lpe-note').getBoundingClientRect();
    return { inView: n.top >= 0 && n.bottom <= innerHeight * 0.88, waiting: v.classList.contains('lpe-waiting') };
  }),
);
// The overlay must add no height of its own: each written-over post measures the same
// with its overlay hidden.
const overlayHeights = await page.evaluate(() =>
  [...document.querySelectorAll('[data-lpe="stamped"]')].map((root) => {
    const veil = root.querySelector(':scope > .lpe-veil');
    const withVeil = root.getBoundingClientRect().height;
    veil.style.display = 'none';
    const without = root.getBoundingClientRect().height;
    veil.style.removeProperty('display');
    return Math.round(withVeil - without);
  }),
);
const pen = await page.evaluate(() => ({
  font: document.fonts.check('700 20px "LPE Kalam"') && [...document.fonts].some((f) => f.family.includes('LPE Kalam') && f.status === 'loaded'),
  fontUsed: getComputedStyle(document.querySelector('.lpe-says') || document.body).fontFamily,
  strikes: [...document.querySelectorAll('.lpe-veil')].map((v) => v.querySelectorAll('.lpe-scribbles path').length),
}));
const resized = overlayHeights.filter((d) => Math.abs(d) > 1);

// Scroll the whole feed like a reader would.
for (let i = 0; i < 40; i++) {
  const atEnd = await page.evaluate(() => {
    window.scrollBy(0, 500);
    return innerHeight + scrollY >= document.body.scrollHeight - 4;
  });
  await page.waitForTimeout(MOCK ? 450 : 900);
  if (atEnd) break;
}
await page.waitForTimeout(MOCK ? 1500 : 5000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);

const stuckWaiting = await page.evaluate(() =>
  [...document.querySelectorAll('.lpe-veil.lpe-waiting')].map((v) => {
    const root = v.parentElement;
    const r = root.getBoundingClientRect();
    const n = v.querySelector('.lpe-note').getBoundingClientRect();
    return { post: Math.round(r.height), note: Math.round(n.height), veil: Math.round(v.getBoundingClientRect().height), noteTopInVeil: Math.round(n.top - v.getBoundingClientRect().top) };
  }),
);
const loads = SDUI ? await page.evaluate(() => window.__loads) : null;
// Posts left as written stay exactly as LinkedIn drew them: "… more" is never pressed.
const keptOpen = SDUI ? null : await page.evaluate(() =>
  [...document.querySelectorAll('[data-lpe="kept"]')].map((el) => Boolean(el.querySelector('.feed-shared-inline-show-more-text.open'))),
);
const states = await page.evaluate(() =>
  [...document.querySelectorAll('[data-lpe]')].map((el) => ({
    author: el.querySelector('.update-components-actor__title [aria-hidden], .n1 span')?.textContent,
    headerVisible: (() => {
      const head = el.querySelector('.update-components-actor, .actor');
      const veil = el.querySelector(':scope > .lpe-veil');
      if (!head || !veil) return true;
      return head.getBoundingClientRect().bottom <= veil.getBoundingClientRect().top + 1;
    })(),
    words: el.querySelector('[data-testid="expandable-text-box"], .update-components-text')?.textContent.split(/\s+/).length,
    state: el.dataset.lpe,
    says: el.querySelector('.lpe-says')?.textContent || null,
    tally: el.querySelector('.lpe-tally')?.textContent || null,
  })),
);
await shot('04-feed-full', { fullPage: true });

// Lift the first stamp off, then put it back.
const first = page.locator('.lpe-veil .lpe-button').first();
await first.click();
await page.waitForTimeout(700);
const restored = await page.evaluate(() => {
  const mark = document.querySelector('.lpe-mark');
  const root = mark?.parentElement;
  return {
    mark: mark?.getAttribute('aria-label'),
    stampGone: root ? !root.querySelector(':scope > .lpe-veil') : false,
    focus: document.activeElement?.getAttribute('aria-label'),
  };
});
await shot('05-restored');
await page.locator('.lpe-mark').first().click();
await page.waitForTimeout(900);
const recollapsed = await page.evaluate(() => document.querySelectorAll('.lpe-stamped').length);

// A post clipped by CSS: "Show original" must open it fully, with nothing left frozen.
const clampCheck = SDUI
  ? await page.evaluate(async () => {
      // A post clipped by CSS: after "Show original" it is back exactly as LinkedIn drew it.
      const root = [...document.querySelectorAll('[data-lpe="stamped"]')].find((r) => r.querySelector('.clamp3'));
      if (!root) return { found: false };
      root.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 2500));
      root.querySelector('.lpe-veil .lpe-button').click();
      await new Promise((r) => setTimeout(r, 2500));
      const box = root.querySelector('[data-testid="expandable-text-box"]');
      const bar = root.querySelector('.action-bar');
      const frozen = [...root.querySelectorAll('*')].filter((n) => n.style && n.style.height).map((n) => n.tagName + ' ' + n.style.height);
      return { found: true, untouched: box.classList.contains('clamp3'), frozen, overlaps: box.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + 1, restored: root.dataset.lpe === 'restored' };
    })
  : null;
const keptClampOpen = SDUI
  ? await page.evaluate(() => [...document.querySelectorAll('[data-lpe="kept"]')].map((r) => Boolean(r.querySelector('.open-9f2'))))
  : null;

// Reload: every result should come from the saved results, with no new requests.
const callsBeforeReload = apiCalls;
await page.reload();
for (let i = 0; i < 40; i++) {
  const atEnd = await page.evaluate(() => {
    window.scrollBy(0, 700);
    return innerHeight + scrollY >= document.body.scrollHeight - 4;
  });
  await page.waitForTimeout(250);
  if (atEnd) break;
}
await page.waitForTimeout(800);
const callsAfterReload = apiCalls - callsBeforeReload;

// Jump stability: open the feed in a new tab and go straight to the middle, before anything
// has been read. While posts above the screen expand and fold, what's at the top of the
// screen must not move.
await worker.evaluate(async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('j:')));
});
const jumpy = await context.newPage();
await jumpy.goto('https://www.linkedin.com/feed/');
await jumpy.evaluate(() => window.scrollTo(0, 3200));
await jumpy.waitForTimeout(150);
const jumpResult = await jumpy.evaluate(async () => {
  // Track the post box under that point, not an element inside it: text loading inside a
  // post that is being read is expected, the post itself moving is a jump.
  // (The first post whose bottom is below that point, so a gap between posts can't pick the whole list.)
  const tops = [...document.querySelectorAll('[role="listitem"], [data-urn]')].filter((el) => !el.parentElement.closest('[role="listitem"], [data-urn]'));
  const anchor = tops.find((el) => el.getBoundingClientRect().bottom > 160);
  const start = anchor.getBoundingClientRect().top;
  let worst = 0;
  let last = start;
  const log = [];
  const items = () => [...document.querySelectorAll('[data-lpe]')];
  const snap = () => items().map((e, i) => `${i}:${e.dataset.lpe}@${Math.round(e.getBoundingClientRect().top)}/${Math.round(e.getBoundingClientRect().height)}`).filter((x) => !/@-?\d{5}/.test(x));
  let prev = snap();
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const top = anchor.getBoundingClientRect().top;
    worst = Math.max(worst, Math.abs(top - start));
    if (Math.abs(top - last) > 1) {
      const now = snap();
      log.push(`t=${i * 100}ms anchor ${Math.round(last)}->${Math.round(top)} scrollY ${Math.round(scrollY)} | changed: ${now.filter((x, j) => x !== prev[j]).join(' ')}`);
    }
    prev = snap();
    last = top;
  }
  return { worst: Math.round(worst), log };
});
const drift = jumpResult.worst;
if (jumpResult.log.length) console.log(jumpResult.log.join('\n'));
const jumpStates = await jumpy.evaluate(() => [...document.querySelectorAll('[data-lpe]')].map((e) => e.dataset.lpe).join(' '));
console.log(`jump test: top of screen moved at most ${drift}px; states ${jumpStates}`);
await jumpy.close();

// Popup and settings page.
const popup = await context.newPage();
await popup.setViewportSize({ width: 320, height: 240 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.waitForTimeout(300);
await popup.screenshot({ path: path.join(OUT, `06-popup${SUFFIX}.png`) });
const popupText = await popup.evaluate(() => document.body.innerText);

const options = await context.newPage();
await options.setViewportSize({ width: 900, height: 900 });
await options.goto(`chrome-extension://${extensionId}/options.html`);
await options.waitForTimeout(300);
await options.screenshot({ path: path.join(OUT, `07-options${SUFFIX}.png`), fullPage: true });

await context.close();
await rm(profile, { recursive: true, force: true });

// ---------- report ----------

const count = (s) => states.filter((x) => x.state === s).length;
console.log(states.map((s) => `${s.state.padEnd(10)} ${String(s.author).padEnd(22)} ${s.says ? `"${s.says}"  ${s.tally}` : ''}`).join('\n'));
console.log(`\n${MOCK ? 'Mock' : 'Real'} Jev: ${apiCalls} requests on first pass, ${callsAfterReload} after reload.`);
console.log(`stamped ${count('stamped')}, kept ${count('kept')}, short ${count('short')}, other ${states.length - count('stamped') - count('kept') - count('short')}`);
console.log('restore:', restored, 'stamped after re-stamp:', recollapsed);
console.log(`height added by overlays: ${resized.length ? JSON.stringify(resized) : 'none'} (${overlayHeights.length} checked)`);
console.log(`on load: ${playState.filter((p) => !p.waiting).length} played in view, ${playState.filter((p) => p.waiting).length} waiting below`);
console.log(`clipped post after Show original: ${JSON.stringify(clampCheck)}; kept clipped posts opened by us: ${keptClampOpen}`);
console.log(`load more pressed: ${loads ?? 'n/a'} times`);
console.log(`pen: font loaded ${pen.font}, strike lines per post on screen ${pen.strikes.join(',')}`);
console.log('popup:', popupText.replace(/\s+/g, ' '));

const failures = [];
if (!count('stamped')) failures.push('nothing stamped');
if (stuckWaiting.length) failures.push(`${stuckWaiting.length} overlays never played after scrolling past them: ${JSON.stringify(stuckWaiting)}`);
if (clampCheck && (!clampCheck.found || !clampCheck.untouched || clampCheck.frozen.length || clampCheck.overlaps)) failures.push(`Show original on a clipped post went wrong: ${JSON.stringify(clampCheck)}`);
if (keptClampOpen && keptClampOpen.some((open) => open)) failures.push(`"… more" was pressed on a clipped post left as written: ${keptClampOpen.join(',')}`);
if (keptOpen && keptOpen.some((open) => open)) failures.push(`"… more" was pressed on a post left as written: ${keptOpen.join(',')}`);
if (playState.some((p) => !p.inView && !p.waiting)) failures.push('a translation played before its handwriting was on screen');
if (playState.some((p) => p.inView && p.waiting)) failures.push('a translation fully on screen never played');
if (SDUI && !(loads >= 1)) failures.push('"Load more" was never pressed');
if (!pen.font) failures.push('the handwriting font did not load');
if (!pen.strikes.length || pen.strikes.some((n) => n === 0)) failures.push(`some translated posts have no strike lines: ${pen.strikes.join(',')}`);
if (resized.length) failures.push(`${resized.length} overlays changed a post's height`);
if (!overlayHeights.length) failures.push('no overlays to check');
for (const s of states) if (!s.headerVisible) failures.push(`the stamp covers ${s.author}'s name and photo`);
if (states.find((s) => s.author === 'Wren Hollis')?.state !== 'short') failures.push('short post was not skipped');
if (!SDUI && states.find((s) => s.author === 'Pieter Galloway')?.state !== 'short') failures.push('reshare commentary was not treated as its own short post');
if (states.length < withShort.length + (SDUI ? 0 : 1)) failures.push(`found ${states.length} posts, expected at least ${withShort.length + (SDUI ? 0 : 1)}`);
const dana = states.find((s) => s.author === 'Dana Whitlock');
if (!/^\d+ words cut/.test(dana?.tally || '') || dana.says.split(/\s+/).length + Number(dana.tally.split(' ')[0]) !== 87)
  failures.push(`Dana's card should count all 87 words of the post, says ${dana?.says} / ${dana?.tally}`);
if (drift > 2) failures.push(`reading position moved by ${drift}px while posts above it folded`);
for (const name of ['Yusuf Brandt', 'Colm Beaumont', 'Esme Lindahl', 'Ingrid Solberg', 'Frederik Mwangi']) {
  const s = states.find((x) => x.author === name);
  if (s && s.state !== 'kept') failures.push(`${name}'s post should have been left alone, was ${s.state}`);
}
if (!restored.stampGone || !restored.mark) failures.push('Show original did not lift the stamp');
if (recollapsed !== count('stamped')) failures.push('the corner mark did not put the stamp back');
if (callsAfterReload !== 0 && apiCalls > 0) failures.push(`reload made ${callsAfterReload} new requests`);
if (failures.length) {
  console.log('\nFAILED:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\nAll checks passed. Screenshots in test/results/.');

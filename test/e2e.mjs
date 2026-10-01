// Loads the unpacked extension into Chromium, serves the test timeline at
// https://x.com/home, scrolls through it and checks what happened.
//
//   node test/e2e.mjs                       mock Jev answers (no key needed)
//   TYPESAFE_API_KEY=... node test/e2e.mjs  real Jev
//   add --dark for the dark theme, --headed to watch

import { chromium } from 'playwright-core';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedHtml, timelineJson } from './feed.mjs';
import { normalise, mentionsAI } from '../extension/lib/text.js';

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
const SUFFIX = DARK ? '-dark' : '';
await mkdir(OUT, { recursive: true });

const posts = JSON.parse(await readFile(path.join(root, 'test', 'posts.json'), 'utf8'));
const byId = (id) => posts.find((p) => p.id === id);
// Three words are still an opinion.
const shortPost = { id: 'short', author: 'Nell Aziz', handle: 'nellaziz', bio: 'CEO of an AI lab.', expect: 'flagged', take: 'hype', stake: 'founder', text: 'AI is so back 🚀' };
// Nothing to do with AI, from someone whose other post on the page earned a note: left alone.
const aside = { id: 'aside', author: 'Dana Whitlock', handle: 'danawhitlock', bio: byId('founder-jobs').bio, link: 'lumenagents.ai', expect: 'kept', take: 'not_ai', stake: 'founder', text: 'Lunch.' };
// A baker's own remark, quoting a founder. Only the baker's words and profile count.
const quoting = {
  id: 'quoting',
  author: 'Tessa Okafor',
  handle: 'tessabakes',
  bio: 'I run a bakery in Leeds. Sourdough, mostly.',
  expect: 'kept',
  take: 'criticism',
  stake: 'unstated',
  text: 'Not sure I buy this. AI can write my menu but it has never once got up at 4am to proof dough.',
  quote: byId('founder-jobs'),
};
byId('investor-prediction').image = true;
// A repost: the reposter is named above the post, but the words and the stake are the author's.
byId('employee-hype').repostedBy = 'tessabakes';
const feedPosts = [...posts.slice(0, 3), shortPost, ...posts.slice(3), quoting, aside];
const half = Math.ceil(feedPosts.length / 2);
const html = feedHtml({ dark: DARK });

// ---------- mock Jev ----------

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

// ---------- browser ----------

const profile = await mkdtemp(path.join(os.tmpdir(), 'sw-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: !HEADED,
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: DARK ? 'dark' : 'light',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

let apiCalls = 0;
const sent = [];
await context.route('https://api.typesafe.ai/**', async (route) => {
  apiCalls++;
  const body = JSON.parse(route.request().postData());
  sent.push(body);
  if (!MOCK) return route.continue();
  await new Promise((r) => setTimeout(r, 400));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockAnswer(body)) });
});
await context.route('https://x.com/**', (route) => {
  const url = route.request().url();
  if (url.includes('/i/api/graphql/')) {
    const part = url.includes('half=1') ? feedPosts.slice(0, half) : feedPosts.slice(half);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(timelineJson(part)) });
  }
  if (url.endsWith('/home')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  return route.fulfill({ status: 204, body: '' });
});

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
await worker.evaluate(
  (apiKey) => chrome.storage.local.set({ settings: { apiKey, enabled: true, threshold: 0.6, model: 'jev-latest' } }),
  KEY || 'mock-key',
);

const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const shot = (name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}${SUFFIX}.png`), ...opts });

await page.goto('https://x.com/home');
await page.waitForSelector('article');
await shot('01-before');
await page.waitForSelector('.sw-writing', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(900);
await shot('02-after');

// Scroll the whole timeline like a reader would.
for (let i = 0; i < 40; i++) {
  const atEnd = await page.evaluate(() => {
    window.scrollBy(0, 500);
    return innerHeight + scrollY >= document.body.scrollHeight - 4;
  });
  await page.waitForTimeout(MOCK ? 350 : 900);
  if (atEnd) break;
}
await page.waitForTimeout(MOCK ? 1200 : 5000);

const read = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('article')].map((el) => ({
      handle: el.querySelector('[data-testid="User-Name"] a').getAttribute('href').slice(1),
      text: el.querySelector('[data-testid="tweetText"]').textContent,
      state: el.dataset.sw,
      notes: el.querySelectorAll('.sw-note').length,
      says: el.querySelector('.sw-says')?.textContent || null,
      why: el.querySelector('.sw-note')?.title || null,
      lines: el.querySelectorAll('.sw-note p').length,
      blank: Boolean(el.querySelector('.sw-blank')),
      // The note belongs right under the post's own text, never inside a quoted post.
      placed: el.querySelector('.sw-note') ? el.querySelector('.sw-note').previousElementSibling?.dataset.testid === 'tweetText' && !el.querySelector('.sw-note').closest('.quote') : null,
    })),
  );
const states = await read();
const pen = await page.evaluate(() => ({
  font: [...document.fonts].some((f) => f.family.includes('SW Kalam') && f.status === 'loaded'),
  build: document.documentElement.dataset.saysWho,
}));
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await shot('03-timeline-full', { fullPage: true });

// A click on a note must not open the post it sits in.
const openedBefore = await page.evaluate(() => window.__opened);
await page.locator('.sw-note').first().click();
const openedByNote = (await page.evaluate(() => window.__opened)) - openedBefore;

// X re-renders posts in place. A note that gets dropped is put back, once.
await page.evaluate(() => document.querySelector('.sw-note').remove());
await page.evaluate(() => document.querySelector('article').append(document.createElement('i')));
await page.waitForTimeout(700);
const afterRedraw = (await read()).filter((s) => s.state === 'flagged').map((s) => s.notes);

const popup = await context.newPage();
await popup.setViewportSize({ width: 320, height: 240 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.waitForTimeout(300);
await popup.screenshot({ path: path.join(OUT, `04-popup${SUFFIX}.png`) });
const popupText = await popup.evaluate(() => document.body.innerText);

const options = await context.newPage();
await options.setViewportSize({ width: 900, height: 900 });
await options.goto(`chrome-extension://${extensionId}/options.html`);
await options.waitForTimeout(300);
await options.screenshot({ path: path.join(OUT, `05-options${SUFFIX}.png`), fullPage: true });
const optionsText = await options.evaluate(() => document.body.innerText);

// Reload: every result should come from the saved results, with no new requests.
const callsBeforeReload = apiCalls;
await page.reload();
await page.waitForSelector('article');
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
const afterReload = await read();

// Pausing takes every note off the page.
await worker.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, enabled: false } });
});
await page.waitForTimeout(600);
const notesWhenPaused = await page.evaluate(() => document.querySelectorAll('.sw-note').length);

await context.close();
await rm(profile, { recursive: true, force: true });

// ---------- report ----------

const count = (s) => states.filter((x) => x.state === s).length;
console.log(states.map((s) => `${String(s.state).padEnd(9)} @${s.handle.padEnd(16)} ${s.says ? `"${s.says}"  ${s.why}` : ''}`).join('\n'));
console.log(`\n${MOCK ? 'Mock' : 'Real'} Jev: ${callsBeforeReload} requests on first pass, ${callsAfterReload} after reload.`);
console.log(`flagged ${count('flagged')}, kept ${count('kept')}, other ${states.length - count('flagged') - count('kept')}`);
console.log(`pen: font loaded ${pen.font}, build ${pen.build}`);
console.log('popup:', popupText.replace(/\s+/g, ' '));

const failures = [];
const state = (handle, from = states) => from.find((s) => s.handle === handle);
if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`);
if (states.length !== feedPosts.length) failures.push(`found ${states.length} posts, expected ${feedPosts.length}`);
for (const post of feedPosts) {
  const s = states.find((x) => x.handle === post.handle && x.text.startsWith(post.text.slice(0, 20)));
  if (!s) continue;
  // With real Jev the judgments are its own; the mock must match the expectations exactly.
  if (MOCK && s.state !== post.expect) failures.push(`@${post.handle} (${post.id}) should be ${post.expect}, was ${s.state}`);
  if (s.state === 'flagged' && (s.notes !== 1 || !s.placed)) failures.push(`@${post.handle} has ${s.notes} notes, placed under its own text: ${s.placed}`);
  if (s.state === 'flagged' && s.lines !== 1) failures.push(`@${post.handle}'s note should be one line, has ${s.lines}`);
  if (s.state === 'flagged' && /bio|Co-founder|General Partner/.test(s.says)) failures.push(`@${post.handle}'s note quotes the profile: ${s.says}`);
  if (s.state !== 'flagged' && s.notes) failures.push(`@${post.handle} was ${s.state} but has a note`);
  if (s.blank) failures.push(`@${post.handle}'s note was scrolled past but never written`);
}
if (!count('flagged')) failures.push('nothing flagged');
if (MOCK) {
  const want = {
    danawhitlock: ['Says someone whose company sells it.', 'Their bio: “Co-founder & CEO @lumenagents. AI agents that write your code. Prev eng at Halcyon.”'],
    marcusoye: ['Says someone whose paycheck comes from Northwind AI.', 'Badge on their profile: Northwind AI'],
    hbrisk: ['Says someone whose money is riding on it.', null],
    pietergalloway: ['Says someone with AI to sell you.', null],
    kasperlind: ['Says the person selling AGENTIC TESTING.', null],
    nellaziz: ['Says someone whose company sells it.', null],
    niallfarrow: ['Says someone whose company sells it.', 'They say so in this post.'],
    novalabs_hq: ['Says someone who makes money from AI.', 'Not on their profile. Jev recognises this account.'],
  };
  for (const [handle, [says, why]] of Object.entries(want)) {
    const s = states.find((x) => x.handle === handle && x.says);
    if (s?.says !== says || (why && !s?.why?.startsWith(why))) failures.push(`@${handle} should say "${says}"${why ? ` / "${why}"` : ''}, says "${s?.says}" / "${s?.why}"`);
  }
}
// A post is sent only if it or its author's profile mentions AI and it is long enough.
const sendable = feedPosts.filter((p) => p.viaMemory || mentionsAI(p.text) || mentionsAI(`${p.author}\n${p.handle}\n${p.bio}\n${p.label}\n${p.link}`));
const posted = sent.filter((b) => b.questions.take);
const whoAsked = sent.filter((b) => b.questions.known).map((b) => b.state.author_handle);
if (MOCK && posted.length !== sendable.length) failures.push(`${posted.length} posts sent on first pass, expected ${sendable.length}`);
// Who an account is gets asked only for posts talking AI up that neither the profile nor the post explains.
if (MOCK && whoAsked.sort().join() !== '@jo_84213,@novalabs_hq') failures.push(`asked who these accounts are: ${whoAsked.join(', ')}`);
if (sent.some((b) => b.questions.known && (b.state.post || b.state.author_bio))) failures.push('the question about who an account is carried a post or a bio');
const dana = posted.find((b) => b.state.author_name === 'Dana Whitlock');
if (!dana || !dana.state.author_bio.startsWith('Co-founder') || dana.state.author_link !== 'lumenagents.ai') failures.push(`Dana's profile was not sent as read: ${JSON.stringify(dana?.state)}`);
const marcus = posted.find((b) => b.state.post.startsWith('People really'));
if (marcus?.state.author_handle !== '@marcusoye') failures.push(`a repost was pinned on ${marcus?.state.author_handle}, not its author`);
const tessa = posted.find((b) => b.state.author_name === 'Tessa Okafor');
if (!tessa || !tessa.state.post.startsWith('Not sure I buy this') || tessa.state.post.includes('Software engineering')) failures.push(`the quoting post was not read as its own: ${JSON.stringify(tessa?.state)}`);
// (With real Jev the invented account isn't recognised, so nothing establishes it.)
if (MOCK && !posted.some((b) => /coding camps/.test(b.state.post))) failures.push('a later post by an author already found to be paid by AI was not sent');
if (posted.some((b) => /hospital paperwork/.test(b.state.post))) failures.push('a post was sent although neither it nor its author mentions AI');
if (!pen.font) failures.push('the handwriting font did not load');
if (openedByNote) failures.push('clicking a note opened the post');
if (afterRedraw.some((n) => n !== 1)) failures.push(`after a redraw, flagged posts have ${afterRedraw.join(',')} notes`);
if (callsAfterReload !== 0) failures.push(`reload made ${callsAfterReload} new requests`);
if (afterReload.filter((s) => s.state === 'flagged').length !== count('flagged')) failures.push('reload did not bring back the same notes');
if (notesWhenPaused) failures.push(`${notesWhenPaused} notes left on the page after pausing`);
if (!new RegExp(`${count('flagged')} posts? marked`).test(popupText)) failures.push(`popup total is wrong: ${popupText.replace(/\s+/g, ' ')}`);
if (!/Says Who/.test(optionsText) || !/Says Who/.test(popupText)) failures.push('the settings page or the popup does not carry the extension name');
if (failures.length) {
  console.log('\nFAILED:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\nAll checks passed. Screenshots in test/results/.');

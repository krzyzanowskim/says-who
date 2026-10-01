// Service worker. It is the only part of the extension that sees the API key or talks
// to TypeSafe. Content scripts send a post and its author's profile here and get back a
// finished result.

import { askJev, JevError } from './lib/jev.js';
import { buildRequest, buildKnownRequest } from './lib/questions.js';
import { judge, paidAuthor, RULES } from './lib/verdict.js';
import { normalise, sha256, mentionsAI } from './lib/text.js';

const DEFAULT_SETTINGS = {
  apiKey: '',
  enabled: true,
  threshold: RULES.threshold,
  model: 'jev-latest',
};
const MAX_SAVED = 3000;
const MAX_ACTIVE = 4;

// ---------- storage ----------

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

async function getStats() {
  const { stats } = await chrome.storage.local.get('stats');
  return { flagged: 0, cleared: 0, ...stats };
}

async function getKeyState() {
  const { keyState } = await chrome.storage.local.get('keyState');
  return keyState || null;
}

async function setKeyState(next) {
  const current = await getKeyState();
  if (current && current.ok === next.ok && current.status === next.status) return;
  await chrome.storage.local.set({ keyState: { ...next, at: Date.now() } });
  await refreshBadge();
}

// Saved judgments keep Jev's raw answers, rounded, so later threshold or wording
// changes apply without asking again. Posts and profiles themselves are never stored.
function compact(answers) {
  const out = {};
  for (const [id, a] of Object.entries(answers || {})) {
    if (a.type === 'noul') out[id] = { type: 'noul', noul: round(a.noul) };
    else {
      out[id] = {
        type: a.type,
        choice: a.choice,
        confidence: round(a.confidence),
        probabilities: Object.fromEntries(
          Object.entries(a.probabilities || {}).filter(([, p]) => p >= 0.001).map(([k, p]) => [k, round(p)]),
        ),
      };
    }
  }
  return out;
}
const round = (n) => Math.round(n * 1000) / 1000;

// Saved answers: `j:` about a post and its author, `k:` about an account alone, and `a:`
// for an author already found to be paid by AI.
const isSaved = (key) => /^[jka]:/.test(key);

// People paid by AI mostly post about AI without naming it ("SaaS is dead", "big week
// ahead"). Once an author is established, their later posts are judged whatever words
// they use. Nothing but the handle and a date is kept, and it lapses after a month.
const AUTHOR_DAYS = 30;
const authorKey = (handle) => `a:${handle.toLowerCase()}`;

async function isPaidAuthor(handle) {
  if (!handle) return false;
  const key = authorKey(handle);
  const entry = (await chrome.storage.local.get(key))[key];
  return Boolean(entry) && Date.now() - entry.at < AUTHOR_DAYS * 86400000;
}

// Returns true the first time, so the page can send this author's other posts again.
async function rememberAuthor(handle) {
  if (!handle || (await isPaidAuthor(handle))) return false;
  await chrome.storage.local.set({ [authorKey(handle)]: { at: Date.now() } });
  return true;
}

let writesSincePrune = 0;
async function saveJudgment(key, response) {
  const entry = { answers: compact(response.answers), model: response.model, at: Date.now() };
  await chrome.storage.local.set({ [key]: entry });
  if (++writesSincePrune >= 50) {
    writesSincePrune = 0;
    prune().catch(() => {});
  }
  return entry;
}

async function prune() {
  const all = await chrome.storage.local.get(null);
  const saved = Object.entries(all).filter(([k]) => isSaved(k));
  if (saved.length <= MAX_SAVED) return;
  saved.sort((a, b) => a[1].at - b[1].at);
  await chrome.storage.local.remove(saved.slice(0, saved.length - MAX_SAVED).map(([k]) => k));
}

async function savedCount() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith('j:')).length;
}

async function clearSaved() {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(isSaved));
  await chrome.storage.local.set({ stats: { flagged: 0, cleared: 0 } });
}

// ---------- request queue ----------

let active = 0;
const waiting = [];
const inFlight = new Map();

function schedule(task) {
  return new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  while (active < MAX_ACTIVE && waiting.length) {
    const { task, resolve, reject } = waiting.shift();
    active++;
    task()
      .then(resolve, reject)
      .finally(() => {
        active--;
        pump();
      });
  }
}

function once(key, work) {
  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      work().finally(() => inFlight.delete(key)),
    );
  }
  return inFlight.get(key);
}

// ---------- classification ----------

async function classify({ text, author = {} }) {
  const settings = await getSettings();
  if (!settings.enabled) return { status: 'off' };
  if (!settings.apiKey) return { status: 'error', reason: 'no-key' };

  const clean = normalise(text);
  const profile = {
    name: normalise(author.name).slice(0, 100),
    handle: normalise(author.handle).slice(0, 20),
    bio: normalise(author.bio).slice(0, 600),
    label: normalise(author.label).slice(0, 100),
    link: normalise(author.link).slice(0, 200),
    category: normalise(author.category).slice(0, 100),
  };
  // People paid by AI often argue about "the models" or "agents" without ever writing
  // "AI", so a profile that mentions it is reason enough to ask.
  const signs = mentionsAI(clean) || mentionsAI(`${profile.name}\n${profile.handle}\n${profile.bio}\n${profile.label}\n${profile.link}\n${profile.category}`);
  if (!signs && !(await isPaidAuthor(profile.handle))) return { status: 'unchanged', reason: 'not-ai' };
  const body = buildRequest({ text: clean, author: profile, model: settings.model });
  const key = `j:${(await sha256(body)).slice(0, 40)}`;

  let entry = (await chrome.storage.local.get(key))[key];
  if (!entry) {
    const keyState = await getKeyState();
    if (keyState && keyState.status === 401) return { status: 'error', reason: 'bad-key' };
    try {
      entry = await once(key, () =>
        schedule(() => askJev(settings.apiKey, body)).then((response) => saveJudgment(key, response)),
      );
      await setKeyState({ ok: true, status: 200 });
    } catch (err) {
      const status = err instanceof JevError ? err.status : 0;
      if (status === 401 || status === 403) await setKeyState({ ok: false, status: 401, message: err.message });
      return { status: 'error', reason: status === 401 || status === 403 ? 'bad-key' : 'busy', message: err.message };
    }
  }

  let result = judge(entry.answers, { threshold: settings.threshold });
  if (result.askKnown && profile.handle) {
    const known = await whoIs(settings, profile);
    if (known) result = judge({ ...entry.answers, known }, { threshold: settings.threshold });
  }
  await tally(key, entry, result);
  const settled = result.status === 'flagged' ? result.source !== 'post' : paidAuthor(entry.answers, { threshold: settings.threshold });
  const remembered = settled && (await rememberAuthor(profile.handle));
  return { ...result, model: entry.model, ...(remembered ? { remembered: true } : {}) };
}

// What Jev knows about an account, asked once per account and saved. A failure here just
// means the post is left alone.
async function whoIs(settings, { handle, name }) {
  const body = buildKnownRequest({ handle, name, model: settings.model });
  const key = `k:${(await sha256(body)).slice(0, 40)}`;
  let entry = (await chrome.storage.local.get(key))[key];
  if (!entry) {
    try {
      entry = await once(key, () => schedule(() => askJev(settings.apiKey, body)).then((response) => saveJudgment(key, response)));
    } catch {
      return null;
    }
  }
  return entry.answers.known || null;
}

// Each distinct post counts once towards the totals in the popup. Updates run one at a
// time, since several posts finish together and would otherwise overwrite each other.
let tallyChain = Promise.resolve();
function tally(key, entry, result) {
  if (entry.counted) return tallyChain;
  entry.counted = result.status;
  tallyChain = tallyChain
    .then(async () => {
      const stats = await getStats();
      if (result.status === 'flagged') stats.flagged += 1;
      else stats.cleared += 1;
      await chrome.storage.local.set({ [key]: entry, stats });
    })
    .catch(() => {});
  return tallyChain;
}

async function testKey(apiKey) {
  const started = Date.now();
  try {
    const response = await askJev(
      apiKey,
      {
        model: (await getSettings()).model,
        state: { post: 'AI will write all the code within a year.' },
        questions: { check: { type: 'noul', instructions: 'Is `post` a prediction about AI?' } },
      },
      { retries: 1 },
    );
    await setKeyState({ ok: true, status: 200 });
    return { ok: true, ms: Date.now() - started, model: response.model };
  } catch (err) {
    const status = err instanceof JevError ? err.status : 0;
    if (status === 401 || status === 403) await setKeyState({ ok: false, status: 401, message: err.message });
    return { ok: false, status, message: err.message };
  }
}

// ---------- badge ----------

async function refreshBadge() {
  const settings = await getSettings();
  const keyState = await getKeyState();
  const needsKey = !settings.apiKey || (keyState && keyState.status === 401);
  await chrome.action.setBadgeBackgroundColor({ color: '#B8321F' });
  await chrome.action.setBadgeText({ text: needsKey ? '!' : settings.enabled ? '' : 'off' });
  await chrome.action.setTitle({
    title: needsKey ? 'Says Who: add your TypeSafe key' : settings.enabled ? 'Says Who' : 'Says Who (paused)',
  });
}

// ---------- font ----------

// Kalam for the handwriting, handed to content scripts as bytes so it never has to be a
// web-accessible file (which a page could probe for).
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
const FONT_FILES = [
  { file: 'kalam-400-latin.woff2', weight: '400', range: LATIN },
  { file: 'kalam-400-latin-ext.woff2', weight: '400', range: LATIN_EXT },
  { file: 'kalam-700-latin.woff2', weight: '700', range: LATIN },
  { file: 'kalam-700-latin-ext.woff2', weight: '700', range: LATIN_EXT },
];
let fontCache = null;

async function fonts() {
  if (!fontCache) {
    fontCache = await Promise.all(
      FONT_FILES.map(async ({ file, weight, range }) => {
        const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL(`fonts/${file}`))).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { weight, range, data: btoa(binary) };
      }),
    );
  }
  return fontCache;
}

// ---------- messages ----------

const handlers = {
  classify,
  fonts,
  async contentSettings() {
    const { enabled, apiKey } = await getSettings();
    return { enabled, hasKey: Boolean(apiKey) };
  },
  async status() {
    const settings = await getSettings();
    return {
      hasKey: Boolean(settings.apiKey),
      keyHint: settings.apiKey ? settings.apiKey.slice(-4) : '',
      enabled: settings.enabled,
      threshold: settings.threshold,
      keyState: await getKeyState(),
      stats: await getStats(),
      saved: await savedCount(),
    };
  },
  async saveKey({ apiKey }) {
    const trimmed = (apiKey || '').trim();
    await updateSettings({ apiKey: trimmed });
    await chrome.storage.local.remove('keyState');
    await refreshBadge();
    if (!trimmed) return { ok: false, message: 'Key removed.' };
    return testKey(trimmed);
  },
  async testKey() {
    const { apiKey } = await getSettings();
    return testKey(apiKey);
  },
  async setSettings({ patch }) {
    const allowed = {};
    if (typeof patch.enabled === 'boolean') allowed.enabled = patch.enabled;
    if (Number.isFinite(patch.threshold)) allowed.threshold = Math.min(0.95, Math.max(0.2, patch.threshold));
    await updateSettings(allowed);
    await refreshBadge();
    return handlers.status();
  },
  async clearSaved() {
    await clearSaved();
    return handlers.status();
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  // Content scripts may only classify and read their settings. The popup and the
  // settings page are extension pages, so their URL starts with our own origin.
  const fromExtensionPage = sender.id === chrome.runtime.id && (sender.url || '').startsWith(chrome.runtime.getURL(''));
  if (!fromExtensionPage && !['classify', 'contentSettings', 'fonts'].includes(message.type)) return false;
  handler(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ status: 'error', reason: 'internal', message: String(err?.message || err) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await refreshBadge();
  if (reason === 'install' && !(await getSettings()).apiKey) chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(refreshBadge);

// Service worker. It is the only part of the extension that sees the API key or talks
// to TypeSafe. Content scripts send post text here and get back a finished result.

import { askJev, JevError } from './lib/jev.js';
import { buildRequest } from './lib/questions.js';
import { translate, measure, RULES } from './lib/translate.js';
import { normalise, sha256 } from './lib/text.js';

const DEFAULT_SETTINGS = {
  apiKey: '',
  enabled: true,
  threshold: RULES.threshold,
  minWords: 30,
  // Press LinkedIn's "Load more" automatically near the end of the feed.
  autoLoad: true,
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
  return { posts: 0, wordsCut: 0, leftAlone: 0, ...stats };
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
// changes apply without asking again. Post text itself is never stored.
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
  const saved = Object.entries(all).filter(([k]) => k.startsWith('j:'));
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
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('j:')));
  await chrome.storage.local.set({ stats: { posts: 0, wordsCut: 0, leftAlone: 0 } });
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

async function classify({ text, mentionedOrgs = [], mentionedPeople = [], sponsored = false }) {
  const settings = await getSettings();
  if (!settings.enabled) return { status: 'off' };
  if (!settings.apiKey) return { status: 'error', reason: 'no-key' };

  const clean = normalise(text);
  const body = buildRequest({ text: clean, mentionedOrgs, mentionedPeople, model: settings.model });
  const key = `j:${(await sha256(body)).slice(0, 40)}`;
  // Picks between a kind's wordings. Same post, same wording, every time.
  const seed = parseInt((await sha256(clean)).slice(0, 8), 16);

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

  let result = translate(entry.answers, { threshold: settings.threshold, seed, sponsored: Boolean(sponsored) });
  if (result.status === 'translated') {
    const words = measure(clean, result.sentence);
    // Only worth covering a post if the translation cuts most of it.
    result =
      words.percent >= 50 && words.removed >= 12
        ? { ...result, ...words }
        : { ...result, status: 'unchanged', reason: 'not-much-shorter' };
  }
  await tally(key, entry, result);
  return { ...result, model: entry.model };
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
      if (result.status === 'translated') {
        stats.posts += 1;
        stats.wordsCut += result.removed;
      } else {
        stats.leftAlone += 1;
      }
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
        state: { post: 'Thrilled to share that I have started a new position as Head of Growth at Northwind!' },
        questions: { check: { type: 'noul', instructions: 'Is the author of `post` starting a new job?' } },
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
    title: needsKey ? 'LinkedIn Plain English: add your TypeSafe key' : settings.enabled ? 'LinkedIn Plain English' : 'LinkedIn Plain English (paused)',
  });
}

// ---------- font ----------

// Kalam for the handwriting, handed to content scripts as bytes so it never has to be a
// web-accessible file (which LinkedIn's extension probing could detect).
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
    const { enabled, minWords, autoLoad, apiKey } = await getSettings();
    return { enabled, minWords, autoLoad, hasKey: Boolean(apiKey) };
  },
  async status() {
    const settings = await getSettings();
    return {
      hasKey: Boolean(settings.apiKey),
      keyHint: settings.apiKey ? settings.apiKey.slice(-4) : '',
      enabled: settings.enabled,
      threshold: settings.threshold,
      minWords: settings.minWords,
      autoLoad: settings.autoLoad,
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
    if (typeof patch.autoLoad === 'boolean') allowed.autoLoad = patch.autoLoad;
    if (Number.isFinite(patch.threshold)) allowed.threshold = Math.min(0.95, Math.max(0.2, patch.threshold));
    if (Number.isFinite(patch.minWords)) allowed.minWords = Math.min(500, Math.max(5, Math.round(patch.minWords)));
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

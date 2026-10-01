// Runs on x.com. Finds posts as they scroll near the viewport, pairs each with its
// author's public profile, and asks the background worker whether this is someone paid by
// AI talking AI up. If so, it writes one line under the post, in red pen, saying what
// they gain from it. The post itself is never hidden or changed. The script never sees the API key
// and never marks a post Jev wasn't sure about.

(() => {
  if (window.__saysWho) return;
  window.__saysWho = true;
  // Lets a person (or a test) check which build is running on the page.
  document.documentElement.dataset.saysWho = chrome.runtime.getManifest().version;

  // X changes its markup often, and serves two builds of the site: the long-standing one
  // marked up with test ids, and a newer one with none. Everything the script relies on
  // is listed here, newest last, so a breakage is a one-line fix.
  const SELECTORS = {
    post: 'article',
    // Tried in order: the older build names the text, the newer one only marks its direction.
    text: ['[data-testid="tweetText"]', 'div[dir="auto"]'],
    // The timestamp links to the post itself, /handle/status/id, under its author's handle.
    permalink: 'a[href*="/status/"]',
    // A quoted post is a link-shaped box (and, in the newer build, another article)
    // inside the post that quotes it.
    quote: '[role="link"]',
    // The small logo after a name: the organisation X says the account belongs to.
    badge: 'a[aria-label][href^="/"]',
    // On a profile page, the bio and the name block above it.
    bio: '[data-testid="UserDescription"]',
    profileName: '[data-testid="UserName"]',
  };

  const TAG = 'says-who';
  const OURS = '.sw-note';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let settings = { enabled: true, hasKey: false };
  let alive = true;
  // How long a post waits for its author's profile before being judged without it.
  const PROFILE_WAIT = 3000;

  // Per post element: { key, text, handle, name, profile, state, result, retryAt }
  const posts = new WeakMap();
  // Public profiles by lower-case handle: { handle, name, bio, link, label, category, stamp }
  const profiles = new Map();
  // Notes already written once. X unmounts posts as they scroll away; when one comes
  // back its note is simply there, without the pen writing it again.
  const writtenKeys = new Set();

  // ---------- messaging ----------

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      // The extension was reloaded or removed; this copy of the script is orphaned.
      alive = false;
      return null;
    }
  }

  // ---------- reading posts ----------

  function readText(node) {
    let out = '';
    const walk = (el) => {
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue;
        else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.matches(OURS)) continue;
          if (child.tagName === 'BR') out += '\n';
          // X draws emoji as images with the character in their alt text.
          else if (child.tagName === 'IMG') out += child.alt || '';
          else {
            const block = /^(P|DIV|LI|UL|OL|H\d)$/.test(child.tagName);
            if (block) out += '\n';
            walk(child);
            if (block) out += '\n';
          }
        }
      }
    };
    walk(node);
    return out
      .replace(/[ \t ]+/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Cheap fingerprint to notice when X reuses an element for a different post.
  function fingerprint(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36) + text.length.toString(36);
  }

  // Text and names inside a quoted post belong to that post, not to the one quoting it.
  function own(el, root) {
    if (el.closest(SELECTORS.post) !== root) return false;
    // From the parent up: links are link-shaped themselves.
    const quote = el.parentElement?.closest(SELECTORS.quote);
    return !quote || !root.contains(quote);
  }

  const topPosts = () => [...document.querySelectorAll(SELECTORS.post)].filter((el) => !el.parentElement?.closest(SELECTORS.post));

  function readPost(root) {
    let textEl = null;
    for (const selector of SELECTORS.text) {
      textEl = [...root.querySelectorAll(selector)].find((el) => own(el, root));
      if (textEl) break;
    }
    if (!textEl) return null;
    const text = readText(textEl);
    const outside = (a) => own(a, root) && !textEl.contains(a);
    // A repost names the reposter first, and a reply names who it answers, so the author
    // is taken from the post's own address rather than from the first profile link.
    const handle = [...root.querySelectorAll(SELECTORS.permalink)]
      .filter(outside)
      .map((a) => /^\/(\w{1,15})\/status\/\d+/.exec(a.getAttribute('href'))?.[1])
      .find(Boolean);
    if (!text || !handle) return null;
    const href = `/${handle}`;
    // The photo, the name and the @handle all link to /handle.
    const links = [...root.querySelectorAll('a[href]')].filter((a) => outside(a) && a.getAttribute('href').toLowerCase() === href.toLowerCase());
    const name = links.map((a) => readText(a).split('\n')[0]).find((t) => t && !t.startsWith('@'));
    const badge = [...root.querySelectorAll(SELECTORS.badge)].find((a) => outside(a) && a.getAttribute('href').toLowerCase() !== href.toLowerCase() && !a.getAttribute('href').includes('/status/') && a.querySelector('img'));
    return { textEl, text, handle, name: name || '', label: badge?.getAttribute('aria-label') || '' };
  }

  // ---------- profiles ----------

  function learn(list) {
    let changed = false;
    for (const p of list || []) {
      if (!p || typeof p.handle !== 'string') continue;
      const profile = {
        handle: p.handle,
        name: String(p.name || ''),
        bio: String(p.bio || ''),
        link: String(p.link || ''),
        label: String(p.label || ''),
        category: String(p.category || ''),
      };
      profile.stamp = fingerprint(`${profile.bio}\n${profile.label}\n${profile.link}\n${profile.category}`);
      const key = profile.handle.toLowerCase();
      if (profiles.get(key)?.stamp === profile.stamp) continue;
      profiles.set(key, profile);
      changed = true;
    }
    if (changed) scheduleScan();
  }

  // page.js passes on the profiles X itself loads with each post.
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== TAG || event.data.type !== 'profiles') return;
    learn(event.data.profiles);
  });

  // A profile page shows the bio in plain sight, which covers the rare author page.js missed.
  function readProfilePage() {
    const bio = document.querySelector(SELECTORS.bio);
    const handle = /@(\w{1,15})/.exec(document.querySelector(SELECTORS.profileName)?.textContent || '')?.[1];
    if (bio && handle && !profiles.has(handle.toLowerCase())) learn([{ handle, bio: readText(bio) }]);
  }

  // What the note rests on. Kept out of the note itself and shown on hover, so the reader can check.
  function evidence(profile, result) {
    if (result.source === 'post') return 'They say so in this post.';
    if (result.source === 'known') return 'Not on their profile. Jev recognises this account.';
    const clip = (text) => (text.length > 150 ? `${text.slice(0, 147).trimEnd()}…` : text);
    const bio = profile.bio.replace(/\s+/g, ' ').trim();
    if (result.org && result.org === profile.label) return `Badge on their profile: ${profile.label}`;
    if (bio) return `Their bio: “${clip(bio)}”`;
    if (profile.label) return `Badge on their profile: ${profile.label}`;
    if (profile.category) return `Their profile lists them as: ${profile.category}`;
    if (profile.link) return `Link on their profile: ${profile.link}`;
    return `Their name: ${profile.name || `@${profile.handle}`}`;
  }

  // ---------- finding posts ----------

  function scan() {
    if (!alive || !settings.enabled) return;
    readProfilePage();
    // Ask page.js for the authors of whatever is on the page now. Anything new comes back
    // as a message and starts another scan.
    window.postMessage({ source: TAG, type: 'look' }, location.origin);
    for (const root of topPosts()) {
      const found = readPost(root);
      if (!found) continue;
      const profile = profiles.get(found.handle.toLowerCase());
      // A badge drawn on the post itself counts when the profile doesn't carry one.
      const label = profile?.label || found.label;
      const key = fingerprint(`${found.handle}\n${profile?.stamp || ''}\n${label}\n${found.text}`);
      const info = posts.get(root);
      if (info && info.key === key) {
        // X sometimes re-renders a post in place and drops what we added.
        if (info.state === 'flagged') ensureNote(root, info);
        // The profile never came. The post and the name are judged on their own.
        if (info.state === 'unknown' && Date.now() >= info.patience) {
          info.state = 'waiting';
          root.dataset.sw = 'waiting';
          nearObserver.observe(root);
        }
        continue;
      }
      if (info) undo(root, info);

      // The profile usually arrives with the post. If it hasn't, it is given a moment, so
      // the post isn't sent once without it and again with it.
      const state = profile ? 'waiting' : 'unknown';

      const seen = { handle: found.handle, name: '', bio: '', link: '', category: '', ...profile, label };
      const next = { key, text: found.text, handle: found.handle, name: found.name, profile: seen, state, result: null, retryAt: 0, patience: Date.now() + PROFILE_WAIT };
      posts.set(root, next);
      root.dataset.sw = state;
      if (state === 'waiting') nearObserver.observe(root);
      if (state === 'unknown') setTimeout(scheduleScan, PROFILE_WAIT + 50);
    }
  }

  // ---------- classification ----------

  // Starts work well before a post scrolls into view (about three screens ahead), so the
  // note is in place, and the post is its final height, before the reader gets there.
  const nearObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) classify(entry.target);
    },
    { rootMargin: '2400px 0px 2400px 0px' },
  );

  let active = 0;
  const queue = [];

  function classify(root) {
    const info = posts.get(root);
    if (!info || info.state !== 'waiting' || Date.now() < info.retryAt) return;
    info.state = 'asking';
    root.dataset.sw = 'asking';
    queue.push(root);
    drain();
  }

  function drain() {
    while (active < 4 && queue.length) {
      const root = queue.shift();
      const info = posts.get(root);
      if (!info || info.state !== 'asking') continue;
      active++;
      const key = info.key;
      const { name, bio, label, link, category } = info.profile;
      send({ type: 'classify', text: info.text, author: { name: name || info.name, handle: info.handle, bio, label, link, category } })
        .then((result) => handle(root, key, result))
        .finally(() => {
          active--;
          drain();
        });
    }
  }

  function handle(root, key, result) {
    const info = posts.get(root);
    if (!info || info.key !== key || !result) return;
    info.result = result;
    // This author has just been established as paid by AI. Their other posts on the page
    // that were skipped for not mentioning AI are worth sending after all.
    if (result.remembered) {
      for (const other of topPosts()) {
        const o = posts.get(other);
        if (o && o !== info && o.handle.toLowerCase() === info.handle.toLowerCase() && o.state === 'kept' && o.result?.reason === 'not-ai') undo(other, o);
      }
      scheduleScan();
    }

    if (result.status === 'flagged') {
      info.state = 'flagged';
      root.dataset.sw = 'flagged';
      nearObserver.unobserve(root);
      addNote(root, info);
      return;
    }
    if (result.status === 'error' && result.reason === 'busy') {
      // Try again the next time the post comes near the viewport.
      info.state = 'waiting';
      info.retryAt = Date.now() + 20000;
      root.dataset.sw = 'waiting';
      nearObserver.unobserve(root);
      setTimeout(() => nearObserver.observe(root), 20000);
      return;
    }
    // Not about AI, not an opinion, no stake, unsure, no key, paused: nothing is added.
    info.state = result.status === 'unchanged' ? 'kept' : 'skipped';
    root.dataset.sw = info.state;
    nearObserver.unobserve(root);
  }

  // ---------- the note ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function isDark(root) {
    let node = root;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const [r, g, b, a = 1] = m[1].split(',').map(Number);
        if (a > 0.5) return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
      }
      node = node.parentElement;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function seedOf(key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // The pen writes when the note first comes on screen, so the reader sees it happen.
  // Until then the note is in place but blank, so nothing moves when it does.
  const writeObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        writeObserver.unobserve(entry.target);
        entry.target.classList.replace('sw-blank', 'sw-writing');
      }
    },
    { threshold: 0.6 },
  );

  function buildNote(root, info) {
    const { result, profile } = info;
    const note = el('div', 'sw-note');
    note.dataset.tone = isDark(root) ? 'dark' : 'light';
    note.setAttribute('role', 'note');
    note.setAttribute('aria-label', 'This author’s stake in AI');
    // Written at a slightly different angle on every post, the way a hand does.
    const tilt = -2.4 + ((seedOf(info.key) % 1000) / 1000) * 1.8;
    note.style.setProperty('--sw-tilt', `${tilt.toFixed(2)}deg`);
    // One line. What it rests on is there on hover for anyone who wants to check.
    note.title = `${evidence(profile, result)}\nJev was ${Math.round(result.confidence * 100)}% sure.`;
    note.append(el('p', 'sw-says', result.sentence));
    // A click on a post opens it. A click on the note shouldn't.
    note.addEventListener('click', (event) => event.stopPropagation());
    return note;
  }

  // The handwriting face arrives as bytes from the background worker and is registered
  // in memory, so no extension file is ever exposed to the page.
  let fontsLoading = null;
  function loadFonts() {
    if (!fontsLoading) {
      fontsLoading = send({ type: 'fonts' }).then(async (files) => {
        for (const { weight, range, data } of files || []) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          const face = new FontFace('SW Kalam', bytes, { weight, unicodeRange: range, display: 'swap' });
          document.fonts.add(await face.load());
        }
      }).catch(() => {});
    }
    return fontsLoading;
  }

  function addNote(root, info) {
    const textEl = readPost(root)?.textEl;
    if (!textEl) return;
    loadFonts();
    root.querySelectorAll(OURS).forEach((n) => n.remove());
    const note = buildNote(root, info);
    const quiet = writtenKeys.has(info.key) || reduceMotion.matches;
    writtenKeys.add(info.key);
    if (!quiet) note.classList.add('sw-blank');
    // Under the post's text, above any picture, quote or the reply and like buttons.
    textEl.after(note);
    if (!quiet) writeObserver.observe(note);
  }

  function ensureNote(root, info) {
    if (!root.querySelector(OURS)) addNote(root, info);
  }

  function undo(root, info) {
    nearObserver.unobserve(root);
    root.querySelectorAll(OURS).forEach((n) => n.remove());
    delete root.dataset.sw;
    posts.delete(root);
    if (info) info.state = 'gone';
  }

  function undoAll() {
    for (const root of topPosts()) undo(root, posts.get(root));
    document.querySelectorAll(OURS).forEach((n) => n.remove());
  }

  // ---------- wiring ----------

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
    }, 250);
  }

  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      // Ignore our own notes going in and out.
      const ours = [...record.addedNodes, ...record.removedNodes].every((n) => n.nodeType === 1 && n.matches?.(OURS));
      if (!ours) return scheduleScan();
    }
  });

  async function loadSettings({ retry = false } = {}) {
    const next = await send({ type: 'contentSettings' });
    if (!next) return;
    const wasEnabled = settings.enabled;
    settings = next;
    if (!settings.enabled) return undoAll();
    if (!wasEnabled) undoAll();
    // Posts skipped for a missing or rejected key get another go once the key changes.
    if (retry) {
      for (const root of topPosts()) {
        const info = posts.get(root);
        if (info && info.state === 'skipped') undo(root, info);
      }
    }
    scan();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.keyState || (changes.settings && changes.settings.oldValue?.apiKey !== changes.settings.newValue?.apiKey)) {
      loadSettings({ retry: true });
    } else if (changes.settings) {
      // A new threshold changes which saved answers earn a note, so every post is asked again.
      if (changes.settings.oldValue?.threshold !== changes.settings.newValue?.threshold) undoAll();
      loadSettings();
    }
  });

  // The popup asks what happened on this page, so an X redesign shows up as
  // "no posts found" or "no bios" instead of silence.
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'pageStats') return false;
    const counts = {};
    let found = 0;
    for (const root of topPosts()) {
      found++;
      const state = posts.get(root)?.state || 'new';
      counts[state] = (counts[state] || 0) + 1;
    }
    reply({ found, counts, profiles: profiles.size, enabled: settings.enabled, hasKey: settings.hasKey });
    return false;
  });

  mutations.observe(document.body, { childList: true, subtree: true });
  // page.js started before this script. Ask it for the profiles it has already seen.
  window.postMessage({ source: TAG, type: 'hello' }, location.origin);
  loadSettings();
})();

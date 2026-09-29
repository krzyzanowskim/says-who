// Runs on linkedin.com. Finds posts as they scroll near the viewport, asks the
// background worker for a translation, and writes it over the post in red pen, striking
// through the original. A translated post keeps its exact size and its header (photo, name, headline), so the
// page never moves. The script never sees the API key and never touches a post Jev
// wasn't sure about.

(() => {
  if (window.__inOtherWords) return;
  window.__inOtherWords = true;
  // Lets a person (or a test) check which build is running on the page.
  document.documentElement.dataset.inOtherWords = chrome.runtime.getManifest().version;

  // LinkedIn changes its markup often. Everything the script relies on is listed here,
  // most specific first, so a breakage is a one-line fix.
  const SELECTORS = {
    post: [
      'div.feed-shared-update-v2[data-urn]',
      'div[data-urn^="urn:li:activity:"]',
      'div[data-urn^="urn:li:ugcPost:"]',
      'div[data-urn^="urn:li:share:"]',
      '[data-view-name="feed-full-update"]',
    ].join(','),
    text: [
      '.update-components-update-v2__commentary',
      '.feed-shared-update-v2__commentary',
      '.feed-shared-inline-show-more-text .update-components-text',
      '.update-components-text',
      '.feed-shared-text',
      '[data-view-name="feed-commentary"]',
      '[data-testid="expandable-text-box"]',
    ].join(','),
    // Screen-reader duplicates that would otherwise double words like "hashtag#ai".
    skip: '.visually-hidden, .a11y-text, .sr-only, button, [role="button"]',
    orgLink: 'a[href*="/company/"], a[href*="/school/"], a[href*="/showcase/"]',
    personLink: 'a[href*="/in/"]',
    // LinkedIn's newer feed has hashed class names, so it is found by test ids and roles:
    // each post is a list item in the main feed, and long text hides behind "… more".
    feedItem: '[role="listitem"]',
    textBox: '[data-testid="expandable-text-box"]',
    moreButton: 'button[data-testid="expandable-text-button"]',
    // The Like / Comment / Repost / Send row. The stamp stops above it.
    actionLabel: /^(like|react|comment|repost|send|share)\b/i,
  };

  const OURS = '.iow-veil, .iow-mark, .iow-defs';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let settings = { enabled: true, minWords: 30, autoLoad: true, hasKey: false };
  let alive = true;

  // Per post element: { key, previewKey, text, truncated, orgs, people, sponsored, state, result, retryAt }
  const posts = new WeakMap();
  // Posts the reader un-stamped stay un-stamped while the page is open, even if LinkedIn
  // unmounts and remounts them.
  const restoredKeys = new Set();
  // Posts already stamped once. Remounted ones come back stamped without the animation.
  const stampedKeys = new Set();

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
          if (child.matches(SELECTORS.skip) || child.matches(OURS)) continue;
          if (child.tagName === 'BR') out += '\n';
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
      .replace(/[ \t ]+/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function countWords(text) {
    let n = 0;
    for (const token of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(token)) n++;
    return n;
  }

  // Cheap fingerprint to notice when LinkedIn reuses an element for a different post.
  function fingerprint(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36) + text.length.toString(36);
  }

  // A "… more" button can mean two things. Either the whole post is already on the page
  // and CSS just clips it (nothing to do), or only the first lines are there and the rest
  // arrives when the button is pressed. Clipped text overflows its box; cut text doesn't.
  function needsExpanding(el) {
    if (!el.querySelector(SELECTORS.moreButton)) return false;
    for (let node = el, i = 0; node && i < 3; node = node.parentElement, i++) {
      if (node.scrollHeight > node.clientHeight + 4) return false;
    }
    return true;
  }

  function ownText(root) {
    for (const el of root.querySelectorAll(SELECTORS.text)) {
      if (!belongsTo(el, root) || el.closest(OURS)) continue;
      const text = readText(el);
      if (text) return { el, text, truncated: needsExpanding(el) };
    }
    return null;
  }

  // Text inside a reshared post or a comment belongs to that, not to the outer post.
  function belongsTo(el, root) {
    if (root.matches(SELECTORS.post)) return el.closest(SELECTORS.post) === root;
    return el.closest(SELECTORS.feedItem) === root;
  }

  const linkTexts = (el, selector) => [...el.querySelectorAll(selector)].map((a) => readText(a)).filter(Boolean);
  const precedes = (node, textEl) => Boolean(node.compareDocumentPosition(textEl) & Node.DOCUMENT_POSITION_FOLLOWING) && !textEl.contains(node);

  // LinkedIn labels adverts "Promoted" in the header, above the post text.
  function isPromoted(root, textEl) {
    if (!textEl) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!precedes(node, textEl)) break;
      if (/^Promoted\b/.test(node.nodeValue.trim())) return true;
    }
    return false;
  }

  // ---------- finding posts ----------

  function outermostItem(node) {
    let item = node.closest(SELECTORS.feedItem);
    for (let up = item?.parentElement?.closest(SELECTORS.feedItem); up; up = up.parentElement?.closest(SELECTORS.feedItem)) item = up;
    return item;
  }

  function roots() {
    const found = new Set();
    for (const el of document.querySelectorAll(SELECTORS.post)) {
      if (!el.parentElement?.closest(SELECTORS.post)) found.add(el);
    }
    for (const box of document.querySelectorAll(SELECTORS.textBox)) {
      if (box.closest(SELECTORS.post) || box.closest(OURS)) continue;
      const item = outermostItem(box);
      if (item) found.add(item);
    }
    return [...found];
  }

  function scan() {
    if (!alive || !settings.enabled) return;
    for (const root of roots()) {
      const info = posts.get(root);
      if (info && info.state === 'expanding') continue;
      const found = ownText(root);
      if (!found) continue;

      const key = fingerprint(found.text);
      if (info && (info.key === key || info.previewKey === key)) {
        // LinkedIn sometimes re-renders a post in place and drops what we added.
        if (info.state === 'stamped') ensureStamp(root, info);
        if (info.state === 'restored') ensureMark(root, info);
        continue;
      }
      if (info) undo(root, info);

      const words = countWords(found.text);
      const next = {
        key,
        previewKey: key,
        text: found.text,
        truncated: found.truncated,
        orgs: linkTexts(found.el, SELECTORS.orgLink),
        people: linkTexts(found.el, SELECTORS.personLink),
        sponsored: isPromoted(root, found.el),
        // A cut-short post might be long behind its "… more", so it isn't judged by length yet.
        state: words < settings.minWords && !found.truncated ? 'short' : 'waiting',
        result: null,
        retryAt: 0,
      };
      posts.set(root, next);
      root.dataset.iow = next.state;
      if (next.state === 'waiting') {
        nearObserver.observe(root);
        seenObserver.observe(root);
      }
    }
  }

  // ---------- classification ----------

  // Starts work well before a post scrolls into view (about three screens ahead), so the
  // Jev answer is back before the reader gets there.
  const nearObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) classify(entry.target);
    },
    { rootMargin: '2400px 0px 2400px 0px' },
  );

  // Stamps land when the post is on screen, so the reader sees them go down.
  const seenObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const info = posts.get(entry.target);
        if (!info) continue;
        info.visible = entry.intersectionRatio >= 0.3;
        if (info.state === 'ready') place(entry.target, info);
      }
    },
    { threshold: [0, 0.3, 0.6] },
  );

  let active = 0;
  const queue = [];

  function classify(root) {
    const info = posts.get(root);
    if (!info || info.state !== 'waiting' || Date.now() < info.retryAt) return;
    if (info.truncated) {
      info.state = 'expanding';
      root.dataset.iow = 'expanding';
      expand(root, info).then((ok) => {
        if (posts.get(root) !== info) return;
        if (!ok || countWords(info.text) < settings.minWords) {
          info.state = 'short';
          root.dataset.iow = 'short';
          release(root, info);
          nearObserver.unobserve(root);
          seenObserver.unobserve(root);
          return;
        }
        info.state = 'waiting';
        classify(root);
      });
      return;
    }
    info.state = 'asking';
    root.dataset.iow = 'asking';
    queue.push(root);
    drain();
  }

  // When LinkedIn only puts the first lines on the page, the script presses "… more"
  // itself. The paragraph's height is frozen first, so the extra text loads out of sight
  // and nothing else in the post, or on the page, moves.
  async function expand(root, info) {
    const preview = ownText(root);
    const button = preview?.el.querySelector(SELECTORS.moreButton);
    if (button) {
      info.holder = holderFor(preview.el, root);
      hold(info.holder);
      button.click();
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        const now = ownText(root);
        if (now && (!now.el.querySelector(SELECTORS.moreButton) || now.text !== preview.text)) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return readInto(root, info);
  }

  // Re-reads the post after "… more" has done its work.
  function readInto(root, info) {
    const full = ownText(root);
    if (!full) return false;
    info.text = full.text;
    info.key = fingerprint(full.text);
    info.truncated = false;
    info.orgs = linkTexts(full.el, SELECTORS.orgLink);
    info.people = linkTexts(full.el, SELECTORS.personLink);
    info.sponsored = info.sponsored || isPromoted(root, full.el);
    return true;
  }

  function drain() {
    while (active < 4 && queue.length) {
      const root = queue.shift();
      const info = posts.get(root);
      if (!info || info.state !== 'asking') continue;
      active++;
      const key = info.key;
      send({ type: 'classify', text: info.text, mentionedOrgs: info.orgs, mentionedPeople: info.people, sponsored: info.sponsored })
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

    if (result.status === 'translated') {
      info.state = 'ready';
      root.dataset.iow = 'ready';
      if (restoredKeys.has(info.key)) return unstamp(root, info, { animate: false });
      place(root, info);
      return;
    }
    if (result.status === 'error' && result.reason === 'busy') {
      // Try again the next time the post comes near the viewport.
      info.state = 'waiting';
      info.retryAt = Date.now() + 20000;
      root.dataset.iow = 'waiting';
      release(root, info);
      nearObserver.unobserve(root);
      setTimeout(() => nearObserver.observe(root), 20000);
      return;
    }
    // Unsure, real content, sensitive, no key, paused: the post stays exactly as written.
    info.state = result.status === 'unchanged' ? 'kept' : 'skipped';
    root.dataset.iow = info.state;
    release(root, info);
    nearObserver.unobserve(root);
    seenObserver.unobserve(root);
  }

  // A translated post is prepared as soon as its answer arrives, but it keeps looking
  // exactly like the original until its handwriting spot is fully on screen (and the
  // page has finished loading and been in view for a moment). Only then does the blur
  // fade in and the pen write, so the reader always sees it happen.
  const SETTLE_MS = 1400;
  const PLAY_GAP = 300;
  let settledAt = 0;
  let settleTimer = 0;

  function settled() {
    if (document.readyState !== 'complete' || document.visibilityState !== 'visible') {
      settledAt = 0;
      return false;
    }
    if (!settledAt) settledAt = performance.now() + SETTLE_MS;
    return performance.now() >= settledAt;
  }

  function whenSettled() {
    if (settleTimer) return;
    settleTimer = setTimeout(() => {
      settleTimer = 0;
      if (!settled()) return whenSettled();
      pumpPlays();
    }, 250);
  }

  addEventListener('load', whenSettled);
  document.addEventListener('visibilitychange', () => {
    settledAt = 0;
    whenSettled();
  });

  const noteObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const veil = entry.target.closest('.iow-veil');
        if (!veil || !veil.isConnected) {
          noteObserver.unobserve(entry.target);
          continue;
        }
        const full = entry.isIntersecting && entry.intersectionRatio >= 0.99;
        veil.dataset.inView = full ? '1' : '';
        if (full) requestPlay(veil);
        // Scrolled up past the top before it got its turn (a fast scroll): show it without
        // the animation, so no translated post is ever left looking untouched.
        else if (!entry.isIntersecting && entry.boundingClientRect.bottom <= 0) reveal(veil);
      }
    },
    // Fully visible, and above the bottom eighth of the screen. The 0 threshold reports
    // leaving the screen, so a post scrolled past in one jump is still caught.
    { threshold: [0, 1], rootMargin: '0px 0px -12% 0px' },
  );

  function reveal(veil) {
    if (!veil.classList.contains('iow-waiting')) return;
    const note = veil.querySelector('.iow-note');
    if (note) noteObserver.unobserve(note);
    veil.classList.remove('iow-waiting');
  }

  const playQueue = [];
  let playing = false;

  function requestPlay(veil) {
    if (!playQueue.includes(veil)) playQueue.push(veil);
    pumpPlays();
  }

  function pumpPlays() {
    if (playing) return;
    if (!settled()) return whenSettled();
    const veil = playQueue.shift();
    if (!veil) return;
    // Scrolled away again while it waited its turn: the observer queues it next time.
    if (!veil.isConnected || !veil.classList.contains('iow-waiting') || veil.dataset.inView !== '1') return pumpPlays();
    const note = veil.querySelector('.iow-note');
    if (note) noteObserver.unobserve(note);
    veil.classList.remove('iow-waiting');
    veil.classList.add('iow-landing');
    // Stop replaying the pen strokes when the veil is refitted later.
    setTimeout(() => veil.classList.remove('iow-landing'), 1400);
    playing = true;
    setTimeout(() => {
      playing = false;
      pumpPlays();
    }, PLAY_GAP);
  }

  function place(root, info) {
    const quiet = stampedKeys.has(info.key) || reduceMotion.matches;
    stamp(root, info, { animate: !quiet });
  }

  // ---------- height: only ever touched while "… more" loads ----------

  // The block around the post's text: the paragraph LinkedIn fills in when "… more" is pressed.
  function holderFor(textEl, root) {
    for (let node = textEl; node && node !== root; node = node.parentElement) {
      const display = getComputedStyle(node).display;
      if (display !== 'inline' && display !== 'contents') return node;
    }
    return textEl;
  }

  // Frozen elements are tracked here rather than with a class, because LinkedIn rewrites
  // an element's class list when it redraws it (pressing "… more" does), which would
  // strand the fixed height. Each entry remembers the inline styles it replaced.
  const held = new Map();
  const HOLD_PROPS = ['height', 'overflow', 'overflow-anchor', 'transition'];

  function hold(node, height = node.getBoundingClientRect().height) {
    if (!held.has(node)) {
      held.set(node, Object.fromEntries(HOLD_PROPS.map((p) => [p, [node.style.getPropertyValue(p), node.style.getPropertyPriority(p)]])));
    }
    node.style.setProperty('height', `${height}px`);
    node.style.setProperty('overflow', 'hidden');
    node.style.setProperty('overflow-anchor', 'none');
  }

  function unhold(node) {
    if (!node || !held.has(node)) return;
    const saved = held.get(node);
    held.delete(node);
    for (const p of HOLD_PROPS) {
      const [value, priority] = saved[p];
      if (value) node.style.setProperty(p, value, priority);
      else node.style.removeProperty(p);
    }
  }

  const isHeld = (node) => Boolean(node) && held.has(node);

  function scroller(root) {
    for (let node = root.parentElement; node && node !== document.body; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Browsers round scroll positions to whole device pixels, so each correction can be off
  // by a fraction. The leftover is carried into the next one, or a run of posts opening
  // above the reader would add up to a visible nudge.
  const scrollCarry = new WeakMap();
  function correctScroll(box, shift) {
    const want = box.scrollTop + shift + (scrollCarry.get(box) || 0);
    box.scrollTop = want;
    scrollCarry.set(box, want - box.scrollTop);
  }

  // Lets a frozen paragraph show the rest of its text. Below the screen nobody sees it.
  // Above the screen (or with only a sliver showing at the top) the page scrolls by the
  // same amount so nothing the reader is looking at moves. On screen it opens smoothly,
  // the same way LinkedIn's own "… more" does.
  function release(root, info, { animate = true } = {}) {
    const node = info?.holder;
    if (!isHeld(node)) return;
    const rect = root.getBoundingClientRect();
    const from = node.getBoundingClientRect().height;
    const above = rect.bottom <= 0 || (rect.top < 0 && rect.bottom < innerHeight * 0.35);
    const box = scroller(root);
    if (above) box.style.overflowAnchor = 'none';
    unhold(node);
    const after = root.getBoundingClientRect();
    if (above) {
      correctScroll(box, after.bottom - rect.bottom);
      requestAnimationFrame(() => box.style.removeProperty('overflow-anchor'));
      return;
    }
    const to = node.getBoundingClientRect().height;
    const onScreen = rect.top < innerHeight && rect.bottom > 0;
    if (!animate || !onScreen || reduceMotion.matches || Math.abs(to - from) < 2) return;
    hold(node, from);
    node.getBoundingClientRect();
    node.style.setProperty('transition', 'height 360ms cubic-bezier(0.25, 0.7, 0.25, 1)');
    node.style.setProperty('height', `${to}px`);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      unhold(node);
    };
    node.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 500);
  }

  // ---------- the stamp ----------

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
    return document.documentElement.classList.contains('theme--dark');
  }

  function surface(root) {
    let node = root;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(bg)) return bg;
      node = node.parentElement;
    }
    return isDark(root) ? '#1b1f23' : '#ffffff';
  }

  function seedOf(key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // The Like / Comment / Repost row, so the stamp can stop above it and leave it usable.
  function actionRow(root, textEl) {
    const buttons = [...root.querySelectorAll('button, [role="button"]')].filter((b) => {
      if (textEl && (textEl.contains(b) || precedes(b, textEl))) return false;
      const label = (b.getAttribute('aria-label') || b.textContent || '').trim();
      return SELECTORS.actionLabel.test(label);
    });
    if (buttons.length < 2) return null;
    let node = buttons[0].parentElement;
    while (node && node !== root && !node.contains(buttons[1])) node = node.parentElement;
    return node && node !== root ? node : null;
  }

  // One entry per line of text as drawn on screen, so the pen can strike through each.
  function textLines(textEl) {
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const lines = [];
    for (const r of range.getClientRects()) {
      if (r.width < 4 || r.height < 6) continue;
      const mid = r.top + r.height / 2;
      const line = lines.find((l) => Math.abs(l.mid - mid) < r.height * 0.4);
      if (line) {
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
      } else lines.push({ mid, left: r.left, right: r.right, height: r.height });
    }
    return lines.sort((x, y) => x.mid - y.mid);
  }

  // The lowest point of the text that isn't clipped away by a box around it.
  function clipBottom(textEl, root) {
    let bottom = Infinity;
    for (let node = textEl; node && node !== root; node = node.parentElement) {
      if (getComputedStyle(node).overflowY !== 'visible') bottom = Math.min(bottom, node.getBoundingClientRect().bottom);
    }
    return bottom;
  }

  let maskCount = 0;

  // A red pen line through every visible line of the original, wobbling a little
  // differently on each post.
  function scribble(veil, textEl, root) {
    const svg = veil.querySelector('.iow-scribbles');
    if (!svg) return;
    svg.replaceChildren();
    if (!textEl) return;
    const box = veil.getBoundingClientRect();
    const limit = Math.min(box.bottom - 2, clipBottom(textEl, root));
    let s = Number(veil.dataset.seed) || 1;
    const rand = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
    const lines = textLines(textEl).filter((l) => l.mid > box.top + 2 && l.mid < limit);
    const NS = 'http://www.w3.org/2000/svg';
    // The pen goes around the handwriting: a mask with a gap for each written line.
    const id = `iow-around-${++maskCount}`;
    const mask = document.createElementNS(NS, 'mask');
    mask.setAttribute('id', id);
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    const paper = document.createElementNS(NS, 'rect');
    Object.entries({ x: -20, y: -20, width: box.width + 40, height: box.height + 40, fill: '#fff' }).forEach(([k, v]) => paper.setAttribute(k, v));
    mask.append(paper);
    const note = veil.querySelector('.iow-note');
    for (const r of note ? textLines(note) : []) {
      const gap = document.createElementNS(NS, 'rect');
      const half = r.height / 2 + 3;
      Object.entries({ x: r.left - box.left - 9, y: r.mid - box.top - half, width: r.right - r.left + 18, height: half * 2, rx: 8, fill: '#000' }).forEach(([k, v]) => gap.setAttribute(k, v));
      mask.append(gap);
    }
    const defs = document.createElementNS(NS, 'defs');
    defs.append(mask);
    const strokes = document.createElementNS(NS, 'g');
    strokes.setAttribute('mask', `url(#${id})`);
    svg.append(defs, strokes);
    lines.forEach((line, i) => {
      const x1 = line.left - box.left - 3;
      const x2 = line.right - box.left + 3;
      const y = line.mid - box.top + line.height * 0.06;
      const w = (x2 - x1) / 3;
      const dy = () => ((rand() - 0.5) * 3).toFixed(1);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', `M${x1.toFixed(1)},${(y + +dy()).toFixed(1)} C${(x1 + w).toFixed(1)},${(y + +dy()).toFixed(1)} ${(x1 + 2 * w).toFixed(1)},${(y + +dy()).toFixed(1)} ${x2.toFixed(1)},${(y + +dy()).toFixed(1)}`);
      path.setAttribute('pathLength', '1');
      path.style.setProperty('--i', i);
      strokes.append(path);
    });
  }

  // The pen covers from the top of the post's text to the action row (or the bottom of
  // the post), so the header above and the buttons below stay LinkedIn's own.
  function fit(root, veil) {
    const box = root.getBoundingClientRect();
    if (!box.height) return;
    const text = ownText(root)?.el;
    let top = text ? text.getBoundingClientRect().top - box.top - 6 : 0;
    let bottom = box.height;
    const row = actionRow(root, text);
    if (row) {
      const r = row.getBoundingClientRect();
      if (r.top > box.top + top + 40 && r.top < box.bottom) bottom = r.top - box.top;
    }
    top = Math.max(0, Math.min(top, box.height - 60));
    const height = Math.max(56, bottom - top);
    veil.style.top = `${top}px`;
    veil.style.height = `${height}px`;
    // Short posts leave less room under the header, so the handwriting steps down in size.
    veil.classList.toggle('iow-compact', height < 120);
    veil.classList.toggle('iow-tiny', height < 84);
    const radius = getComputedStyle(root).borderBottomLeftRadius;
    veil.style.borderRadius = top + height >= box.height - 1 ? `0 0 ${radius} ${radius}` : '0';
    let split = height;
    if (text) {
      const textBottom = Math.min(text.getBoundingClientRect().bottom, clipBottom(text, root));
      split = Math.max(0, Math.min(height, textBottom - box.top - top + 6));
    }
    veil.style.setProperty('--iow-split', `${Math.round(split)}px`);
    // The handwriting sits in the middle of the covered area. On a tall post that can be
    // below the screen at first, which is fine: it only plays once it is fully in view.
    const note = veil.querySelector('.iow-note');
    if (note) {
      const noteHeight = note.getBoundingClientRect().height;
      const offset = Math.max(6, (height - noteHeight) / 2);
      veil.style.setProperty('--iow-note-top', `${Math.round(offset)}px`);
    }
    scribble(veil, text, root);
  }

  const resizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const veil = entry.target.querySelector(':scope > .iow-veil');
      if (veil) fit(entry.target, veil);
    }
  });

  function buildVeil(root, info) {
    const { result } = info;
    const seed = seedOf(info.key);
    const veil = el('div', 'iow-veil');
    veil.dataset.tone = isDark(root) ? 'dark' : 'light';
    veil.dataset.seed = String(seed);
    veil.style.setProperty('--iow-cover', surface(root));
    veil.setAttribute('role', 'group');
    veil.setAttribute('aria-label', 'This post in other words');

    // Two layers of frosted paper: a light one over the post's text, so the crossed-out
    // words still show through, and a heavy one over images and video.
    const frostText = el('div', 'iow-frost iow-frost-text');
    const frostMedia = el('div', 'iow-frost iow-frost-media');

    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lines.setAttribute('class', 'iow-scribbles');
    lines.setAttribute('aria-hidden', 'true');

    // Written at a slightly different angle on every post, the way a hand does.
    const note = el('div', 'iow-note');
    const tilt = -3.2 + ((seed % 1000) / 1000) * 2.6;
    note.style.setProperty('--iow-tilt', `${tilt.toFixed(2)}deg`);
    note.append(el('p', 'iow-says', result.sentence));
    const tally = el('p', 'iow-tally');
    const count = el('span', null, `${result.removed.toLocaleString()} ${result.removed === 1 ? 'word' : 'words'} cut, ${result.percent}% shorter`);
    count.title = `${result.before.toLocaleString()} words down to ${result.after}. Jev was ${Math.round(result.confidence * 100)}% sure.`;
    const button = el('button', 'iow-button', 'Show original');
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const current = posts.get(root);
      if (current) unstamp(root, current, { animate: true, focus: true });
    });
    tally.append(count, button);
    note.append(tally);
    veil.addEventListener('click', (event) => event.stopPropagation());
    veil.append(frostText, frostMedia, lines, note);
    return veil;
  }

  function buildMark(root, info) {
    const mark = el('button', 'iow-mark');
    mark.type = 'button';
    mark.dataset.tone = isDark(root) ? 'dark' : 'light';
    mark.title = `In other words: ${info.result.sentence}`;
    mark.setAttribute('aria-label', 'Show the translation again');
    mark.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 10.5c2.2-3.6 3.4 2.8 5.6-.6s3.2-2.4 6.4-4.4"/></svg>';
    mark.addEventListener('click', (event) => {
      event.stopPropagation();
      const current = posts.get(root);
      if (!current) return;
      restoredKeys.delete(current.key);
      stamp(root, current, { animate: true, focus: true });
    });
    return mark;
  }

  function placeMark(root, mark) {
    const box = root.getBoundingClientRect();
    const text = ownText(root)?.el;
    const top = text ? text.getBoundingClientRect().top - box.top : 8;
    mark.style.top = `${Math.max(4, top - 2)}px`;
  }

  function clearOurs(root) {
    root.querySelectorAll(':scope > .iow-veil, :scope > .iow-mark').forEach((n) => n.remove());
    root.classList.remove('iow-stamped', 'iow-marked');
    resizes.unobserve(root);
  }

  function anchorRoot(root) {
    if (getComputedStyle(root).position === 'static') root.classList.add('iow-anchor');
  }

  // The handwriting face arrives as bytes from the background worker and is registered
  // in memory, so no extension file is ever exposed to the page.
  let fontsLoading = null;
  function loadFonts() {
    if (!fontsLoading) {
      fontsLoading = send({ type: 'fonts' }).then(async (files) => {
        for (const { weight, range, data } of files || []) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          const face = new FontFace('IOW Kalam', bytes, { weight, unicodeRange: range, display: 'swap' });
          document.fonts.add(await face.load());
        }
      }).catch(() => {});
    }
    return fontsLoading;
  }

  function stamp(root, info, { animate, focus = false }) {
    loadFonts();
    info.state = 'stamped';
    root.dataset.iow = 'stamped';
    stampedKeys.add(info.key);
    stampedKeys.add(info.previewKey);
    seenObserver.unobserve(root);
    clearOurs(root);
    anchorRoot(root);
    const veil = buildVeil(root, info);
    // Animated ones wait, invisible, until their handwriting is fully on screen.
    if (animate && !reduceMotion.matches) veil.classList.add('iow-waiting');
    root.append(veil);
    root.classList.add('iow-stamped');
    fit(root, veil);
    if (veil.classList.contains('iow-waiting')) noteObserver.observe(veil.querySelector('.iow-note'));
    resizes.observe(root);
    if (focus) veil.querySelector('.iow-button')?.focus({ preventScroll: true });
  }

  function unstamp(root, info, { animate, focus = false }) {
    info.state = 'restored';
    root.dataset.iow = 'restored';
    restoredKeys.add(info.key);
    const veil = root.querySelector(':scope > .iow-veil');
    const finish = () => {
      clearOurs(root);
      // A post that was cut short gets the rest of its text shown now the reader asked for it.
      release(root, info, { animate });
      anchorRoot(root);
      const mark = buildMark(root, info);
      root.append(mark);
      root.classList.add('iow-marked');
      placeMark(root, mark);
      if (focus) mark.focus({ preventScroll: true });
    };
    if (veil && animate && !reduceMotion.matches) {
      veil.classList.add('iow-lifting');
      setTimeout(finish, 180);
    } else finish();
  }

  function ensureStamp(root, info) {
    if (!root.querySelector(':scope > .iow-veil')) stamp(root, info, { animate: false });
  }

  function ensureMark(root, info) {
    if (!root.querySelector(':scope > .iow-mark')) {
      anchorRoot(root);
      const mark = buildMark(root, info);
      root.append(mark);
      root.classList.add('iow-marked');
      placeMark(root, mark);
    }
  }

  function undo(root, info) {
    nearObserver.unobserve(root);
    seenObserver.unobserve(root);
    unhold(info?.holder);
    clearOurs(root);
    root.classList.remove('iow-anchor');
    delete root.dataset.iow;
    posts.delete(root);
    if (info) info.state = 'gone';
  }

  function undoAll() {
    for (const root of roots()) undo(root, posts.get(root));
    document.querySelectorAll('.iow-veil, .iow-mark').forEach((n) => n.remove());
    document.querySelectorAll('.iow-stamped, .iow-marked, .iow-anchor').forEach((n) => {
      n.classList.remove('iow-stamped', 'iow-marked', 'iow-anchor');
    });
    for (const node of [...held.keys()]) unhold(node);
  }

  // ---------- endless feed ----------

  // LinkedIn's newer feed stops every few posts at a "Load more" button. With the setting
  // on, the button is pressed while it is still well below the screen, so the feed keeps
  // going as you scroll.
  const LOAD_MORE = /^(load more|show more posts|see more posts)$/i;
  let lastLoad = 0;

  function maybeLoadMore() {
    if (!alive || !settings.enabled || !settings.autoLoad || Date.now() - lastLoad < 2500) return;
    const button = [...document.querySelectorAll('button')].find(
      (b) => LOAD_MORE.test((b.textContent || '').trim()) && b.offsetParent && !b.disabled,
    );
    if (!button) return;
    const r = button.getBoundingClientRect();
    if (r.top < innerHeight + 1600 && r.bottom > -200) {
      lastLoad = Date.now();
      button.click();
    }
  }

  // The newer feed scrolls an inner panel (main#workspace), not the page, and scroll
  // events don't bubble, so listen in the capture phase to hear every scroller.
  let scrollTimer = 0;
  document.addEventListener(
    'scroll',
    () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = 0;
        maybeLoadMore();
      }, 400);
    },
    { passive: true, capture: true },
  );

  // ---------- wiring ----------

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
      maybeLoadMore();
    }, 250);
  }

  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      // Ignore our own stamps and marks going in and out.
      const ours = [...record.addedNodes, ...record.removedNodes].every((n) => n.nodeType === 1 && n.matches?.(OURS));
      if (!ours) return scheduleScan();
    }
  });

  async function loadSettings({ retry = false } = {}) {
    const next = await send({ type: 'contentSettings' });
    if (!next) return;
    const wasEnabled = settings.enabled;
    const minChanged = next.minWords !== settings.minWords;
    settings = next;
    if (!settings.enabled) return undoAll();
    if (!wasEnabled || minChanged) undoAll();
    // Posts skipped for a missing or rejected key get another go once the key changes.
    if (retry) {
      for (const root of roots()) {
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
      loadSettings();
    }
  });

  // The popup asks what happened on this page, so a LinkedIn redesign shows up as
  // "no posts found" instead of silence.
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'pageStats') return false;
    const counts = {};
    let found = 0;
    for (const root of roots()) {
      found++;
      const state = posts.get(root)?.state || 'new';
      counts[state] = (counts[state] || 0) + 1;
    }
    const layout = document.querySelector('[data-testid="mainFeed"]') ? 'new' : document.querySelector(SELECTORS.post) ? 'classic' : 'unknown';
    reply({ found, counts, layout, enabled: settings.enabled, hasKey: settings.hasKey });
    return false;
  });

  mutations.observe(document.body, { childList: true, subtree: true });
  loadSettings();
})();

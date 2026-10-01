// Runs inside x.com's own page, before X's scripts, rather than in the extension's
// isolated world. X downloads each author's profile alongside every post it shows. This
// reads it from wherever the page keeps it: the data attached to each post it has drawn
// (the long-standing build), the page's router (the newer build), and API responses as
// they arrive. It hands the public profile fields (name, bio, link, affiliation badge,
// professional category) to content.js. It makes no requests of its own and has no
// access to the extension's storage or key.

(() => {
  if (window.__saysWhoTap) return;
  window.__saysWhoTap = true;

  const TAG = 'says-who';
  const MAX_KEPT = 4000;
  // Everything seen so far, so content.js can catch up when it starts after the first responses.
  const kept = new Map();

  const str = (value) => (typeof value === 'string' ? value : '');

  // The newer build of the site describes a user in one flat object.
  function flatProfileOf(node) {
    return {
      handle: node.screenName,
      name: str(node.name),
      bio: str(node.description),
      link: str(node.expandedUrl).replace(/^https?:\/\//, ''),
      label: str(node.affiliateLabelDescription),
      category: '',
    };
  }

  function profileOf(node) {
    const core = node.core || {};
    // API responses nest most fields under `legacy`. The page's own copy has them at the top.
    const legacy = node.legacy || node;
    const handle = str(core.screen_name) || str(legacy.screen_name);
    if (!handle) return null;
    let bio = str(legacy.description) || str(node.profile_bio?.description);
    // Bios hold shortened t.co links. Swap in the address X shows on screen.
    for (const url of legacy.entities?.description?.urls || []) {
      if (url?.url && url.display_url) bio = bio.split(url.url).join(url.display_url);
    }
    const site = legacy.entities?.url?.urls?.[0];
    return {
      handle,
      name: str(core.name) || str(legacy.name),
      bio,
      link: str(site?.display_url) || str(site?.expanded_url),
      label: str(node.affiliates_highlighted_label?.label?.description) || str(node.highlightedLabel?.description),
      // What the account itself picked under "professional category", such as "Entrepreneur".
      category: (node.professional?.category || []).map((c) => str(c?.name)).filter(Boolean).join(', '),
    };
  }

  // User objects sit at different depths in every kind of response (timeline, post,
  // search, profile), so the whole answer is walked rather than relying on one path.
  function collect(value, out, depth = 0, seen = new Set()) {
    if (!value || typeof value !== 'object' || depth > 60 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collect(item, out, depth + 1, seen);
      return;
    }
    if (value.__typename === 'User' || (value.rest_id && (value.legacy || value.core)) || (typeof value.screen_name === 'string' && typeof value.description === 'string')) {
      const profile = profileOf(value);
      if (profile) out.push(profile);
    } else if (typeof value.screenName === 'string' && (typeof value.description === 'string' || typeof value.affiliateLabelDescription === 'string')) {
      out.push(flatProfileOf(value));
    }
    for (const key in value) collect(value[key], out, depth + 1, seen);
  }

  function publish(profiles) {
    if (profiles.length) window.postMessage({ source: TAG, type: 'profiles', profiles }, location.origin);
  }

  function read(body) {
    if (typeof body !== 'string' || !/screen_?name/i.test(body)) return;
    try {
      keep(JSON.parse(body));
    } catch {
      // Not JSON, or not a shape we know. X's own code is unaffected either way.
    }
  }

  function keep(data) {
    const found = [];
    collect(data, found);
    const fresh = [];
    for (const profile of found) {
      const key = profile.handle.toLowerCase();
      const before = kept.get(key);
      if (before && before.bio === profile.bio && before.label === profile.label && before.link === profile.link && before.category === profile.category) continue;
      kept.delete(key);
      kept.set(key, profile);
      fresh.push(profile);
    }
    while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
    publish(fresh);
  }

  // What the newer build loaded for the page being shown.
  function readRouter() {
    try {
      for (const match of window.__TSR_ROUTER__?.state?.matches || []) keep(match.loaderData);
    } catch {}
  }

  // The long-standing build attaches each post's data, author included, to the element it
  // draws. A repost holds the reposter there, with the post's real author inside it.
  function readPosts() {
    try {
      for (const article of document.querySelectorAll('article')) {
        const key = Object.keys(article).find((k) => k.startsWith('__reactFiber$'));
        let fiber = key && article[key];
        for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
          const tweet = fiber.memoizedProps?.tweet;
          if (!tweet?.user) continue;
          keep([tweet.user, tweet.retweeted_status?.user, tweet.quoted_status?.user]);
          break;
        }
      }
    } catch {}
  }

  const isApi = (url) => /\/i\/api\/|\/graphql\/|^https:\/\/api\.x\.com\//.test(String(url || ''));

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isApi(url)) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') read(this.responseText);
        } catch {}
      });
    }
    return open.call(this, method, url, ...rest);
  };

  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const result = nativeFetch.call(this, input, init);
    try {
      if (isApi(typeof input === 'string' ? input : input?.url)) {
        result
          .then((response) => {
            // Only finished JSON answers. A stream would be held open by reading a copy of it.
            if (/json/i.test(response.headers.get('content-type') || '')) return response.clone().text().then(read);
          })
          .catch(() => {});
      }
    } catch {}
    return result;
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== TAG) return;
    // "look": content.js has found posts on the page. Anything new about their authors is sent back.
    if (event.data.type === 'look') {
      readPosts();
      readRouter();
    }
    // "hello": content.js has just started and wants everything seen so far.
    if (event.data.type === 'hello') {
      readPosts();
      readRouter();
      publish([...kept.values()]);
    }
  });
})();

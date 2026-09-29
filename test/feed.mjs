// Builds a test feed whose markup follows LinkedIn's post structure (the class names
// the content script looks for), so the extension can be exercised without logging in.
// It is deliberately plain: it is a harness, not a copy of LinkedIn.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function body(post) {
  let html = esc(post.text);
  for (const org of post.mentions || []) {
    html = html.replace(esc(org), `<a href="https://www.linkedin.com/company/${org.toLowerCase()}/">${esc(org)}</a>`);
  }
  // Hashtags carry a screen-reader prefix, as on LinkedIn.
  html = html.replace(/#(\w+)/g, '<a href="https://www.linkedin.com/feed/hashtag/$1"><span class="visually-hidden">hashtag</span>#$1</a>');
  return html.replace(/\n/g, '<br>');
}

function initials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('');
}

export function postHtml(post, i, { nested } = {}) {
  const hue = (i * 47) % 360;
  return `
  <div class="feed-shared-update-v2 card" data-urn="urn:li:activity:70000000000000${String(i).padStart(5, '0')}" role="article">
    <div class="update-components-actor">
      <div class="avatar" style="background:hsl(${hue} 30% 78%)">${esc(initials(post.author))}</div>
      <div>
        <span class="update-components-actor__title"><span dir="ltr"><span aria-hidden="true">${esc(post.author)}</span><span class="visually-hidden">${esc(post.author)}</span></span></span>
        <span class="update-components-actor__description">${esc(post.headline || 'Member')}</span>
      </div>
    </div>
    <div class="feed-shared-update-v2__description-wrapper">
      <div class="feed-shared-inline-show-more-text">
        <div class="update-components-text update-components-update-v2__commentary"><span class="break-words"><span dir="ltr">${body(post)}</span></span></div>
        <button class="see-more" type="button">…more</button>
      </div>
    </div>
    ${nested ? `<div class="nested">${nested}</div>` : ''}
    ${post.image ? `<div class="update-components-image" style="background:hsl(${hue} 18% 86%)"></div>` : ''}
    <div class="social-counts">${120 + ((i * 73) % 900)} reactions, ${4 + ((i * 11) % 60)} comments</div>
    <div class="action-bar"><button>Like</button><button>Comment</button><button>Repost</button><button>Send</button></div>
  </div>`;
}

export function feedHtml(posts, { dark = false } = {}) {
  const items = posts.map((p, i) => postHtml(p, i)).join('\n');
  return `<!doctype html>
<html lang="en" class="${dark ? 'theme--dark' : ''}">
<head>
<meta charset="utf-8">
<title>Feed test harness</title>
<style>
  :root { --bg: #ecebe8; --card: #ffffff; --text: rgba(0,0,0,.9); --muted: rgba(0,0,0,.6); --line: #e2e0dc; }
  .theme--dark { --bg: #111315; --card: #1d2226; --text: rgba(255,255,255,.9); --muted: rgba(255,255,255,.6); --line: #2e3439; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.43 -apple-system, system-ui, "Segoe UI", sans-serif; }
  .bar { position: sticky; top: 0; z-index: 5; height: 52px; background: var(--card); border-bottom: 1px solid var(--line); display: flex; align-items: center; padding: 0 24px; color: var(--muted); }
  main { width: 555px; margin: 24px auto; display: flex; flex-direction: column; gap: 8px; }
  .card { background: var(--card); border-radius: 8px; box-shadow: 0 0 0 1px var(--line); }
  .update-components-actor { display: flex; gap: 8px; padding: 12px 16px 0; }
  .avatar { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; font-weight: 600; color: #333; }
  .update-components-actor__title { display: block; font-weight: 600; }
  .update-components-actor__description { display: block; font-size: 12px; color: var(--muted); }
  .feed-shared-inline-show-more-text { position: relative; padding: 8px 16px 0; }
  .update-components-text { max-height: 7.2em; overflow: hidden; }
  .open .update-components-text { max-height: none; }
  .see-more { background: none; border: 0; padding: 0; color: var(--muted); font: inherit; cursor: pointer; }
  .update-components-image { height: 280px; margin-top: 8px; }
  .nested { margin: 8px 16px 0; border: 1px solid var(--line); border-radius: 8px; }
  .nested .card { box-shadow: none; }
  .social-counts { padding: 8px 16px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); margin: 0 16px; padding-left: 0; }
  .action-bar { display: flex; justify-content: space-around; padding: 4px 8px; }
  .action-bar button { background: none; border: 0; color: var(--muted); font: 600 14px/1 inherit; padding: 12px 8px; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
</head>
<body>
<div class="bar">Feed test harness for In Other Words</div>
<main id="feed">
${items}
</main>
<script>
  document.addEventListener('click', (e) => {
    const more = e.target.closest('.see-more');
    if (more) more.parentElement.classList.toggle('open');
  });
</script>
</body>
</html>`;
}

// The newer LinkedIn feed (seen September 2026): hashed class names, posts as list items
// inside [data-testid="mainFeed"], and long text cut short with an inline "… more"
// button that loads the rest when pressed.
export function sduiFeedHtml(posts, { dark = false } = {}) {
  const full = {};
  const items = posts
    .map((post, i) => {
      const hue = (i * 47) % 360;
      const slug = post.author.toLowerCase().replace(/[^a-z]+/g, '-');
      const text = body(post);
      const words = post.text.split(/\s+/);
      let preview = text;
      let more = '';
      let clampClass = '';
      if (post.clamp) {
        // LinkedIn's usual case: the whole text is on the page, clipped to three lines by CSS.
        clampClass = ' clamp3';
        more = '<button data-testid="expandable-text-button" class="_06844382 _92786d21" type="button"><span><span><span>… more</span></span></span></button>';
      } else if (post.text.length > 160) {
        const cut = esc(post.text.slice(0, 150)).replace(/\n/g, '<br>');
        preview = cut;
        more = '<button data-testid="expandable-text-button" class="_06844382 _92786d21" type="button"><span><span><span>… more</span></span></span></button>';
        full[`p${i}`] = text;
      }
      const likedBy = post.likedBy
        ? `<p class="d1f0a2 social"><a href="https://www.linkedin.com/in/${post.likedBy.toLowerCase().replace(/[^a-z]+/g, '-')}/">${esc(post.likedBy)}</a> likes this</p>`
        : '';
      const comment = post.comment
        ? `<div role="list" class="c3d1defd comments"><div role="listitem" class="c9e1a"><a href="https://www.linkedin.com/in/commenter/"><span>Rowan Tait</span></a><p class="c239a6d3"><span data-testid="expandable-text-box">${esc(post.comment)}</span></p></div></div>`
        : '';
      return `
  <div data-lazy-mount-id="m${i}"><div data-display-contents="true" style="display:contents"><div class="_0f5e254b _13f3dfd8"><div class="c336411c a079bc5e">
    <div role="listitem" class="c3d1defd _423c5b58 af965e1d card">
      ${likedBy}
      <div class="a91b2c actor">
        <a href="https://www.linkedin.com/in/${slug}/" class="b77e01" aria-label="${esc(post.author)}"><div class="avatar" style="background:hsl(${hue} 30% 78%)">${esc(initials(post.author))}</div></a>
        <div>
          <a href="https://www.linkedin.com/in/${slug}/" class="b77e02"><p class="n1"><span>${esc(post.author)}</span> • 3rd+</p><p class="h1">${esc(post.headline || 'Member')}</p></a>
          <p class="h1">6h • Edited</p>
        </div>
        <button class="follow" type="button">+ Follow</button>
      </div>
      <div data-display-contents="true" style="display:contents">
        <div class="c3d1defd _263bbd74 text-wrap"><p class="c239a6d3 ce067766" data-post="p${i}"><span data-testid="expandable-text-box" class="_42430e90${clampClass}">${preview}${more}</span></p></div>
      </div>
      ${post.image ? `<div class="update-components-image" style="background:hsl(${hue} 18% 86%)"></div>` : ''}
      <div class="social-counts">${120 + ((i * 73) % 900)} reactions, ${4 + ((i * 11) % 60)} comments</div>
      <div class="action-bar"><button>Like</button><button>Comment</button><button>Repost</button><button>Send</button></div>
      ${comment}
    </div>
  </div></div></div></div>`;
    })
    .join('\n');

  return feedHtml([], { dark })
    .replace('<main id="feed">', `<main id="feed" data-sdui-screen="com.linkedin.sdui.flagshipnav.feed"><div role="list" data-testid="mainFeed" data-component-type="LazyColumn" class="c3d1defd _6da8b5ca feed-list">${items}</div><button type="button" class="load-more">Load more</button>`)
    .replace(
      '<script>',
      `<style>
  .feed-list { display: flex; flex-direction: column; gap: 8px; }
  .actor { display: flex; gap: 8px; padding: 12px 16px 0; align-items: flex-start; }
  .actor a { color: inherit; text-decoration: none; }
  .actor .n1 { margin: 0; font-weight: 600; } .actor .h1 { margin: 0; font-size: 12px; color: var(--muted); }
  .actor .follow { margin-left: auto; background: none; border: 0; color: #0a66c2; font-weight: 600; }
  .social { margin: 0; padding: 8px 16px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); }
  .social a { color: inherit; font-weight: 600; }
  .text-wrap { padding: 8px 16px 0; } .text-wrap p { margin: 0; }
  [data-testid="expandable-text-button"] { background: none; border: 0; padding: 0; color: var(--muted); font: inherit; cursor: pointer; }
  .load-more { display: block; margin: 12px auto; padding: 8px 20px; border: 1px solid var(--muted); border-radius: 999px; background: var(--card); color: var(--text); font: 600 14px/1 inherit; }
  .clamp3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .clamp3 [data-testid="expandable-text-button"] { position: absolute; right: 16px; bottom: 0; background: var(--card); }
  .text-wrap p { position: relative; }
  .comments { padding: 8px 16px 12px; } .comments [role="listitem"] a { font-weight: 600; color: inherit; } .comments p { margin: 2px 0 0; }
</style>
<script>
  const FULL = ${JSON.stringify(full)};
  // Like LinkedIn's newer feed: more posts only arrive when "Load more" is pressed.
  window.__loads = 0;
  document.querySelector('.load-more').addEventListener('click', () => {
    window.__loads++;
    const list = document.querySelector('[data-testid="mainFeed"]');
    const batch = [...list.children].slice(0, 4).map((n) => n.cloneNode(true));
    setTimeout(() => list.append(...batch), 300);
  });
  document.addEventListener('click', (e) => {
    const more = e.target.closest('[data-testid="expandable-text-button"]');
    if (!more) return;
    const p = more.closest('p');
    const box = more.closest('[data-testid="expandable-text-box"]');
    if (box.classList.contains('clamp3')) {
      // Like React: the redraw replaces the whole class list and drops the button.
      box.className = '_42430e90 open-9f2';
      more.remove();
      return;
    }
    setTimeout(() => { p.querySelector('[data-testid="expandable-text-box"]').innerHTML = FULL[p.dataset.post]; }, 150);
  });
</script>
<script>`,
    );
}

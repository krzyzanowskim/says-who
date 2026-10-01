// Builds a test timeline whose markup follows X's post structure (the test ids the
// content script looks for), so the extension can be exercised without logging in.
// Like X, it downloads its posts and their authors' profiles from an API as JSON and
// then draws them. It is deliberately plain: it is a harness, not a copy of X.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function initials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('');
}

function userName(post) {
  return `<div data-testid="User-Name" class="user">
          <div><a href="/${post.handle}" role="link"><span><span>${esc(post.author)}</span></span></a></div>
          <div class="muted"><a href="/${post.handle}" role="link" tabindex="-1"><span>@${post.handle}</span></a> · <a href="/${post.handle}/status/${1000 + post.handle.length}" role="link"><time>3h</time></a></div>
        </div>`;
}

const tweetText = (post) => `<div data-testid="tweetText" dir="auto" lang="en"><span>${esc(post.text).replace(/\n/g, '<br>')}</span></div>`;

export function postHtml(post, i) {
  const hue = (i * 47) % 360;
  const quote = post.quote
    ? `<div role="link" tabindex="0" class="quote">${userName(post.quote)}${tweetText(post.quote)}</div>`
    : '';
  return `
  <div data-testid="cellInnerDiv" class="cell">
    <article data-testid="tweet" role="article" tabindex="0">
      ${post.repostedBy ? `<div data-testid="socialContext" class="context" dir="auto"><a href="/${post.repostedBy}" role="link"><span>${post.repostedBy} reposted</span></a></div>` : ''}
      <div class="avatar" data-testid="Tweet-User-Avatar" style="background:hsl(${hue} 30% 78%)">${esc(initials(post.author))}</div>
      <div class="main">
        ${userName(post)}
        <div class="text">${tweetText(post)}</div>
        ${quote}
        ${post.image ? `<div class="media" data-testid="tweetPhoto" style="background:hsl(${hue} 18% 86%)"></div>` : ''}
        <div role="group" class="actions"><button data-testid="reply">${3 + ((i * 11) % 60)}</button><button data-testid="retweet">${1 + ((i * 7) % 40)}</button><button data-testid="like">${20 + ((i * 73) % 900)}</button></div>
      </div>
    </article>
  </div>`;
}

// One author as X's API describes them. X has moved the name and handle between
// `legacy` and `core` over time, so the harness uses both shapes.
function userJson(post, i) {
  const user = { __typename: 'User', rest_id: String(5000 + i), legacy: { description: post.bio || '' } };
  if (i % 2) user.core = { name: post.author, screen_name: post.handle };
  else Object.assign(user.legacy, { name: post.author, screen_name: post.handle });
  if (post.link) user.legacy.entities = { url: { urls: [{ url: 'https://t.co/abc', display_url: post.link, expanded_url: `https://${post.link}` }] } };
  if (post.label) user.affiliates_highlighted_label = { label: { description: post.label, userLabelType: 'BusinessLabel' } };
  return user;
}

export function timelineJson(posts) {
  return {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: posts.map((post, i) => ({
                entryId: `tweet-${i}`,
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        __typename: 'Tweet',
                        rest_id: String(9000 + i),
                        core: { user_results: { result: userJson(post, i) } },
                        legacy: { full_text: post.text },
                      },
                    },
                  },
                },
                html: postHtml(post, i),
              })),
            },
          ],
        },
      },
    },
  };
}

export function feedHtml({ dark = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Timeline test harness</title>
<style>
  :root { --bg: #ffffff; --text: #0f1419; --muted: #536471; --line: #eff3f4; }
  ${dark ? ':root { --bg: #000000; --text: #e7e9ea; --muted: #71767b; --line: #2f3336; }' : ''}
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/20px -apple-system, system-ui, "Segoe UI", sans-serif; }
  .bar { position: sticky; top: 0; z-index: 5; height: 53px; background: var(--bg); border-bottom: 1px solid var(--line); display: flex; align-items: center; padding: 0 16px; font-weight: 700; }
  main { width: 600px; margin: 0 auto; border-left: 1px solid var(--line); border-right: 1px solid var(--line); min-height: 100vh; }
  .context { flex-basis: 100%; color: var(--muted); font-size: 13px; } .context a { color: inherit; text-decoration: none; }
  article { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-weight: 600; color: #333; }
  .main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .user { display: flex; gap: 4px; } .user a { color: inherit; text-decoration: none; font-weight: 700; }
  .user .muted, .user .muted a { color: var(--muted); font-weight: 400; }
  .text { display: flex; flex-direction: column; }
  .quote { margin-top: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 16px; }
  .media { height: 280px; margin-top: 12px; border-radius: 16px; }
  .actions { display: flex; justify-content: space-between; max-width: 425px; margin-top: 12px; }
  .actions button { background: none; border: 0; color: var(--muted); font: 13px/1 inherit; padding: 0; }
</style>
</head>
<body>
<div class="bar">Timeline test harness for Says Who</div>
<main id="timeline" aria-label="Timeline: Your Home Timeline"></main>
<script>
  // Posts arrive the way they do on X: half through XMLHttpRequest, half through fetch.
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
  window.__opened = 0;
  document.addEventListener('click', (e) => { if (e.target.closest('article')) window.__opened++; });
</script>
</body>
</html>`;
}

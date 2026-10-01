const body = document.getElementById('body');
const toggle = document.getElementById('enabled');
const toggleLabel = document.getElementById('switch-label');
const saved = document.getElementById('saved');

const send = (message) => chrome.runtime.sendMessage(message);
const fmt = (n) => n.toLocaleString('en-GB');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function settingsButton(label) {
  const button = el('button', 'button button-primary', label);
  button.type = 'button';
  button.addEventListener('click', () => chrome.runtime.openOptionsPage());
  return button;
}

function render(status) {
  toggle.checked = status.enabled;
  toggleLabel.textContent = status.enabled ? 'On' : 'Paused';
  document.body.classList.toggle('paused', !status.enabled);
  saved.textContent = status.saved ? `${fmt(status.saved)} ${status.saved === 1 ? 'result' : 'results'} saved` : '';
  body.replaceChildren();

  if (!status.hasKey) {
    body.append(
      el('p', 'notice', 'Add your TypeSafe key to start.'),
      el('p', 'line', 'Jev reads each post about AI next to its author’s bio. You pay TypeSafe directly for that, with your own key.'),
      settingsButton('Add key'),
    );
    return;
  }

  if (status.keyState && status.keyState.status === 401) {
    body.append(
      el('p', 'notice', 'TypeSafe rejected your key.'),
      el('p', 'line', 'Nothing is being checked until you save a working one.'),
      settingsButton('Fix key'),
    );
    return;
  }

  const { flagged, cleared } = status.stats;
  if (!flagged && !cleared) {
    body.append(
      el('p', 'notice', 'Nothing marked yet.'),
      el('p', 'line', 'Scroll X. When someone paid by AI posts about AI, one line under the post says what they gain from it.'),
    );
    return;
  }

  const total = el('p', 'total num');
  total.append(fmt(flagged), ' ', el('small', null, flagged === 1 ? 'post marked' : 'posts marked'));
  const line = el('p', 'line num');
  line.textContent =
    'Posts about AI from people paid by AI.' +
    (cleared ? ` ${fmt(cleared)} other ${cleared === 1 ? 'post' : 'posts'} checked and left alone.` : '');
  body.append(total, line);
  if (!status.enabled) body.append(el('p', 'line', 'Paused. Nothing is checked until you turn it back on.'));
}

document.getElementById('settings').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

toggle.addEventListener('change', async () => {
  render(await send({ type: 'setSettings', patch: { enabled: toggle.checked } }));
  pageLine();
});

// What the content script saw on the current tab. Only X tabs answer.
async function pageLine() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const stats = await chrome.tabs.sendMessage(tab.id, { type: 'pageStats' });
    if (!stats) return;
    const c = stats.counts;
    const n = (...states) => states.reduce((sum, s) => sum + (c[s] || 0), 0);
    let text;
    if (!stats.found) {
      text = "No posts found on this page. If you're on your timeline, X has probably changed its layout.";
    } else if (!stats.profiles) {
      text = `This page: ${fmt(stats.found)} ${stats.found === 1 ? 'post' : 'posts'} found, but no author bios could be read, so posts are judged on their words and names alone. Reload the page. If that doesn't help, X has changed how it loads profiles.`;
    } else {
      const parts = [
        [n('flagged'), 'marked'],
        [n('kept'), 'left alone'],
        [n('unknown'), 'waiting for a bio'],
        [n('waiting', 'asking', 'new'), 'not read yet'],
        [n('skipped'), 'waiting for a key'],
      ].filter(([count]) => count);
      text = `This page: ${fmt(stats.found)} ${stats.found === 1 ? 'post' : 'posts'} found` + (parts.length ? `, ${parts.map(([count, label]) => `${fmt(count)} ${label}`).join(', ')}.` : '.');
    }
    const line = el('p', 'page num', text);
    body.append(line);
  } catch {
    // Not an X tab, or the page was open before the extension was loaded.
  }
}

render(await send({ type: 'status' }));
pageLine();

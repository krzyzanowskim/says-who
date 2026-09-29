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
      el('p', 'line', 'Jev reads each long post and says what it means. You pay TypeSafe directly for that, with your own key.'),
      settingsButton('Add key'),
    );
    return;
  }

  if (status.keyState && status.keyState.status === 401) {
    body.append(
      el('p', 'notice', 'TypeSafe rejected your key.'),
      el('p', 'line', 'Posts are showing as written until you save a working one.'),
      settingsButton('Fix key'),
    );
    return;
  }

  const { posts, wordsCut, leftAlone } = status.stats;
  if (!posts && !leftAlone) {
    body.append(
      el('p', 'notice', 'Nothing cut yet.'),
      el('p', 'line', 'Scroll your LinkedIn feed and long posts will fold into one plain sentence.'),
    );
    return;
  }

  const total = el('p', 'total num');
  total.append(fmt(wordsCut), ' ', el('small', null, wordsCut === 1 ? 'word cut' : 'words cut'));
  const line = el('p', 'line num');
  line.textContent =
    `From ${fmt(posts)} ${posts === 1 ? 'post' : 'posts'}.` +
    (leftAlone ? ` ${fmt(leftAlone)} left as written because Jev wasn't sure or they had something to say.` : '');
  body.append(total, line);
  if (!status.enabled) body.append(el('p', 'line', 'Paused. Posts show as written until you turn it back on.'));
}

document.getElementById('settings').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

toggle.addEventListener('change', async () => {
  render(await send({ type: 'setSettings', patch: { enabled: toggle.checked } }));
  pageLine();
});

// What the content script saw on the current tab. Only LinkedIn tabs answer.
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
      text = "No posts found on this page. If you're on your feed, LinkedIn has probably changed its layout.";
    } else {
      const parts = [
        [n('stamped', 'ready', 'restored'), 'translated'],
        [n('kept'), 'left as written'],
        [n('short'), 'too short'],
        [n('waiting', 'asking', 'expanding', 'new'), 'not read yet'],
        [n('skipped'), 'waiting for a key'],
      ].filter(([count]) => count);
      text = `This page: ${fmt(stats.found)} ${stats.found === 1 ? 'post' : 'posts'} found` + (parts.length ? `, ${parts.map(([count, label]) => `${fmt(count)} ${label}`).join(', ')}.` : '.');
    }
    const line = el('p', 'page num', text);
    body.append(line);
  } catch {
    // Not a LinkedIn tab, or the page was open before the extension was loaded.
  }
}

render(await send({ type: 'status' }));
pageLine();

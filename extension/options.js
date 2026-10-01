const send = (message) => chrome.runtime.sendMessage(message);
const fmt = (n) => n.toLocaleString('en-GB');
const $ = (id) => document.getElementById(id);

function setStatus(text, tone = 'quiet') {
  const node = $('key-status');
  node.textContent = text;
  node.dataset.tone = tone;
}

function describeKey(status) {
  if (!status.hasKey) return setStatus('No key saved yet. Nothing is checked until you add one.', 'quiet');
  if (status.keyState?.status === 401) return setStatus(`The key ending ${status.keyHint} was rejected by TypeSafe. Paste a new one.`, 'bad');
  setStatus(`A key ending ${status.keyHint} is saved.`, status.keyState?.ok ? 'good' : 'quiet');
}

function renderSettings(status) {
  $('threshold').value = Math.round(status.threshold * 100);
  $('threshold-value').textContent = `${Math.round(status.threshold * 100)}%`;
  const { flagged, cleared } = status.stats;
  $('saved-line').textContent = status.saved
    ? `${fmt(status.saved)} ${status.saved === 1 ? 'result is' : 'results are'} saved in this browser, so scrolling past those posts again is instant and free. So far ${fmt(flagged)} marked and ${fmt(cleared)} left alone.`
    : 'Nothing saved yet. Each post is sent once, then its result is kept here.';
  $('forget').disabled = !status.saved;
}

$('reveal').addEventListener('click', () => {
  const input = $('key');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  $('reveal').textContent = showing ? 'Show' : 'Hide';
  $('reveal').setAttribute('aria-pressed', String(!showing));
});

$('key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = $('key').value.trim();
  const save = $('save');
  save.disabled = true;
  setStatus(value ? 'Saving and asking Jev a test question…' : 'Asking Jev a test question with the saved key…', 'quiet');
  const result = value ? await send({ type: 'saveKey', apiKey: value }) : await send({ type: 'testKey' });
  save.disabled = false;
  if (result.ok) {
    $('key').value = '';
    const status = await send({ type: 'status' });
    setStatus(`Key works. Jev (${result.model}) answered in ${fmt(result.ms)} ms. Key ending ${status.keyHint} saved.`, 'good');
  } else if (result.status === 401 || result.status === 403) {
    setStatus(`${result.message} Check it on console.typesafe.ai and paste it again.`, 'bad');
  } else {
    setStatus(result.message || 'Could not test the key.', 'bad');
  }
});

$('threshold').addEventListener('input', () => {
  $('threshold-value').textContent = `${$('threshold').value}%`;
});

$('threshold').addEventListener('change', async () => {
  renderSettings(await send({ type: 'setSettings', patch: { threshold: Number($('threshold').value) / 100 } }));
});

$('forget').addEventListener('click', async () => {
  const status = await send({ type: 'status' });
  if (!confirm(`Forget ${fmt(status.saved)} saved results? Posts you scroll past again will be sent to TypeSafe again.`)) return;
  renderSettings(await send({ type: 'clearSaved' }));
});

const status = await send({ type: 'status' });
describeKey(status);
renderSettings(status);

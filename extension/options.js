import { measure } from './lib/translate.js';

const send = (message) => chrome.runtime.sendMessage(message);
const fmt = (n) => n.toLocaleString('en-GB');
const $ = (id) => document.getElementById(id);

// An example card. The word counts are worked out the same way as on LinkedIn.
const SAMPLE = {
  post:
    "I'm humbled and honoured to share some personal news. After four incredible years, countless late nights and more lessons than I can count, I've decided it's time for a new chapter. Starting Monday, I'll be joining Northwind as Head of Partnerships. None of this would have been possible without the mentors who believed in me when I didn't believe in myself. To my old team: you made me who I am. To my new team: let's build something special. Here's to growth, gratitude and the road ahead.",
  says: 'I got a new job as Head of Partnerships at Northwind.',
};

function renderSample() {
  const words = measure(SAMPLE.post, SAMPLE.says);
  $('sample-was').textContent = SAMPLE.post;
  $('sample-says').textContent = SAMPLE.says;
  $('sample-tally').textContent = `${fmt(words.removed)} words cut, ${words.percent}% shorter`;
}

function setStatus(text, tone = 'quiet') {
  const node = $('key-status');
  node.textContent = text;
  node.dataset.tone = tone;
}

function describeKey(status) {
  if (!status.hasKey) return setStatus('No key saved yet. Posts show as written until you add one.', 'quiet');
  if (status.keyState?.status === 401) return setStatus(`The key ending ${status.keyHint} was rejected by TypeSafe. Paste a new one.`, 'bad');
  setStatus(`A key ending ${status.keyHint} is saved.`, status.keyState?.ok ? 'good' : 'quiet');
}

function renderSettings(status) {
  $('threshold').value = Math.round(status.threshold * 100);
  $('threshold-value').textContent = `${Math.round(status.threshold * 100)}%`;
  $('min-words').value = status.minWords;
  $('auto-load').checked = status.autoLoad !== false;
  const { posts, leftAlone } = status.stats;
  $('saved-line').textContent = status.saved
    ? `${fmt(status.saved)} ${status.saved === 1 ? 'post is' : 'posts are'} saved in this browser, so scrolling past them again is instant and free. So far ${fmt(posts)} translated and ${fmt(leftAlone)} left as written.`
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

$('min-words').addEventListener('change', async () => {
  const value = Number($('min-words').value);
  if (!Number.isFinite(value)) return;
  renderSettings(await send({ type: 'setSettings', patch: { minWords: value } }));
});

$('auto-load').addEventListener('change', async () => {
  renderSettings(await send({ type: 'setSettings', patch: { autoLoad: $('auto-load').checked } }));
});

$('forget').addEventListener('click', async () => {
  const status = await send({ type: 'status' });
  if (!confirm(`Forget ${fmt(status.saved)} saved results? Posts you scroll past again will be sent to TypeSafe again.`)) return;
  renderSettings(await send({ type: 'clearSaved' }));
});

renderSample();
const status = await send({ type: 'status' });
describeKey(status);
renderSettings(status);

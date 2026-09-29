// Runs every post in test/posts.json through Jev with the extension's own request and
// rules, then reports what each post would turn into.
//
//   TYPESAFE_API_KEY=... node scripts/eval.mjs            ask Jev and save the answers
//   node scripts/eval.mjs --offline                       re-score the saved answers (no requests)
//   node scripts/eval.mjs --threshold 0.6                 try a different confidence cut-off

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { askJev } from '../extension/lib/jev.js';
import { buildRequest } from '../extension/lib/questions.js';
import { translate, measure } from '../extension/lib/translate.js';
import { normalise, sha256 } from '../extension/lib/text.js';

// A gitignored .env with TYPESAFE_API_KEY=... works as well as the environment variable.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
} catch {}

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const threshold = args.includes('--threshold') ? Number(args[args.indexOf('--threshold') + 1]) : undefined;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const SAVED = new URL('../test/results/last-eval.json', import.meta.url);
const PRICE_PER_MTOK = 0.042;

const posts = JSON.parse(await readFile(new URL('../test/posts.json', import.meta.url), 'utf8')).filter(
  (p) => !only || p.id.includes(only),
);

let saved = {};
if (offline) saved = JSON.parse(await readFile(SAVED, 'utf8'));
else if (!process.env.TYPESAFE_API_KEY) {
  console.error('Set TYPESAFE_API_KEY, or pass --offline to re-score the last run.');
  process.exit(1);
}

async function run(post) {
  const text = normalise(post.text);
  const body = buildRequest({ text, mentionedOrgs: post.mentions || [] });
  const seed = parseInt((await sha256(text)).slice(0, 8), 16);
  const started = Date.now();
  const response = offline ? saved[post.id] : await askJev(process.env.TYPESAFE_API_KEY, body);
  const ms = offline ? response.ms : Date.now() - started;
  const result = translate(response.answers, { seed, ...(threshold ? { threshold } : {}) });
  if (result.status === 'translated') Object.assign(result, measure(text, result.sentence));
  return { post, response: { ...response, ms }, result };
}

const results = [];
const queue = [...posts];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const post = queue.shift();
      results.push(await run(post));
    }
  }),
);
results.sort((a, b) => posts.indexOf(a.post) - posts.indexOf(b.post));

if (!offline) {
  await mkdir(new URL('../test/results/', import.meta.url), { recursive: true });
  const previous = await readFile(SAVED, 'utf8').then(JSON.parse).catch(() => ({}));
  for (const r of results) previous[r.post.id] = r.response;
  await writeFile(SAVED, JSON.stringify(previous, null, 2));
}

const pct = (n) => `${Math.round(n * 100)}%`;
let right = 0;
let tokens = 0;
const rows = [];
for (const { post, response, result } of results) {
  const a = response.answers;
  const top = Object.entries(a.purpose.probabilities)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([k, p]) => `${k} ${pct(p)}`)
    .join(', ');
  const keepExpected = post.expect.includes('keep');
  const ok = keepExpected
    ? result.status === 'unchanged'
    : result.status === 'translated' && post.expect.includes(result.purpose);
  if (ok) right++;
  tokens += response.usage?.input_tokens || 0;
  const slots = [];
  const got = (id) => (a[id] ? `${a[id].choice} ${pct(a[id].probabilities?.[a[id].choice] ?? a[id].confidence)}` : 'not asked');
  if (post.org) slots.push(`joining want ${post.org} got ${got('slot_joining')}`);
  if (post.role) slots.push(`role want ${post.role} got ${got('slot_role')}`);
  if (post.amount) slots.push(`amount want ${post.amount} got ${got('slot_amount')}`);
  if (post.event) slots.push(`event want ${post.event} got ${got('slot_event')}`);
  slots.push(`topic ${got('topic')}`);
  rows.push(
    [
      `${ok ? 'ok  ' : 'MISS'} ${post.id}  (expect ${post.expect.join(' / ')})`,
      `     purpose: ${top}  | confidence ${pct(a.purpose.confidence)}`,
      `     nouls: sensitive ${pct(a.sensitive.noul)}, engage ${pct(a.extra_asks_engagement.noul)}, selling ${pct(a.extra_selling.noul)}, humblebrag ${pct(a.extra_humblebrag.noul)}`,
      slots.length ? `     ${slots.join(' | ')}` : null,
      result.status === 'translated'
        ? `     => "${result.sentence}"  (${result.removed} words cut, ${result.percent}% shorter${result.grouped ? ', group sentence' : ''})`
        : `     => left as written (${result.reason})`,
      `     ${response.usage?.input_tokens ?? '?'} input tokens, ${response.ms} ms, ${response.model}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

console.log(rows.join('\n\n'));
console.log(
  `\n${right}/${results.length} as expected. ${tokens.toLocaleString()} input tokens in total, ` +
    `about ${Math.round(tokens / results.length)} per post, so roughly $${((tokens / results.length) * 1000 * PRICE_PER_MTOK / 1e6).toFixed(3)} per 1,000 posts.`,
);

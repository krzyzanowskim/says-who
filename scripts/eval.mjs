// Runs every post in test/posts.json through Jev with the extension's own request and
// rules, then reports which ones would get a note and what it would say.
//
//   TYPESAFE_API_KEY=... node scripts/eval.mjs            ask Jev and save the answers
//   node scripts/eval.mjs --offline                       re-score the saved answers (no requests)
//   node scripts/eval.mjs --threshold 0.7                 try a different confidence cut-off

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { askJev } from '../extension/lib/jev.js';
import { buildRequest, buildKnownRequest } from '../extension/lib/questions.js';
import { judge, RULES } from '../extension/lib/verdict.js';
import { normalise, mentionsAI } from '../extension/lib/text.js';

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
  // The same check the extension makes before it sends anything.
  if (!mentionsAI(text) && !mentionsAI(`${post.author}\n${post.handle}\n${post.bio}\n${post.label}\n${post.link}`)) return { post, result: { status: 'unchanged', reason: 'not-ai' } };
  const body = buildRequest({ text, author: { name: post.author, handle: post.handle, bio: post.bio, label: post.label, link: post.link } });
  const started = Date.now();
  const response = offline ? saved[post.id] : await askJev(process.env.TYPESAFE_API_KEY, body);
  const opts = threshold ? { threshold } : {};
  let result = judge(response.answers, opts);
  // Like the extension: who the account is gets asked only when nothing else settles it.
  if (result.askKnown) {
    if (!offline) response.answers.known = (await askJev(process.env.TYPESAFE_API_KEY, buildKnownRequest({ handle: post.handle, name: post.author }))).answers.known;
    if (response.answers.known) result = judge(response.answers, opts);
  }
  const ms = offline ? response.ms : Date.now() - started;
  return { post, response: { ...response, ms }, result };
}

const results = [];
const queue = [...posts];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) results.push(await run(queue.shift()));
  }),
);
results.sort((a, b) => posts.indexOf(a.post) - posts.indexOf(b.post));

if (!offline) {
  await mkdir(new URL('../test/results/', import.meta.url), { recursive: true });
  const previous = await readFile(SAVED, 'utf8').then(JSON.parse).catch(() => ({}));
  for (const r of results) if (r.response) previous[r.post.id] = r.response;
  await writeFile(SAVED, JSON.stringify(previous, null, 2));
}

const pct = (n) => `${Math.round(n * 100)}%`;
const top3 = (answer) =>
  Object.entries(answer.probabilities)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([k, p]) => `${k} ${pct(p)}`)
    .join(', ');

let right = 0;
let tokens = 0;
let asked = 0;
const rows = [];
for (const { post, response, result } of results) {
  // The one invented "well-known" account exists for the browser test's mock; real Jev should not know it.
  const want = post.mockKnown ? 'kept' : post.expect;
  const ok = want === 'flagged' ? result.status === 'flagged' && result.stake === post.stake && result.source === post.source : result.status === 'unchanged';
  if (ok) right++;
  const lines = [`${ok ? 'ok  ' : 'MISS'} ${post.id}  (expect ${want}${want === 'flagged' ? `, ${post.stake}, from the ${post.source}` : ''})`];
  if (response) {
    const a = response.answers;
    asked++;
    tokens += response.usage?.input_tokens || 0;
    lines.push(`     take: ${top3(a.take)}`, `     stake: ${top3(a.stake)}`, `     stated in: ${top3(a.basis)}`);
    if (a.known) lines.push(`     known: ${top3(a.known)}`);
    if (a.org) lines.push(`     org: ${post.org ? `want ${post.org}, ` : ''}got ${a.org.choice} ${pct(a.org.probabilities?.[a.org.choice] ?? a.org.confidence)}`);
  }
  lines.push(result.status === 'flagged' ? `     => "${result.sentence}"  (${pct(result.confidence)} sure, from the ${result.source})` : `     => left alone (${result.reason})`);
  if (response) lines.push(`     ${response.usage?.input_tokens ?? '?'} input tokens, ${response.ms} ms, ${response.model}`);
  rows.push(lines.join('\n'));
}

console.log(rows.join('\n\n'));
console.log(
  `\n${right}/${results.length} as expected. ${asked} sent to Jev, ${tokens.toLocaleString()} input tokens in total` +
    (asked ? `, about ${Math.round(tokens / asked)} per post, so roughly $${(((tokens / asked) * 1000 * PRICE_PER_MTOK) / 1e6).toFixed(3)} per 1,000 posts sent.` : '.'),
);

// Recognition on its own: well-known AI accounts must clear the bar, and everyone else,
// famous or not, must stay under it. Skipped offline and with --only.
if (!offline && !only) {
  const accounts = JSON.parse(await readFile(new URL('../test/accounts.json', import.meta.url), 'utf8'));
  let good = 0;
  console.log('\nWell-known accounts (needs ' + pct(RULES.known) + '):');
  for (const account of accounts) {
    const { answers } = await askJev(process.env.TYPESAFE_API_KEY, buildKnownRequest(account));
    const p = answers.known.probabilities.ai_insider || 0;
    const ok = (p >= RULES.known) === (account.expect === 'insider');
    if (ok) good++;
    console.log(`${ok ? 'ok  ' : 'MISS'} @${account.handle.padEnd(16)} ${pct(p).padStart(4)} insider  (expect ${account.expect})`);
  }
  console.log(`${good}/${accounts.length} as expected.`);
}

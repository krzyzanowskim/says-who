import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, findAmounts, findOrgs, findNames, findRoles, findYears, normalise } from '../extension/lib/text.js';
import { translate, measure, RULES } from '../extension/lib/translate.js';
import { buildRequest } from '../extension/lib/questions.js';
import { PURPOSES, GROUPS, SPECIFIC } from '../extension/lib/intents.js';

test('counts words, not emoji or bullets', () => {
  assert.equal(countWords('I got a new job.'), 5);
  assert.equal(countWords('🚀 Big news 👇\n\n• one\n• two'), 4);
  assert.equal(countWords('#hiring #AI'), 2);
  assert.equal(countWords(''), 0);
});

test('normalises whitespace without losing paragraphs', () => {
  assert.equal(normalise('  a  b \n\n\n\n c  '), 'a b\n\nc');
});

test('finds money amounts verbatim', () => {
  assert.deepEqual(findAmounts('We raised a $14M Series A, taking total funding to $20.5 million.'), ['$14M', '$20.5 million']);
  assert.deepEqual(findAmounts('A £2.5m seed round and €300k from angels'), ['£2.5m', '€300k']);
  assert.deepEqual(findAmounts('No numbers here'), []);
});

test('finds organisations, names, job titles and years', () => {
  const text =
    "Starting Monday, I'll be joining Northwind as Head of Partnerships after four years at Halcyon Freight. See you at DevHarbour Summit. We moved to Node.js last year.";
  assert.deepEqual(findOrgs(text, ['Northwind']).slice(0, 2), ['Northwind', 'Halcyon Freight']);
  const names = findNames(text);
  for (const name of ['Northwind', 'Head of Partnerships', 'Halcyon Freight', 'DevHarbour Summit', 'Node.js']) assert.ok(names.includes(name), name);
  assert.ok(!names.includes('Starting Monday') && !names.includes('See'));
  assert.deepEqual(findRoles("I've been promoted to Engineering Manager at Quillpoint."), ['Engineering Manager']);
  assert.deepEqual(findYears('5 years at Halcyon, and ten years in freight'), ['5 years', 'ten years']);
});

test('buildRequest asks the purpose, topic and nouls, plus a slot only when it has candidates', () => {
  const plain = buildRequest({ text: 'leadership is a verb.' });
  assert.equal(plain.model, 'jev-latest');
  assert.deepEqual(plain.state, { post: 'leadership is a verb.' });
  assert.deepEqual(Object.keys(plain.questions).sort(), ['extra_asks_engagement', 'extra_humblebrag', 'extra_selling', 'purpose', 'sensitive', 'topic']);
  assert.equal(Object.keys(plain.questions.purpose.criteria).length, Object.keys(PURPOSES).length);

  const rich = buildRequest({ text: 'Thrilled to join Northwind as Head of Growth after we raised $14M.', mentionedOrgs: ['Northwind'] });
  assert.ok('Northwind' in rich.questions.slot_joining.criteria);
  assert.ok('none_of_these' in rich.questions.slot_joining.criteria);
  assert.ok('Head of Growth' in rich.questions.slot_role.criteria);
  assert.ok('$14M' in rich.questions.slot_amount.criteria);
});

// A Choice answer with `winner` at probability p and the rest spread over `others`.
const choice = (winner, p, others = {}) => ({
  type: 'choice',
  choice: winner,
  confidence: p,
  probabilities: { [winner]: p, ...others },
});

test('every kind has a group, a wording and a real group', () => {
  for (const [id, p] of Object.entries(PURPOSES)) {
    assert.ok(GROUPS[p.group], `${id} has group ${p.group}`);
    if (p.group === 'keep') continue;
    assert.ok(p.says.length, id);
    for (const s of p.says) assert.match(s, /[.?]$/, id);
  }
  for (const id of Object.keys(SPECIFIC)) assert.ok(PURPOSES[id], `specific sentence for unknown kind ${id}`);
});

test('translates a confident answer into one of its fixed wordings, the same one for the same seed', () => {
  const answers = { purpose: choice('product_launch', 0.9), sensitive: { noul: 0.01 } };
  const a = translate(answers, { seed: 0 });
  const b = translate(answers, { seed: 1 });
  assert.equal(a.status, 'translated');
  assert.deepEqual([a.sentence, b.sentence].sort(), [...PURPOSES.product_launch.says].sort());
  assert.equal(translate(answers, { seed: 0 }).sentence, a.sentence);
});

test('falls back to the group sentence when Jev is split between close kinds', () => {
  const out = translate({ purpose: choice('ai_take', 0.4, { prediction: 0.35, opinion: 0.2 }) });
  assert.equal(out.status, 'translated');
  assert.equal(out.sentence, 'I have an opinion.');
  assert.equal(out.grouped, true);
});

test('leaves unsure, real-content and sensitive posts alone', () => {
  assert.equal(translate({ purpose: choice('new_job', 0.3, { hiring: 0.3, opinion: 0.3 }) }).reason, 'unsure');
  assert.equal(translate({ purpose: choice('substantive', 0.9) }).reason, 'real-content');
  assert.equal(translate({ purpose: choice('personal_life', 0.9) }).reason, 'real-content');
  assert.equal(translate({ purpose: choice('generic_advice', 0.6, { substantive: 0.35 }) }).reason, 'maybe-real-content');
  assert.equal(translate({ purpose: choice('new_job', 0.95), sensitive: { noul: 0.7 } }).reason, 'sensitive');
  assert.equal(translate({}).reason, 'no-answer');
});

test('the threshold setting moves the cut-off', () => {
  const answers = { purpose: choice('hiring', 0.62, { opinion: 0.38 }) };
  assert.equal(translate(answers, { threshold: 0.5 }).status, 'translated');
  assert.equal(translate(answers, { threshold: 0.7 }).status, 'unchanged');
});

test('adds extra sentences for clear nouls, never repeating the main one', () => {
  const out = translate({
    purpose: choice('new_job', 0.9),
    extra_asks_engagement: { noul: 0.95 },
    extra_selling: { noul: 0.4 },
    extra_humblebrag: { noul: 0.85 },
  });
  assert.match(out.sentence, /^I (got|started) a new job\. I'd like you to be impressed\. Please engage with this post\.$/);

  const bait = translate({ purpose: choice('engagement_bait', 0.9), extra_asks_engagement: { noul: 0.99 } });
  assert.equal(bait.sentence, 'Please engage with this post.');

  const edge = translate({ purpose: choice('selling', 0.9), extra_asks_engagement: { noul: RULES.extra - 0.01 } }, { seed: 0 });
  assert.equal(edge.sentence, 'Please buy my thing.');
});

test('fills specific sentences with copied details only when Jev is sure of them', () => {
  const job = translate({
    purpose: choice('new_job', 0.9),
    slot_joining: choice('Northwind', 0.85),
    slot_role: choice('Head of Partnerships', 0.8),
  });
  assert.equal(job.sentence, 'I got a new job as Head of Partnerships at Northwind.');
  assert.equal(job.specific, true);

  const noRole = translate({ purpose: choice('new_job', 0.9), slot_joining: choice('Northwind', 0.85), slot_role: choice('Head of Partnerships', 0.4) });
  assert.equal(noRole.sentence, 'I got a new job at Northwind.');

  const none = translate({ purpose: choice('new_job', 0.9), slot_joining: choice('none_of_these', 0.9) }, { seed: 0 });
  assert.equal(none.sentence, 'I got a new job.');

  assert.equal(translate({ purpose: choice('fundraising', 0.9), slot_amount: choice('$14M', 0.9) }).sentence, 'We raised $14M.');
  assert.equal(translate({ purpose: choice('promotion', 0.9), slot_role: choice('Engineering Manager', 0.9) }).sentence, 'I got promoted to Engineering Manager.');
  assert.equal(translate({ purpose: choice('opinion', 0.9), topic: choice('remote work', 0.8) }).sentence, 'I have an opinion about remote work.');
  assert.equal(translate({ purpose: choice('event_recap', 0.9), slot_event: choice('SaaSConnect Lisbon', 0.9) }).sentence, 'I went to SaaSConnect Lisbon.');
  // A slot answer is only used by the kinds that have a sentence for it.
  assert.match(translate({ purpose: choice('hiring', 0.9), slot_joining: choice('Northwind', 0.9) }, { seed: 0 }).sentence, /^We('re hiring| have jobs going)\.$/);
});

test('promoted posts say so first', () => {
  const out = translate({ purpose: choice('product_launch', 0.9) }, { sponsored: true, seed: 0 });
  assert.equal(out.sentence, 'This is an ad. We launched something.');
  assert.equal(translate({ purpose: choice('advert', 0.9) }, { sponsored: true }).sentence, 'This is an ad.');
});

test('measures words removed and the compression', () => {
  const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
  assert.deepEqual(measure(text, 'I got a new job.'), { before: 100, after: 5, removed: 95, percent: 95 });
  assert.deepEqual(measure('short', 'I got a new job.'), { before: 1, after: 5, removed: 0, percent: 0 });
});

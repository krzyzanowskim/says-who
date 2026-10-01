import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOrgs, findNames, findMentions, findWares, mentionsAI, normalise } from '../extension/lib/text.js';
import { judge, paidAuthor, RULES } from '../extension/lib/verdict.js';
import { buildRequest, buildKnownRequest, candidates } from '../extension/lib/questions.js';
import { TAKES, STAKES, PAID } from '../extension/lib/stakes.js';

test('normalises whitespace without losing paragraphs', () => {
  assert.equal(normalise('  a  b \n\n\n\n c  '), 'a b\n\nc');
  assert.equal(normalise(undefined), '');
});

test('spots posts that might be about AI, and lets the rest go unsent', () => {
  for (const text of ['AI will replace us', 'ai is overhyped', 'GPT-5 is here', 'our new LLM', 'tried Claude today', 'Artificial intelligence, eh', 'agentic workflows'])
    assert.ok(mentionsAI(text), text);
  // Agentic work counts, however it is described.
  for (const text of ['my agents shipped three PRs overnight', 'running a swarm of subagents', 'Codex did the refactor', 'wired it up over MCP']) assert.ok(mentionsAI(text), text);
  // The shop talk of people who never say "AI".
  for (const text of ['One prompt. No edits.', 'a thousand dollars of tokens a day', 'Saw the internal demo last night', 'that is a skill issue', 'before asking for headcount']) assert.ok(mentionsAI(text), text);
  // Takes about AI that never name it.
  for (const text of ['Coding is solved.', 'programming is over', 'Software engineering as a job is dead in two years', 'the end of programming', 'Nobody will write code by hand', 'I no longer write any code', 'developers will be replaced'])
    assert.ok(mentionsAI(text), text);
  for (const text of ['It rained again', 'I love coding on Sundays', 'Fixed the build, shipping tomorrow', 'I said hi to the team', 'The main thing is to maintain it', 'Aim higher']) assert.ok(!mentionsAI(text), text);
});

test('finds the organisations a bio names', () => {
  assert.deepEqual(findMentions('Research @NorthwindAI. prev @halcyon, mail me@example.com'), ['@NorthwindAI', '@halcyon']);
  assert.deepEqual(findOrgs('General Partner at Tidewater Ventures. Investing in AI.'), ['Tidewater Ventures']);
  assert.ok(findNames('Founder, Brightloop (AI copilots for lawyers).').includes('Brightloop'));
  const list = candidates({ bio: 'Co-founder & CEO @lumenagents. Prev eng at Halcyon.', label: 'Lumen' });
  assert.deepEqual(list.slice(0, 3), ['Lumen', '@lumenagents', 'Halcyon']);
  assert.deepEqual(candidates({ bio: '' }), []);
});

test('buildRequest sends the post and the profile, and asks for an organisation only when the profile names one', () => {
  const plain = buildRequest({ text: 'ai is a bubble.', author: { name: 'Jo', bio: 'dog person' } });
  assert.equal(plain.model, 'jev-latest');
  assert.deepEqual(plain.state, { post: 'ai is a bubble.', author_name: 'Jo', author_handle: '', author_bio: 'dog person' });
  assert.deepEqual(Object.keys(plain.questions).sort(), ['basis', 'stake', 'take']);
  assert.equal(Object.keys(plain.questions.take.criteria).length, Object.keys(TAKES).length);
  assert.equal(Object.keys(plain.questions.stake.criteria).length, Object.keys(STAKES).length);

  const rich = buildRequest({ text: 'AGI by 2028. We see it daily at Halcyon Labs.', author: { name: 'Dana', handle: 'dana', bio: 'CEO @lumenagents', label: 'Lumen', link: 'lumenagents.ai' } });
  assert.equal(rich.state.author_handle, '@dana');
  assert.ok('Halcyon Labs' in rich.questions.org.criteria, 'a company named in the post is a candidate too');
  assert.equal(rich.state.author_badge, 'Lumen');
  assert.equal(rich.state.author_link, 'lumenagents.ai');
  assert.ok('@lumenagents' in rich.questions.org.criteria && 'Lumen' in rich.questions.org.criteria);
  assert.ok('none_of_these' in rich.questions.org.criteria);
  assert.match(rich.questions.stake.instructions.question, /`author_badge`/);
});

test('every kind has criteria, and every paid kind has both wordings', () => {
  for (const [id, t] of Object.entries(TAKES)) assert.ok(t.criteria, id);
  for (const [id, s] of Object.entries(STAKES)) {
    assert.ok(s.criteria, id);
    if (!s.paid) continue;
    assert.match(s.says, /\.$/, id);
    for (const t of s.templates || []) assert.match(t, /^Says .*\{(org|product)\}.*\.$/, id);
  }
});

// A Choice answer with `winner` at probability p and the rest spread over `others`.
const choice = (winner, p, others = {}) => ({
  type: 'choice',
  choice: winner,
  confidence: p,
  probabilities: { [winner]: p, ...others },
});

test('marks an AI opinion from someone whose profile says they are paid by AI', () => {
  const out = judge({ take: choice('prediction', 0.9), stake: choice('founder', 0.85), org: choice('@lumenagents', 0.9) });
  assert.equal(out.status, 'flagged');
  assert.equal(out.sentence, 'Says someone whose company sells it.');
  assert.equal(out.stake, 'founder');
  assert.equal(out.take, 'prediction');
  assert.equal(out.confidence, 0.85);
});

test('names the organisation only when Jev is sure of it', () => {
  assert.equal(judge({ take: choice('hype', 0.9), stake: choice('employee', 0.9), org: choice('Northwind AI', 0.4) }).sentence, 'Says someone whose paycheck depends on it.');
  assert.equal(judge({ take: choice('hype', 0.9), stake: choice('employee', 0.9), org: choice('none_of_these', 0.9) }).sentence, 'Says someone whose paycheck depends on it.');
  assert.equal(judge({ take: choice('hype', 0.9), stake: choice('employee', 0.9) }).sentence, 'Says someone whose paycheck depends on it.');
  assert.equal(judge({ take: choice('hype', 0.9), stake: choice('investor', 0.9), org: choice('Tidewater Ventures', 0.8) }).sentence, 'Says someone whose money is riding on it.');
  // What someone sells is rarely a name the bio spells out cleanly, so that sentence stays plain.
  assert.equal(judge({ take: choice('urging', 0.9), stake: choice('seller', 0.9), org: choice('The Prompt Academy', 0.9) }).sentence, 'Says someone with AI to sell you.');
});

test('adds up near-synonyms, and falls back to the plain sentence when split on how they are paid', () => {
  const split = judge({ take: choice('hype', 0.4, { prediction: 0.3, jobs: 0.2 }), stake: choice('founder', 0.45, { seller: 0.4 }), org: choice('Brightloop', 0.9) });
  assert.equal(split.status, 'flagged');
  assert.equal(split.grouped, true);
  assert.equal(split.sentence, PAID);
  assert.equal(split.org, null);
});

test('leaves everything else alone', () => {
  const paid = choice('employee', 0.9);
  assert.equal(judge({ take: choice('not_ai', 0.95), stake: paid }).reason, 'not-an-opinion');
  assert.equal(judge({ take: choice('announcement', 0.8, { hype: 0.15 }), stake: paid }).reason, 'not-an-opinion');
  assert.equal(judge({ take: choice('information', 0.7), stake: paid }).reason, 'not-an-opinion');
  assert.equal(judge({ take: choice('hype', 0.5, { announcement: 0.5 }), stake: paid }).reason, 'unsure');
  assert.equal(judge({ take: choice('hype', 0.9), stake: choice('researcher', 0.8) }).reason, 'no-stake');
  assert.equal(judge({ take: choice('prediction', 0.9), stake: choice('user', 0.8) }).reason, 'no-stake');
  // Criticism and policy arguments earn no note, whoever makes them.
  for (const kind of ['criticism', 'policy', 'compute']) assert.equal(judge({ take: choice(kind, 0.95), stake: paid }).reason, 'not-an-opinion', kind);
  assert.equal(judge({ take: choice('jobs', 0.9), stake: choice('unstated', 0.9) }).reason, 'no-stake');
  assert.equal(judge({ take: choice('jobs', 0.9), stake: choice('seller', 0.5, { unstated: 0.5 }) }).reason, 'unsure');
  assert.equal(judge({ take: choice('jobs', 0.9) }).reason, 'no-answer');
  assert.equal(judge({}).reason, 'no-answer');
});

test('the question about a well-known account carries no post and no bio', () => {
  const body = buildKnownRequest({ handle: 'dana', name: 'Dana Whitlock' });
  assert.deepEqual(body.state, { author_handle: '@dana', author_name: 'Dana Whitlock' });
  assert.deepEqual(Object.keys(body.questions), ['known']);
});

test('says where the stake is stated: the profile or the post', () => {
  const answers = { take: choice('jobs', 0.9), stake: choice('founder', 0.9) };
  assert.equal(judge(answers).source, 'profile');
  assert.equal(judge({ ...answers, basis: choice('profile', 0.9) }).source, 'profile');
  assert.equal(judge({ ...answers, basis: choice('post', 0.8) }).source, 'post');
  // "Neither" as the top pick but not the likelier half: the profile and the post together still outweigh it.
  assert.equal(judge({ ...answers, basis: choice('neither', 0.4, { post: 0.35, profile: 0.25 }) }).status, 'flagged');
});

test('a stake nobody states is not taken on trust', () => {
  const answers = { take: choice('jobs', 0.9), stake: choice('founder', 0.9), basis: choice('neither', 0.8) };
  const out = judge(answers);
  assert.equal(out.reason, 'unstated');
  assert.equal(out.askKnown, true);
  assert.equal(judge({ take: choice('not_ai', 0.9), stake: choice('unstated', 0.9) }).askKnown, undefined, 'only opinions about AI are worth a second question');
  const professor = { take: choice('prediction', 0.9), stake: choice('researcher', 0.9), basis: choice('profile', 0.9) };
  assert.equal(judge(professor).askKnown, false, 'a profile that states other work is taken at its word');
  assert.equal(judge({ ...professor, known: choice('ai_insider', 0.99) }).status, 'unchanged');
});

test('a well-known account counts only when Jev is very sure, and gets the plain sentence', () => {
  const quiet = { take: choice('hype', 0.9), stake: choice('unstated', 0.9), basis: choice('neither', 0.9) };
  assert.equal(judge(quiet).askKnown, true);
  const sure = judge({ ...quiet, known: choice('ai_insider', 0.98) });
  assert.equal(sure.status, 'flagged');
  assert.equal(sure.source, 'known');
  assert.equal(sure.sentence, PAID);
  for (const known of [choice('ai_insider', 0.85, { unknown: 0.15 }), choice('other_public', 0.56, { ai_insider: 0.43 }), choice('unknown', 0.99)]) {
    const out = judge({ ...quiet, known });
    assert.equal(out.status, 'unchanged');
    assert.equal(out.askKnown, false, 'never asked twice');
  }
  assert.ok(RULES.known >= 0.9);
});

test('an author is remembered only on grounds that outlast one post', () => {
  const employee = choice('employee', 0.95);
  assert.equal(paidAuthor({ take: choice('not_ai', 0.9), stake: employee, basis: choice('profile', 0.9) }), true);
  assert.equal(paidAuthor({ take: choice('jobs', 0.9), stake: employee, basis: choice('post', 0.9) }), false);
  assert.equal(paidAuthor({ take: choice('jobs', 0.9), stake: choice('unstated', 0.9), basis: choice('neither', 0.9), known: choice('ai_insider', 0.98) }), true);
  assert.equal(paidAuthor({ take: choice('jobs', 0.9), stake: choice('user', 0.9), basis: choice('profile', 0.9) }), false);
  assert.equal(paidAuthor({}), false);
});

test('finds what someone sells, in their own words', () => {
  assert.deepEqual(findWares('THE FUTURE OF AGENTIC TESTING IS HERE 🤯🤯\n\n→ combines deterministic and agentic APIs'), ['AGENTIC TESTING', 'agentic APIs']);
  assert.deepEqual(findWares('Founder, Brightloop (AI copilots for lawyers). Mum of two.'), ['AI copilots for lawyers', 'AI copilots']);
  assert.deepEqual(findWares('Building Lumen, the AI software engineer.'), ['AI software engineer']);
  assert.deepEqual(findWares('where we build LLMs for search'), ['LLMs for search']);
  assert.deepEqual(findWares('We ship coding agents to every customer'), ['coding agents', 'ship coding agents']);
  assert.ok(findWares('who is creating the personal ai agent for whimsy and fun').includes('personal ai agent'));
  assert.deepEqual(findWares('AI is here. I love coding.'), []);
  assert.deepEqual(findWares('building new AI products for 25M MAU @GoodSystemsHQ'), ['AI products']);
});

test('a founder or seller is named by what they sell when Jev is sure of it', () => {
  const base = { take: choice('agents', 0.9), stake: choice('founder', 0.9), org: choice('TesterArmy', 0.95) };
  assert.equal(judge({ ...base, wares: choice('AGENTIC TESTING', 0.9) }).sentence, 'Says the person selling AGENTIC TESTING.');
  assert.equal(judge({ ...base, wares: choice('AGENTIC TESTING', 0.4) }).sentence, 'Says someone whose company sells it.');
  assert.equal(judge({ ...base, wares: choice('none_of_these', 0.9) }).sentence, 'Says someone whose company sells it.');
  assert.equal(judge({ take: choice('urging', 0.9), stake: choice('seller', 0.9), wares: choice('AI courses', 0.9) }).sentence, 'Says someone selling AI courses.');
  assert.equal(judge({ ...base, wares: choice('AI software engineer', 0.9) }).sentence, 'Says the person selling an AI software engineer.');
  assert.equal(judge({ ...base, wares: choice('personal ai agent', 0.9) }).sentence, 'Says the person selling a personal ai agent.');
  // Someone on the payroll builds it; failing that, the note says who signs the paycheck.
  const staff = { take: choice('hype', 0.9), stake: choice('employee', 0.9), org: choice('Northwind AI', 0.9) };
  assert.equal(judge({ ...staff, wares: choice('AI agents', 0.9) }).sentence, 'Says someone paid to build AI agents.');
  assert.equal(judge(staff).sentence, 'Says someone whose paycheck comes from Northwind AI.');
  assert.equal(judge(staff).org, 'Northwind AI');
});

test('the threshold setting moves the cut-off', () => {
  const answers = { take: choice('hype', 0.7, { information: 0.3 }), stake: choice('employee', 0.9) };
  assert.equal(judge(answers, { threshold: 0.6 }).status, 'flagged');
  assert.equal(judge(answers, { threshold: 0.8 }).status, 'unchanged');
  assert.ok(RULES.threshold > 0.5, 'the default needs more than a coin flip');
});

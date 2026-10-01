import { TAKES, STAKES, PAID, NONE } from './stakes.js';

// Rules that turn Jev's answers into a note. All of this is ordinary code, so changing
// a threshold never needs a new request.
export const RULES = {
  // Probability Jev must put on "this is an opinion about AI" and, separately, on "the
  // profile says this person is paid by AI" before a post gets a note. The settings
  // page can change it.
  threshold: 0.6,
  // Among the paid kinds, the top one needs this share of their probability to get its
  // own sentence. Otherwise the plain "Makes money from AI." is used.
  within: 0.6,
  // The organisation, or the name of what they sell, is copied into the sentence only
  // when its Choice puts this much probability on one candidate.
  org: 0.6,
  // With nothing stated on the profile or in the post, Jev's own recognition of a
  // well-known account counts only when it is this sure. Deliberately strict: it has to
  // clear people who are famous, opinionated about AI, and not paid by it.
  known: 0.9,
};

const unchanged = (reason, extra = {}) => ({ status: 'unchanged', reason, ...extra });

const top = (answer) => (answer ? answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0 : 0);
const probsOf = (answer) => answer.probabilities || { [answer.choice]: answer.confidence ?? 1 };
const massOf = (probs, ids) => ids.reduce((sum, id) => sum + (probs[id] || 0), 0);
const best = (probs, ids) => ids.reduce((a, b) => ((probs[b] || 0) > (probs[a] || 0) ? b : a));

const OPINIONS = Object.keys(TAKES).filter((id) => TAKES[id].opinion);
const PAID_KINDS = Object.keys(STAKES).filter((id) => STAKES[id].paid);

// "selling AI software engineer" needs its article. The copied words themselves stay as written.
const SINGULAR = /\b(?:agent|copilot|assistant|chatbot|model|engineer|developer|tool|platform|app|product)$/i;
const withArticle = (phrase) => (SINGULAR.test(phrase) ? `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}` : phrase);

// Is the author paid by AI, and what is that resting on? Independent of what the post says.
function stakeOf({ stake, org, wares, basis, known }, threshold) {
  const stakes = probsOf(stake);
  const paid = massOf(stakes, PAID_KINDS);
  // A stake needs something to rest on: the profile, the author's own words, or a well-known name.
  // `silent` is when Jev finds it more likely than not that neither says what the author does.
  const silent = basis ? (probsOf(basis).neither || 0) > 0.5 : true;
  const stated = !basis || !silent;
  const recognised = known && silent ? probsOf(known).ai_insider || 0 : 0;

  if (paid < threshold || !stated) {
    if (recognised >= RULES.known) return { paid: true, stake: 'known', source: 'known', grouped: false, org: null, confidence: recognised, sentence: PAID };
    const reason = paid >= threshold ? 'unstated' : STAKES[stake.choice]?.paid ? 'unsure' : 'no-stake';
    // `silent` with no answer yet about who the account is: the one thing left to try.
    return { paid: false, reason, stake: stake.choice, confidence: paid, canAskKnown: silent && !known };
  }

  const kind = best(stakes, PAID_KINDS);
  const grouped = (stakes[kind] || 0) / paid < RULES.within;
  const sure = (answer) => (answer && answer.choice !== NONE && top(answer) >= RULES.org ? answer.choice : null);
  const slots = { product: sure(wares), org: sure(org) };
  let sentence = grouped ? PAID : STAKES[kind].says;
  let used = null;
  for (const template of grouped ? [] : STAKES[kind].templates || []) {
    const slot = /\{(\w+)\}/.exec(template)[1];
    if (!slots[slot]) continue;
    sentence = template.replace(`{${slot}}`, slot === 'product' ? withArticle(slots[slot]) : slots[slot]);
    used = slot;
    break;
  }
  return {
    paid: true,
    stake: kind,
    // Where it is stated, so the line under the note can say what to check.
    source: basis?.choice === 'post' ? 'post' : 'profile',
    // True when Jev was sure the author is paid by AI but not exactly how.
    grouped,
    org: used === 'org' ? slots.org : null,
    product: used === 'product' ? slots.product : null,
    confidence: paid,
    sentence,
  };
}

// Whether this author is paid by AI on grounds that hold beyond the one post: their
// profile, or who the account is. What someone says about themselves in a single post
// doesn't count here.
export function paidAuthor(answers, { threshold = RULES.threshold } = {}) {
  if (!answers?.stake) return false;
  const who = stakeOf(answers, threshold);
  return who.paid && who.source !== 'post';
}

export function judge(answers, { threshold = RULES.threshold } = {}) {
  const { take, stake } = answers || {};
  if (!take || !stake) return unchanged('no-answer');

  // Add up Jev's probabilities across the opinion kinds, so near-synonyms don't split the vote.
  const takes = probsOf(take);
  const opinion = massOf(takes, OPINIONS);
  if (opinion < threshold) return unchanged(TAKES[take.choice]?.opinion ? 'unsure' : 'not-an-opinion', { take: take.choice, confidence: opinion });

  const who = stakeOf(answers, threshold);
  if (!who.paid) {
    // Asking who the account is costs a request, so it is kept for opinions about AI.
    return unchanged(who.reason, { take: take.choice, stake: who.stake, confidence: who.confidence, askKnown: who.canAskKnown });
  }
  const { paid, confidence, ...rest } = who;
  return { status: 'flagged', take: best(takes, OPINIONS), ...rest, opinion, paid: confidence, confidence: Math.min(opinion, confidence) };
}

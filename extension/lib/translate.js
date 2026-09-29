import { PURPOSES, GROUPS, EXTRAS, SPECIFIC, PROMOTED, NONE } from './intents.js';
import { SLOTS } from './questions.js';
import { countWords } from './text.js';

// Rules that turn Jev's answers into a translation. All of this is ordinary code,
// so changing a threshold never needs a new request.
export const RULES = {
  // Probability Jev must put on one group of kinds before a post is translated.
  // The settings page can change it.
  threshold: 0.5,
  // Inside that group, the top kind needs this share of the group's probability to
  // get its own sentence. Otherwise the group's sentence is used.
  within: 0.6,
  // If Jev puts this much probability on "real content" or "personal life", leave the post alone.
  keepShare: 0.3,
  // A Noul has to be at least this likely before its extra sentence is added.
  extra: 0.8,
  // Posts about grief, illness or hardship are skipped above this probability.
  sensitive: 0.5,
  // A copied detail (a company, a title, an amount) needs its Choice to put this much
  // probability on one candidate before it goes into a sentence.
  slot: 0.6,
  topic: 0.55,
};

const unchanged = (reason, extra = {}) => ({ status: 'unchanged', reason, ...extra });

const top = (answer) => (answer ? answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0 : 0);

function readSlots(answers) {
  const slots = {};
  for (const id of Object.keys(SLOTS)) {
    const answer = answers[`slot_${id}`];
    if (answer && answer.choice !== NONE && top(answer) >= RULES.slot) slots[id] = answer.choice;
  }
  const topic = answers.topic;
  if (topic && topic.choice !== NONE && top(topic) >= RULES.topic) slots.topic = topic.choice;
  return slots;
}

function fill(template, slots) {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!slots[key]) missing = true;
    return slots[key] || '';
  });
  return missing ? null : out;
}

function sentenceFor(id, slots, seed) {
  for (const template of SPECIFIC[id] || []) {
    const sentence = fill(template, slots);
    if (sentence) return { sentence, specific: true };
  }
  const says = PURPOSES[id].says;
  return { sentence: says[seed % says.length], specific: false };
}

export function translate(answers, { threshold = RULES.threshold, seed = 0, sponsored = false } = {}) {
  const purpose = answers?.purpose;
  if (!purpose) return unchanged('no-answer');
  if ((answers.sensitive?.noul ?? 0) >= RULES.sensitive) return unchanged('sensitive', { purpose: purpose.choice });

  // Add up Jev's probabilities by group, so near-synonyms don't split the vote.
  const probs = purpose.probabilities || { [purpose.choice]: purpose.confidence ?? 1 };
  const mass = {};
  for (const [id, p] of Object.entries(PURPOSES)) mass[p.group] = (mass[p.group] || 0) + (probs[id] || 0);

  if (PURPOSES[purpose.choice]?.group === 'keep') return unchanged('real-content', { purpose: purpose.choice });
  if ((mass.keep || 0) >= RULES.keepShare) return unchanged('maybe-real-content', { purpose: purpose.choice });

  const group = Object.keys(GROUPS)
    .filter((g) => g !== 'keep')
    .reduce((a, b) => ((mass[b] || 0) > (mass[a] || 0) ? b : a));
  const sure = mass[group] || 0;
  if (sure < threshold) return unchanged('unsure', { purpose: purpose.choice, confidence: sure });

  const kinds = Object.keys(PURPOSES).filter((id) => PURPOSES[id].group === group);
  const best = kinds.reduce((a, b) => ((probs[b] || 0) > (probs[a] || 0) ? b : a));
  const share = (probs[best] || 0) / sure;

  let main;
  let specific = false;
  if (share >= RULES.within) ({ sentence: main, specific } = sentenceFor(best, readSlots(answers), seed));
  else main = GROUPS[group].says;

  const sentences = [];
  if (sponsored && best !== 'advert') sentences.push(PROMOTED);
  sentences.push(main);

  const extras = [];
  for (const [id, extra] of Object.entries(EXTRAS)) {
    const answer = answers[`extra_${id}`];
    if (!answer || answer.noul < RULES.extra) continue;
    if (extra.sameAs?.includes(best) || extra.sameAsGroup === group || sentences.includes(extra.says)) continue;
    sentences.push(extra.says);
    extras.push(id);
  }

  return {
    status: 'translated',
    purpose: best,
    group,
    // True when Jev was sure of the group but not the exact kind, so the group's sentence was used.
    grouped: share < RULES.within,
    confidence: sure,
    specific,
    extras,
    sentence: sentences.join(' '),
  };
}

// Word arithmetic for the card. A translation that isn't shorter is not worth showing.
export function measure(originalText, sentence) {
  const before = countWords(originalText);
  const after = countWords(sentence);
  const removed = Math.max(0, before - after);
  return { before, after, removed, percent: before ? Math.round((removed / before) * 100) : 0 };
}

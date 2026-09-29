import { PURPOSES, EXTRAS, SENSITIVE, TOPICS, NONE } from './intents.js';
import { findAmounts, findOrgs, findNames, findRoles, findYears } from './text.js';

// Speculative questions for the specific sentences. Each picks one candidate copied from
// the post, or none. They are asked with every post because answers arrive in parallel
// and cost a few tokens; the code only reads the ones the main purpose needs.
export const SLOTS = {
  joining: { from: 'orgs', ask: 'If the author of `post` is starting a new job or internship, which organisation are they joining?' },
  employer: {
    from: 'orgs',
    ask: 'Which organisation does the author of `post` work for, or which are they leaving, retiring from or laid off from?',
  },
  partner: { from: 'orgs', ask: 'If `post` announces a partnership or a new customer, which other organisation is it?' },
  role: { from: 'roles', ask: 'Which job title does the author of `post` say they now have, are starting, or are looking for?' },
  amount: { from: 'amounts', ask: 'If `post` announces that a company raised money from investors, which amount did it raise in this round?' },
  years: { from: 'years', ask: 'How long has the author of `post` worked at their company or in their career?' },
  product: {
    from: 'names',
    ask: 'What is the name of the product, app, service, feature, course or book that `post` announces or promotes?',
  },
  event: {
    from: 'names',
    ask: 'What is the name of the event, conference, summit or webinar the author of `post` attended, is speaking at, or is promoting?',
  },
  award: { from: 'names', ask: 'What is the name of the award, honour or list that the author of `post` received or was named on?' },
  person: { from: 'people', ask: 'Who is the person the author of `post` congratulates, praises, welcomes to the team or met?' },
};

const merge = (...lists) => {
  const seen = new Map();
  for (const item of lists.flat()) if (!seen.has(item.toLowerCase())) seen.set(item.toLowerCase(), item);
  return [...seen.values()].slice(0, 16);
};

export function candidates({ text, mentionedOrgs = [], mentionedPeople = [] }) {
  const names = findNames(text, mentionedOrgs);
  return {
    orgs: merge(findOrgs(text, mentionedOrgs), names),
    roles: findRoles(text),
    amounts: findAmounts(text),
    years: findYears(text),
    names,
    people: merge(mentionedPeople, names),
  };
}

// Builds the single Jev request for one post. Every question is answered in parallel
// against the same state.
export function buildRequest({ text, mentionedOrgs = [], mentionedPeople = [], model = 'jev-latest' }) {
  const questions = {
    purpose: {
      type: 'choice',
      instructions: {
        question: 'What is the main purpose of `post`?',
        focus: 'Judge what the author most wants readers to take away, reading past the storytelling, emoji, line breaks and hashtags.',
      },
      criteria: Object.fromEntries(Object.entries(PURPOSES).map(([id, p]) => [id, p.criteria])),
    },
    sensitive: { type: 'noul', ...SENSITIVE },
    topic: {
      type: 'choice',
      instructions: 'Which topic is `post` mainly about?',
      criteria: { ...Object.fromEntries(TOPICS.map((t) => [t, null])), [NONE]: 'None of these topics fits the post.' },
    },
  };

  for (const [id, extra] of Object.entries(EXTRAS)) {
    questions[`extra_${id}`] = { type: 'noul', instructions: extra.instructions, criteria: extra.criteria };
  }

  const found = candidates({ text, mentionedOrgs, mentionedPeople });
  for (const [id, slot] of Object.entries(SLOTS)) {
    const list = found[slot.from];
    if (!list.length) continue;
    questions[`slot_${id}`] = {
      type: 'choice',
      instructions: slot.ask,
      criteria: {
        ...Object.fromEntries(list.map((value) => [value, null])),
        [NONE]: 'The post does not say, or the answer is not in this list.',
      },
    };
  }

  return { model, state: { post: text }, questions };
}

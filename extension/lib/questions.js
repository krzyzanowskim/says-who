import { TAKES, STAKES, BASIS, KNOWN, NONE } from './stakes.js';
import { findMentions, findNames, findOrgs, findWares } from './text.js';

const merge = (...lists) => {
  const seen = new Map();
  for (const item of lists.flat()) if (item && !seen.has(item.toLowerCase())) seen.set(item.toLowerCase(), item);
  return [...seen.values()].slice(0, 16);
};

// Organisations the author names: X's own affiliation badge, accounts the bio or the post
// points at, and capitalised names in the bio. Jev can only pick one of these, so the
// note never names a company the author doesn't.
export function candidates({ bio = '', label = '' }, text = '') {
  return merge(label ? [label] : [], findMentions(bio), findOrgs(bio), findNames(bio), findOrgs(text), findMentions(text));
}

// A second, small request about the account alone, sent only when a post is an opinion
// about AI and nothing on the profile or in the post says how its author earns a living.
// It carries no post and no bio, so the answer rests only on who the account is.
export function buildKnownRequest({ handle, name = '', model = 'jev-latest' }) {
  return { model, state: { author_handle: `@${handle}`, author_name: name }, questions: { known: { type: 'choice', ...KNOWN } } };
}

// Builds the main Jev request for one post and its author. Every question is answered
// in parallel against the same state.
export function buildRequest({ text, author = {}, model = 'jev-latest' }) {
  const state = { post: text, author_name: author.name || '', author_handle: author.handle ? `@${author.handle}` : '', author_bio: author.bio || '' };
  if (author.label) state.author_badge = author.label;
  if (author.link) state.author_link = author.link;
  if (author.category) state.author_category = author.category;
  const profile = Object.keys(state).filter((k) => k !== 'post').map((k) => `\`${k}\``).join(', ');

  const questions = {
    take: {
      type: 'choice',
      instructions: {
        question: 'What is `post` doing?',
        focus: 'Judge what the author most wants readers to believe, reading past jokes, threads, emoji and hashtags. Go only by the words of `post` itself. The author’s profile is not part of the post and says nothing about its subject, and a reply must not be read in the light of a post you cannot see. If the words of `post` alone do not make a claim, it is a fragment.',
      },
      criteria: Object.fromEntries(Object.entries(TAKES).map(([id, t]) => [id, t.criteria])),
    },
    stake: {
      type: 'choice',
      instructions: {
        question: `Going by the profile (${profile}) and by what the author says about themselves in \`post\`, how does the author earn a living?`,
        focus: 'Use only what the profile states and what the author says of their own work in the post. Having an opinion about AI is not evidence of being paid by it. A company counts as an AI company only if the profile or the post says AI is what it builds or sells, or it is widely known for that. A post in which the author launches, announces or promotes an AI or agentic product as their own or their company’s does say so. Do not rely on what you know about the person.',
      },
      criteria: Object.fromEntries(Object.entries(STAKES).map(([id, s]) => [id, s.criteria])),
    },
  };

  questions.basis = {
    type: 'choice',
    instructions: `Where is the author’s work stated: in the profile (${profile}) or in \`post\`?`,
    criteria: BASIS,
  };

  const orgs = candidates(author, text);
  if (orgs.length) {
    questions.org = {
      type: 'choice',
      instructions: `Which of these does the profile (${profile}) or \`post\` name as the AI company, fund or product the author works at, runs, invests through or sells?`,
      criteria: {
        ...Object.fromEntries(orgs.map((value) => [value, null])),
        [NONE]: 'The profile does not say, or the answer is not in this list.',
      },
    };
  }

  // What they sell, in their own words. The post comes first: it is the freshest pitch.
  const wares = merge(findWares(text), findWares(author.bio));
  if (wares.length) {
    questions.wares = {
      type: 'choice',
      instructions: `Which of these phrases, copied from \`post\` or the profile, best names what the author or their company builds or sells?`,
      criteria: {
        ...Object.fromEntries(wares.map((value) => [value, null])),
        [NONE]: 'None of these names something the author builds or sells.',
      },
    };
  }

  return { model, state, questions };
}

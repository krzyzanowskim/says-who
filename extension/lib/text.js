// Plain text helpers shared by the background worker and the tests.

export function normalise(text) {
  return (text || '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const NOT_ORGS = new Set([
  'i', 'we', 'the', 'a', 'an', 'my', 'our', 'this', 'that', 'last', 'first', 'next', 'today', 'tomorrow',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'ai', 'twitter', 'x',
]);

// Dots are allowed only inside a word ("Node.js"), so a full stop ends the name.
const ORG_AFTER = /\b(?:at|joined|joining|join|joins)\s+([A-Z][\w&'’-]*(?:\.[A-Za-z0-9]+)*(?:[ \t]+(?:[A-Z][\w&'’-]*(?:\.[A-Za-z0-9]+)*|of|for|&)){0,3})/g;

// Organisation names a bio might name: the ones passed in, plus capitalised names that
// follow "at" or "joining". Jev selects among these.
export function findOrgs(text, mentioned = [], limit = 10) {
  const seen = new Map();
  const add = (raw) => {
    const value = (raw || '')
      .replace(/[\s.,!?:;'’)]+$/u, '')
      .replace(/\s+(?:of|for|&)$/i, '')
      .trim();
    if (!value || value.length > 60) return;
    const key = value.toLowerCase();
    if (NOT_ORGS.has(key) || seen.has(key)) return;
    seen.set(key, value);
  };
  for (const name of mentioned) add(name);
  for (const match of (text || '').matchAll(ORG_AFTER)) add(match[1]);
  return [...seen.values()].slice(0, limit);
}

const COMMON = new Set([
  ...NOT_ORGS,
  "i'm", "i've", "i'd", "i'll", "we're", "we've", "it's", "here's", "let's", "that's", "there's", "what's",
  'it', 'he', 'she', 'they', 'you', 'your', 'his', 'her', 'their', 'its', 'if', 'when', 'what', 'why', 'how', 'who',
  'here', 'there', 'so', 'but', 'and', 'or', 'not', 'no', 'yes', 'please', 'let', 'every', 'each', 'most', 'many',
  'also', 'now', 'then', 'still', 'even', 'just', 'never', 'always', 'thank', 'thanks', 'huge', 'big', 'excited',
  'thrilled', 'proud', 'honoured', 'honored', 'happy', 'grateful', 'humbled', 'some', 'one', 'two', 'three', 'four',
  'five', 'six', 'seven', 'eight', 'nine', 'ten', 'yesterday', 'week', 'year', 'after', 'before', 'over', 'since',
  'because', 'while', 'with', 'without', 'for', 'from', 'to', 'in', 'on', 'of', 'these', 'those', 'those', 'which',
  'agree', 'thoughts', 'onwards', 'starting', 'meet', 'introducing', 'announcing', 'congratulations', 'congrats', 'welcome', 'finally', 'sometimes', 'imagine', 'remember', 'stop', 'start', 'keep', 'be',
]);

// A word may contain dots only between letters ("Node.js"), so a full stop ends the name.
const WORD = String.raw`[\w&'’+-]*(?:\.[A-Za-z0-9]+)*`;
const NAME = new RegExp(
  String.raw`(?:^|[^\w@#])((?:[A-Z]${WORD}|[0-9]+[A-Za-z]${WORD})(?:[ \t]+(?:[A-Z0-9]${WORD}|of|for|the|and|&|de|in|on|under)){0,5})`,
  'g',
);

// Ordinary words that often start a sentence. A lone one at the start of a sentence is
// capitalised by grammar, not because it's a name. Anything else stays a candidate, since
// Jev can only pick a name that is on the list.
const OPENERS = new Set(
  (
    'see look looking read watch check find join come get go make take give let try share build ship ' +
    'great good bad best better worst hard easy real true false big small new old long short last next ' +
    'excited thrilled proud happy grateful honoured honored humbled delighted pleased sad sorry ' +
    'hot unpopular controversial quick fun fact note reminder update news question tip lesson story ' +
    'people everyone someone nobody anyone leaders founders managers recruiters engineers designers ' +
    'life work business success failure growth leadership hiring marketing sales career careers ' +
    'yesterday tonight morning afternoon evening recently lately honestly seriously literally really ' +
    'well oh wow hey hi hello yes no okay ok sure maybe perhaps definitely absolutely truly simply ' +
    'nothing everything something anything always never often usually sometimes once twice again ' +
    'day days month months years weeks hours minutes time today tomorrow'
  ).split(' '),
);

// Capitalised names in the text (companies, products, funds), in order of appearance.
export function findNames(text, extra = [], limit = 14) {
  const found = [];
  for (const match of (text || '').matchAll(NAME)) {
    const words = match[1].split(/\s+/);
    while (words.length > 1 && COMMON.has(words[0].toLowerCase())) words.shift();
    while (words.length > 1 && COMMON.has(words[words.length - 1].toLowerCase())) words.pop();
    const value = words
      .join(' ')
      .replace(/[\s.,!?:;'’)]+$/u, '')
      .replace(/(?:\s+(?:of|for|the|and|&|de|in|on|under))+$/i, '')
      .trim();
    const at = match.index + match[0].indexOf(match[1]);
    const opening = /(^|[.!?:\n]\s*|[^\w\s,;'’&()-]\s*)$/u.test(text.slice(Math.max(0, at - 3), at)) || at === 0;
    found.push({ value, opening });
  }
  const midSentence = new Set(found.filter((f) => !f.opening).map((f) => f.value.toLowerCase()));

  const seen = new Map();
  const add = (value, opening = false) => {
    if (value.length < 2 || value.length > 60) return;
    const words = value.split(/\s+/);
    if (words.every((w) => COMMON.has(w.toLowerCase()))) return;
    const oddCase = /\p{Lu}.*\p{Lu}|\d/u.test(value.slice(1));
    if (words.length === 1 && opening && !oddCase && !midSentence.has(value.toLowerCase()) && OPENERS.has(value.toLowerCase())) return;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  };
  for (const name of extra) add(name);
  for (const { value, opening } of found) {
    add(value, opening);
    if (seen.size >= limit) break;
  }
  return [...seen.values()].slice(0, limit);
}

// Accounts a bio points at, such as "@northwind". Most people name their employer this way.
export function findMentions(text, limit = 8) {
  const seen = new Map();
  for (const match of (text || '').matchAll(/(?:^|[^\w@])(@\w{2,15})\b/g)) {
    if (!seen.has(match[1].toLowerCase())) seen.set(match[1].toLowerCase(), match[1]);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

const AI_WORDS = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}])(?:` +
    [
      String.raw`a\.?i\.?`, 'agi', 'asi', 'genai', String.raw`llms?`, String.raw`gpt[-\w.]*`, 'chatgpt', 'openai', 'anthropic', 'claude',
      'deepmind', 'gemini', 'copilot', 'xai', 'grok', 'mistral', 'llama', 'deepseek', 'midjourney', 'nvidia', 'hugging ?face',
      'artificial intelligence', 'machine learning', String.raw`neural net\w*`, String.raw`(?:language|foundation|frontier|diffusion) models?`,
      'deep learning', 'superintelligence', String.raw`chatbots?`, 'agentic', String.raw`(?:sub-?)?agents?`, 'codex', 'claude code', 'cursor', 'mcp', String.raw`swarms?`, String.raw`vibe[- ]cod\w+`,
      String.raw`prompt engineer\w*`, String.raw`fine-?tun\w+`,
    ].join('|') +
    String.raw`)(?![\p{L}\p{N}])`,
  'iu',
);

// "Coding is solved", "programming is over", "nobody writes code by hand": takes about AI
// that never name it.
const CRAFT = String.raw`(?:coding|programming|software engineering|software development|programmers?|coders?|developers?|software engineers?|writing code|hand-?written code)`;
const VERDICT = String.raw`(?:solved|over|dead|dying|done|finished|obsolete|extinct|irrelevant|replaced|automated|a commodity|a thing of the past|no longer|going away|gone)`;
// The vocabulary of people who talk about AI all day without saying "AI".
const SHOP_TALK = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}])(?:` +
    [
      String.raw`tokens?`, String.raw`prompt(?:s|ed|ing)?`, String.raw`one-?shot(?:s|ted)?`, String.raw`(?:the|this|new|next|latest|frontier|internal) (?:model|models|demo|version|release)`,
      'context window', String.raw`benchmarks?`, String.raw`evals?`, 'inference', 'open weights', 'exponential', 'superhuman', 'singularity', 'abundance',
      'headcount', String.raw`accelerat\w+`, 'autocomplete', 'skill issue', 'worst it will ever be', 'science fiction', 'by a human', 'by hand',
      String.raw`in parallel`, String.raw`instances`, String.raw`these tools`, String.raw`the right (?:tools|setup)`, 'boilerplate', 'moat', 'skeptics?', 'sceptics?', 'cope',
      'the future', 'buckle up', String.raw`bet against`, String.raw`bigger than the internet`,
    ].join('|') +
    String.raw`)(?![\p{L}\p{N}])`,
  'iu',
);

const WORK_IS_OVER = new RegExp(
  [
    String.raw`\b${CRAFT}\b[^.!?\n]{0,60}\b${VERDICT}\b`,
    String.raw`\b(?:end|death|future) of ${CRAFT}\b`,
    String.raw`\b(?:never|no ?one|nobody|don'?t|won'?t|stop(?:ped)?|no longer)\b[^.!?\n]{0,40}\b(?:writes?|writing|written|typing|types?) (?:any |a line of |their own |your own )?code\b`,
    String.raw`\bcode by hand\b`,
  ].join('|'),
  'i',
);

// A cheap first look, so posts with no sign of AI in them or in their author's profile
// are never sent anywhere. It errs towards yes: Jev makes the real call.
export function mentionsAI(text) {
  return AI_WORDS.test(text || '') || WORK_IS_OVER.test(text || '') || SHOP_TALK.test(text || '');
}

const WARE_HEADS = /^(?:agentic|ai|a\.i\.|genai|llms?|ai-native|ai-powered)$/i;
const WARE_TAILS = /^(?:agents?|copilots?|assistants?|chatbots?|models?)$/i;
const WARE_STOPS = new Set(
  ('is are was were be been the a an and or but that which who to in on at of with by from as it this these those here there now ' +
    'will can just not no my our your their his her its we you they i so than then if when while how what why also too very more most ' +
    'all any every up out about into over for').split(' '),
);

// Names for what someone sells, copied word for word from a post or a bio: "AGENTIC
// TESTING", "AI copilots for lawyers", "coding agents". Jev picks among these, so the
// note never describes a product in words the author didn't use.
export function findWares(text, limit = 8) {
  const seen = new Map();
  const add = (words) => {
    const value = words.join(' ');
    if (words.length < 2 || value.length > 50) return;
    if (!seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  };
  const plain = (w) => /^[\p{L}\p{N}][\p{L}\p{N}'’-]*$/u.test(w) && !WARE_STOPS.has(w.toLowerCase());
  // Punctuation, arrows and emoji end a phrase.
  for (const part of (text || '').split(/[^\p{L}\p{N}\s'’@-]+|\n/u)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (WARE_HEADS.test(words[i])) {
        const phrase = [words[i]];
        let j = i + 1;
        while (j < words.length && phrase.length < 4 && plain(words[j])) phrase.push(words[j++]);
        // "AI copilots for lawyers", "LLMs for search"
        if (words[j]?.toLowerCase() === 'for' && words[j + 1] && plain(words[j + 1]) && /^\p{L}/u.test(words[j + 1])) phrase.push(words[j], words[j + 1]);
        add(phrase);
      }
      if (WARE_TAILS.test(words[i]) && i > 0 && plain(words[i - 1])) {
        // Both lengths: "coding agents" and "personal ai agent" are each right somewhere.
        add(words.slice(i - 1, i + 1));
        if (i > 1 && plain(words[i - 2])) add(words.slice(i - 2, i + 1));
      }
    }
    if (seen.size >= limit) break;
  }
  return [...seen.values()].slice(0, limit);
}

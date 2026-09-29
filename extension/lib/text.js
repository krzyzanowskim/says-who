// Plain text helpers shared by the background worker and the tests.

// A word is any whitespace-separated token with at least one letter or digit,
// so emoji, bullets and arrows don't count towards the total.
export function countWords(text) {
  if (!text) return 0;
  let n = 0;
  for (const token of text.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) n++;
  }
  return n;
}

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

const MONEY = new RegExp(
  [
    // $12M, £2.5 million, €300k, $1,200,000
    String.raw`[$£€¥]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|mm|mn|b|bn|million|billion|thousand))?(?![A-Za-z])`,
    // 12 million dollars, 3.5M USD, 40 million
    String.raw`\d[\d,]*(?:\.\d+)?\s?(?:million|billion|mn|bn|m)\s?(?:dollars|usd|euros?|eur|pounds|gbp)(?![A-Za-z])`,
    String.raw`\d[\d,]*(?:\.\d+)?\s(?:million|billion)(?![A-Za-z])`,
  ].join('|'),
  'gi',
);

// Verbatim money amounts found in the post. Jev picks which one (if any) was raised,
// and the translation copies it unchanged, so the model never writes the number itself.
export function findAmounts(text, limit = 8) {
  const seen = new Map();
  for (const match of (text || '').matchAll(MONEY)) {
    const value = match[0].trim().replace(/\s+/g, ' ');
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

const NOT_ORGS = new Set([
  'i', 'we', 'the', 'a', 'an', 'my', 'our', 'this', 'that', 'last', 'first', 'next', 'today', 'tomorrow',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'linkedin',
]);

// Dots are allowed only inside a word ("Node.js"), so a full stop ends the name.
const ORG_AFTER = /\b(?:at|joined|joining|join|joins)\s+([A-Z][\w&'’-]*(?:\.[A-Za-z0-9]+)*(?:[ \t]+(?:[A-Z][\w&'’-]*(?:\.[A-Za-z0-9]+)*|of|for|&)){0,3})/g;

// Organisation names the post might be about: company pages the author tagged,
// plus capitalised names that follow "at" or "joining". Jev selects among these.
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

// Capitalised names in the post (products, events, awards, people), in order of appearance.
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

const ROLE = /\b(?:as|to|position of|role of|title of)\s+(?:an?\s+|the\s+|our\s+|my\s+|their\s+)?((?:[A-Z][\w&/'’-]*)(?:,?\s+(?:[A-Z][\w&/'’-]*|of|and|&|for|at the))*)/g;

// Job titles written after "as", "promoted to" and similar, e.g. "Head of Partnerships".
export function findRoles(text, limit = 6) {
  const seen = new Map();
  for (const match of (text || '').matchAll(ROLE)) {
    const value = match[1]
      .replace(/(?:\s+(?:of|and|&|for|at the))+$/i, '')
      .replace(/[\s.,!?:;]+$/, '')
      .trim();
    const first = value.split(/\s+/)[0].toLowerCase();
    if (!value || value.length > 60 || COMMON.has(first)) continue;
    if (!seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

const YEARS = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|twenty-five|thirty)\s+years?\b/gi;

// "5 years", "ten years": how long someone has been somewhere.
export function findYears(text, limit = 5) {
  const seen = new Map();
  for (const match of (text || '').matchAll(YEARS)) {
    const value = match[0].toLowerCase().replace(/\s+/g, ' ');
    if (value === '1 years') continue;
    if (!seen.has(value)) seen.set(value, value);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

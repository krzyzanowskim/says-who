// The whole vocabulary of the extension lives here: what Jev is asked, and the fixed
// sentences each answer turns into. The sentences answer the extension's name. They can
// be dry, but each has to be plainly true of anyone in that kind. Editing a sentence
// changes the note without re-asking Jev. Editing `criteria` changes the question, so
// saved results for it are ignored and posts get judged again.
//
// Two things have to be true before a post gets a note: the post talks AI up (TAKES),
// and the author makes money from AI (STAKES). The second can come from
// three places: the author's profile, what they say about themselves in the post, or,
// for well-known accounts only, what Jev already knows about them (KNOWN).

// What the post is doing. Only kinds marked `opinion` can get a note. The extension is
// after one thing: people paid by AI talking it up. So the marked kinds are the ones that
// glorify AI and the ways of working with it: praise for a model or tool, predictions
// that AI will succeed, and their close relatives. Criticism, policy arguments and
// neutral posts are classified, so Jev has somewhere to put them, but earn no note.
export const TAKES = {
  hype: {
    opinion: true,
    criteria: 'Praises AI, or flatters a particular model, tool or company: how capable, smart, fast, important or transformative it is, how much better than the rest, how it changed the author’s work. Includes gushing about a new release, benchmark or leaderboard brags, awe at how fast things are moving ("a year ago this was science fiction"), comparisons to electricity or the internet, saying models have outgrown the tests ("we are running out of exams it cannot pass"), and hints from someone with early access ("saw the internal demo, could not sleep", "buckle up").',
  },
  prediction: {
    opinion: true,
    criteria: {
      what: 'Predicts that AI will succeed: AGI or superintelligence arriving, what models will soon be capable of, how fast things will improve, how big it will be, which AI companies or approaches will win.',
      not_for: 'A prediction that AI will fail, stall, disappoint or that the bubble will burst (that is criticism).',
    },
  },
  jobs: {
    opinion: true,
    criteria: {
      what: 'Claims AI can or will do people’s work: what it does to jobs, software engineering, businesses or the economy, or a boast about how much a team or company now does with fewer people or spends on AI, or a company rule that assumes it ("no new headcount unless you show it cannot be automated", "we only hire people who use these tools"). This includes claims that coding, programming or software engineering is solved, over, dead, automated or no longer done by hand, even when AI is not named: that is a claim about AI.',
      not_for: 'A claim that AI is failing at the work, or making it worse (that is criticism).',
    },
  },
  testimony: {
    opinion: true,
    criteria: 'A personal story offered as proof: the author, their team, their child or a customer got something done remarkably fast or without the usual skill ("did a week of analysis before lunch", "one prompt, a working app", "I have not opened an editor in months"), or a former sceptic was won over. Counts even when AI is not named.',
  },
  obituary: {
    opinion: true,
    criteria: 'Declares a kind of software, product or industry dead, over or doomed because machines now do it: SaaS, search, apps, websites, agencies, consulting. Counts even when AI is not named.',
  },
  skills: {
    opinion: true,
    criteria: 'Says what people should now learn, study or teach their children, or what a degree, a skill or experience is worth, in a world changed by AI. Counts even when AI is not named, for example "do not teach your kids to code" or "a computer science degree is a bad investment".',
  },
  compute: {
    criteria: {
      what: 'Argues about the data centres, power, chips or permits that AI needs. Counts even when AI is not named.',
      not_for: 'A boast about how much a team uses or spends on AI (that is jobs). Insisting that AI is not a bubble or that demand is real (that is dismissal).',
    },
  },
  mind: {
    opinion: true,
    criteria: 'Claims or implies that a model understands, reasons, wants, feels or is more than a machine, or tells a story that invites that conclusion, for example an anecdote ending "hard to call that autocomplete".',
  },
  agents: {
    opinion: true,
    criteria: {
      what: 'Shows off or talks up agentic work: AI agents, coding agents, agent swarms or agentic tools, how well they work, what they got done, how the author works with them, or what they change. Any favourable or matter-of-fact post about agentic work belongs here, even when it reads as a personal update, a description of a workflow, the launch or promotion of an agentic product, or a question that floats one ("who is building the agent for X?").',
      not_for: 'A complaint that agents do not work, or a warning against them (that is criticism).',
    },
  },
  urging: {
    opinion: true,
    criteria: 'Tells readers they should adopt, learn or build with AI, or warns that people who do not will be left behind.',
  },
  dismissal: {
    opinion: true,
    criteria: 'Plays down or mocks criticism of AI, its risks, its costs or its limits, or the people raising them. Includes insisting it is not a bubble and that the demand is real.',
  },
  policy: {
    criteria: 'Argues how AI should be regulated, governed, funded or made safe, or about AI risk.',
  },
  criticism: {
    criteria: 'Criticises AI, an AI company, model, agent or product, or argues it is overhyped, harmful, failing or does not work. Includes running down a rival’s model and predictions that AI will disappoint. A story told to show a model is more than autocomplete is not criticism (that is mind).',
  },
  announcement: {
    criteria: {
      what: 'Announces a product, feature, release, funding round, job opening or event in neutral terms, without arguing a wider point about AI.',
      not_for: 'A launch post that mainly argues what AI will do or how good it is (that is hype or prediction), or a launch presented as the future or as a breakthrough (that is hype), or anything about an agentic product (that is agents).',
    },
  },
  information: {
    criteria: {
      what: 'Shares AI news, research results, benchmarks, technical detail or instructions without arguing a view of the author’s own.',
      not_for: 'Anything about agentic work, however factual (that is agents).',
    },
  },
  question: {
    criteria: {
      what: 'A genuine request for help or facts about AI ("how do I…", "which setting…"), or a joke or personal remark that implies no view.',
      not_for: 'A question about agentic work (that is agents). A rhetorical or leading question that floats an idea, signals demand or invites agreement, such as "who is building X?" or "why is nobody talking about Y?": judge it by the view it implies.',
    },
  },
  fragment: {
    criteria: 'Too short or too dependent on something it replies to for its own words to make a claim: "this", "nope, seems normal for me", "agreed, huge", "thanks!", "lol same", an emoji. What it means depends on a post that is not shown, so it cannot be judged.',
  },
  not_ai: {
    criteria: {
      what: 'The post is not about AI.',
      not_for: 'A claim that coding, programming or another kind of work is solved, finished or no longer needs people, or a company rule against hiring (that is jobs). A claim that a product or industry is dead (obituary), advice on what to learn or study now (skills), a story about getting work done remarkably fast (testimony), or an argument about data centres, power or chips (compute). People paid by AI often write about it without naming it.',
    },
  },
};

// How the author earns a living, going by their profile and the post. Only kinds marked `paid`
// get a note. A note should say what the author gains by telling you this: what they
// sell, or where their money comes from. A company's name alone says little, so it only
// appears where it is the point (who signs the paycheck). `templates` are tried in
// order and used when Jev is sure of the detail: {product} is what they sell, in their
// own words, and {org} is an organisation their profile names. Failing those, `says`.
export const STAKES = {
  employee: {
    paid: true,
    criteria: {
      what: 'The author works at a company whose main business is building or selling AI: AI models, AI products, AI chips or AI infrastructure.',
      not_for: 'Someone who founded or runs the company (that is founder).',
    },
    says: 'Says someone whose paycheck depends on it.',
    templates: ['Says someone paid to build {product}.', 'Says someone whose paycheck comes from {org}.'],
  },
  founder: {
    paid: true,
    criteria: 'The author founded, co-founded, runs or is building a company or product whose main business is AI.',
    says: 'Says someone whose company sells it.',
    templates: ['Says the person selling {product}.'],
  },
  investor: {
    paid: true,
    criteria: 'The author invests in AI companies, or is a partner or investor at a fund that does.',
    says: 'Says someone whose money is riding on it.',
  },
  seller: {
    paid: true,
    criteria: 'The author sells something to do with AI: a course, a newsletter, consulting, an agency, a community, templates, or sponsored or affiliate content about AI tools.',
    says: 'Says someone with AI to sell you.',
    templates: ['Says someone selling {product}.'],
  },
  researcher: {
    criteria: 'The author studies AI at a university, non-profit or public body, and no commercial AI role is stated.',
  },
  other_work: {
    criteria: 'The author works at, founded or runs an organisation, but nothing says its main business is AI, and it is not a company widely known for AI. A web address ending in .ai, a book or a newsletter title do not make a company an AI company.',
  },
  user: {
    criteria: 'AI or tech comes up only as an interest, a skill or a tool the author uses, at an organisation whose main business is not AI.',
  },
  unstated: {
    criteria: 'Neither the profile nor the post says how the author earns a living, or what they say has nothing to do with AI.',
  },
};

// Where the author's connection to AI is stated. The line under the note says which, so
// the reader knows what to check.
export const BASIS = {
  profile: 'The profile (name, handle, bio, badge or link) states the author’s work, company, fund or product.',
  post: 'The profile does not say the work is in AI, but `post` does: the author says so themselves ("we", "our model", "my startup", "our portfolio", "my course"), or launches, announces or promotes an AI or agentic product as their own or their company’s.',
  neither: 'Neither the profile nor the post states how the author earns a living.',
};

// Asked on its own, without the post or the bio, so the answer rests only on who the
// account is.
export const KNOWN = {
  instructions: {
    question: 'From what you already know, who is the X account `author_handle` (`author_name`)?',
    focus: 'Answer only from firm knowledge of this specific account. A common name, or a name that merely sounds like someone, is not recognition.',
  },
  criteria: {
    ai_insider: 'A widely known public figure or organisation whose income comes from AI: they work at, run, founded or invest in a company that builds or sells AI, and you could name it.',
    other_public: 'A widely known public figure or organisation whose income does not come from AI.',
    unknown: 'You do not recognise this specific account, or are not certain who it is.',
  },
};

// Used when Jev is sure the author is paid by AI but split on exactly how, and for
// accounts it recognises without the profile or the post saying anything.
export const PAID = 'Says someone who makes money from AI.';

export const NONE = 'none_of_these';

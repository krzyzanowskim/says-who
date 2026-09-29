// The whole vocabulary of the extension lives here: what Jev is asked, and the fixed
// sentences each answer turns into. Editing `says` changes the translation without
// re-asking Jev. Editing `criteria` changes the question, so saved results for it are
// ignored and posts get classified again.
//
// Each kind of post belongs to a group of kinds that are easy to confuse. When Jev
// is sure about the group but split inside it, the group's own sentence is used, so
// "I have an opinion." still appears when it can't tell an AI take from a prediction.
// When a kind has several wordings, one is picked per post, always the same for that post.

export const GROUPS = {
  job_news: { says: 'I have job news.' },
  leaving: { says: "I don't work there any more." },
  job_search: { says: 'I need a job.' },
  recognition: { says: 'I achieved something.' },
  company: { says: 'My company has news.' },
  event: { says: 'This is about an event.' },
  takes: { says: 'I have an opinion.' },
  advice: { says: "Here's some advice." },
  stories: { says: "Here's a story with a moral." },
  thanks: { says: "I'd like to thank some people." },
  asks: { says: 'I want something from you.' },
  status: { says: "Look how well I'm doing." },
  // Posts in this group are never translated.
  keep: { says: null },
};

export const PURPOSES = {
  // ---------- job news ----------
  new_job: {
    group: 'job_news',
    criteria: {
      what: 'The author announces that they themselves are starting a new job or joining a new company.',
      not_for: 'Welcoming someone else who has joined the author’s team or company (that is team_welcome).',
    },
    says: ['I got a new job.', 'I started a new job.'],
  },
  promotion: {
    group: 'job_news',
    criteria: 'The author was promoted or given a new title at the company they already work for.',
    says: ['I got promoted.', 'I have a new job title.'],
  },
  internship: {
    group: 'job_news',
    criteria: 'The author is starting or has finished an internship, placement or apprenticeship.',
    says: ['I got an internship.'],
  },
  career_change: {
    group: 'job_news',
    criteria: 'The author is moving into a different field or kind of work, or going freelance.',
    says: ['I changed careers.', 'I do something different now.'],
  },
  founding: {
    group: 'job_news',
    criteria: 'The author announces they have started a new company or gone out on their own.',
    says: ['I started a company.'],
  },
  work_anniversary: {
    group: 'job_news',
    criteria: 'The author marks an anniversary at their company or a number of years in their career.',
    says: ['I still work here.', "I've worked here a while."],
  },

  // ---------- leaving ----------
  leaving_job: {
    group: 'leaving',
    criteria: 'The author has left, or is leaving, a job by choice.',
    says: ['I left my job.', "I don't work there any more."],
  },
  laid_off: {
    group: 'leaving',
    criteria: 'The author was laid off, made redundant or let go.',
    says: ['I was laid off.', 'I lost my job.'],
  },
  retirement: {
    group: 'leaving',
    criteria: 'The author is retiring.',
    says: ['I retired.'],
  },

  // ---------- job search ----------
  job_hunting: {
    group: 'job_search',
    criteria: 'The author is looking for work, says they are open to work, or asks for job leads or referrals.',
    says: ['I need a job.', "I'm looking for work."],
  },

  // ---------- recognition ----------
  award: {
    group: 'recognition',
    criteria: 'The author or their team received an award, an honour, or a place on a ranked list.',
    says: ['I won an award.', 'Someone gave me an award.'],
  },
  press: {
    group: 'recognition',
    criteria: 'The author or their company was featured, quoted or interviewed by a newspaper, magazine or website.',
    says: ['I was in the news.', 'Someone wrote about me.'],
  },
  certification: {
    group: 'recognition',
    criteria: 'The author completed a course, certificate, bootcamp or exam.',
    says: ['I finished a course.', 'I got a certificate.'],
  },
  graduation: {
    group: 'recognition',
    criteria: 'The author graduated or finished a degree.',
    says: ['I graduated.'],
  },

  // ---------- company ----------
  product_launch: {
    group: 'company',
    criteria: 'Announces that a new product, app, service or company has launched or is now available.',
    says: ['We launched something.', 'We shipped a thing.'],
  },
  feature_update: {
    group: 'company',
    criteria: 'Announces a new feature, update or improvement to a product that already exists.',
    says: ['We updated our product.', 'Our product does one more thing.'],
  },
  fundraising: {
    group: 'company',
    criteria: 'Announces that a company raised money from investors, such as a seed or Series A round.',
    says: ['We raised money.'],
  },
  acquisition: {
    group: 'company',
    criteria: 'Announces that a company was bought, bought another company, or merged with one.',
    says: ['One company bought another.'],
  },
  company_milestone: {
    group: 'company',
    criteria: 'Celebrates a company result: revenue, users, growth, a ranking or a company birthday.',
    says: ['Our company is doing well.', 'Our numbers went up.'],
  },
  partnership: {
    group: 'company',
    criteria: 'Announces a partnership, integration or collaboration between companies.',
    says: ["We're working with another company."],
  },
  customer_win: {
    group: 'company',
    criteria: 'Announces a new customer, client, contract or deal.',
    says: ['We got a new customer.'],
  },
  hiring: {
    group: 'company',
    criteria: 'The author or their company is recruiting people for open roles.',
    says: ["We're hiring.", 'We have jobs going.'],
  },
  team_welcome: {
    group: 'company',
    criteria: 'Welcomes or introduces someone else who has just joined the author’s team or company.',
    says: ['Someone joined our team.', 'We hired someone.'],
  },
  company_culture: {
    group: 'company',
    criteria: 'Shows a team having fun or its workplace: an offsite, a party, a team photo, office perks or company values.',
    says: ['My team did something fun.', 'Our office is nice.'],
  },
  building_in_public: {
    group: 'company',
    criteria: 'Shares progress, numbers or lessons from something the author is building, as a running update.',
    says: ["Here's an update on my project.", "I'm building something."],
  },

  // ---------- events ----------
  event_recap: {
    group: 'event',
    criteria: 'The author attended a conference, meetup, summit or trade show and describes being there.',
    says: ['I went to an event.', 'I went to a conference.'],
  },
  speaking: {
    group: 'event',
    criteria: 'The author is speaking, or spoke, on a stage, a panel or a webinar.',
    says: ["I'm speaking at an event.", 'I gave a talk.'],
  },
  podcast: {
    group: 'event',
    criteria: 'The author appeared on, or hosts, a podcast, interview or livestream episode.',
    says: ['I was on a podcast.'],
  },
  event_promo: {
    group: 'event',
    criteria: 'Invites readers to register for or attend an upcoming event, webinar or workshop.',
    says: ['Please come to our event.'],
  },

  // ---------- takes ----------
  opinion: {
    group: 'takes',
    criteria: 'Argues an opinion about work, business or society, often framed as unpopular or contrarian.',
    says: ['I have an opinion.', 'I have a take.'],
  },
  ai_take: {
    group: 'takes',
    criteria: 'Argues an opinion or prediction about AI and what it will do to jobs, software or work.',
    says: ['I have thoughts about AI.', 'I have an opinion about AI.'],
  },
  prediction: {
    group: 'takes',
    criteria: 'Predicts where an industry, market or technology is heading.',
    says: ['I have a prediction.', 'I think I know what happens next.'],
  },
  news_reaction: {
    group: 'takes',
    criteria: "Reacts to a news story, announcement or another company's move with the author's view of it.",
    says: ['Something happened and I have thoughts.'],
  },

  // ---------- advice ----------
  generic_advice: {
    group: 'advice',
    criteria: {
      what: 'Broad career, leadership or business advice, or a list of tips, that most readers have heard before.',
      not_for: 'Specific technical detail, data or instructions a reader could not guess (that is substantive).',
    },
    says: ["Here's some advice you've heard before.", "Here's some advice."],
  },
  lessons_learned: {
    group: 'advice',
    criteria: 'Lists lessons the author says they learned from an experience, a year, a job or a project.',
    says: ['I learned some lessons.', "Here's what I learned."],
  },
  motivation: {
    group: 'advice',
    criteria: 'A motivational or inspirational message: keep going, believe in yourself, hard work pays off.',
    says: ['Keep going.', 'Believe in yourself.'],
  },
  productivity: {
    group: 'advice',
    criteria: "Shares the author's routine, habits, schedule or productivity system.",
    says: ["Here's my routine.", 'I have good habits.'],
  },

  // ---------- stories ----------
  parable: {
    group: 'stories',
    criteria: 'Tells a story, often about a stranger, a job candidate, a child or a taxi driver, that ends in a moral lesson.',
    says: ["Here's a story with a moral."],
  },
  origin_story: {
    group: 'stories',
    criteria: 'The author describes their own journey from a hard start, rejection or setbacks to where they are now.',
    says: ["I used to struggle and now I don't.", 'I overcame something.'],
  },
  failure_story: {
    group: 'stories',
    criteria: 'The author openly describes a mistake or failure of their own and what it taught them.',
    says: ['I made a mistake.'],
  },

  // ---------- thanks ----------
  gratitude: {
    group: 'thanks',
    criteria: 'Mainly thanks colleagues, a manager, mentors, customers or a company.',
    says: ["I'd like to thank some people.", 'Thank you, everyone.'],
  },
  shoutout: {
    group: 'thanks',
    criteria: "Praises or recommends a specific colleague or someone else's work.",
    says: ['Someone I know is great.'],
  },
  congratulations: {
    group: 'thanks',
    criteria: 'Congratulates someone else on their news, launch or achievement.',
    says: ['Congratulations to someone.'],
  },

  // ---------- asks ----------
  selling: {
    group: 'asks',
    criteria: 'Mainly promotes something to buy or sign up for: a course, service, template, product, consulting or a call.',
    says: ['Please buy my thing.', "I'm selling something."],
  },
  advert: {
    group: 'asks',
    criteria: "A brand's advertisement for its product or service, written by the company rather than a person.",
    says: ['This is an ad.'],
  },
  lead_magnet: {
    group: 'asks',
    criteria: 'Offers a free guide, template or resource in exchange for a comment, a follow or a connection.',
    says: ["Comment and I'll send you a PDF.", 'Comment to get my free thing.'],
  },
  engagement_bait: {
    group: 'asks',
    criteria: 'Mainly exists to collect likes, comments, reposts or follows, for example by asking readers to agree or share.',
    says: ['Please engage with this post.'],
  },
  poll: {
    group: 'asks',
    criteria: 'Asks readers to vote in a poll or pick between options.',
    says: ['Please vote in my poll.'],
  },
  content_promo: {
    group: 'asks',
    criteria: "Promotes the author's own article, newsletter, video, podcast episode or book for readers to read or watch.",
    says: ['I made something. Please read it.', 'Please read my newsletter.'],
  },

  // ---------- status ----------
  humblebrag: {
    group: 'status',
    criteria: {
      what: 'Mainly shows off the author’s success, money, status or popularity while presenting it as modesty, gratitude, luck or a lesson.',
      not_for: 'A plain announcement of a new job, promotion or award, which have their own options.',
    },
    says: ["Look how well I'm doing.", "I'd like you to be impressed."],
  },
  follower_milestone: {
    group: 'status',
    criteria: 'Celebrates follower, subscriber, view or impression counts on social media.',
    says: ['I got more followers.', 'People read my posts.'],
  },
  met_someone: {
    group: 'status',
    criteria: 'The author shares meeting, or a photo with, a famous or important person.',
    says: ['I met someone important.'],
  },
  business_travel: {
    group: 'status',
    criteria: 'The author is travelling for work, or posting from a business trip or a new city.',
    says: ['I went somewhere for work.'],
  },
  hustle: {
    group: 'status',
    criteria: 'Boasts about working long hours, early mornings or giving up rest.',
    says: ['I work very hard.'],
  },

  // ---------- left alone ----------
  substantive: {
    group: 'keep',
    criteria: 'Shares specific news, data, a technical explanation, research, a genuine question, or other real information that a one-line summary would lose.',
  },
  personal_life: {
    group: 'keep',
    criteria: 'About the author’s personal life: family, health, relationships, grief or a hardship.',
  },
};

// More specific sentences, tried in order before the plain ones. Each {slot} is filled
// with words copied from the post itself (or, for {topic}, from the fixed list below),
// and only when Jev is sure which of the candidates is the right one.
export const SPECIFIC = {
  new_job: ['I got a new job as {role} at {joining}.', 'I got a new job at {joining}.', 'I got a new job as {role}.'],
  internship: ['I got an internship at {joining}.'],
  promotion: ['I got promoted to {role} at {employer}.', 'I got promoted to {role}.', 'I got promoted at {employer}.'],
  career_change: ['I work as {role} now.'],
  work_anniversary: ["I've worked at {employer} for {years}.", 'I still work at {employer}.', "I've worked here for {years}."],
  leaving_job: ['I left {employer}.'],
  laid_off: ['I was laid off from {employer}.'],
  retirement: ['I retired from {employer}.'],
  hiring: ["We're hiring at {employer}."],
  team_welcome: ['{person} joined our team.'],
  product_launch: ['We launched {product}.'],
  feature_update: ['We updated {product}.'],
  fundraising: ['We raised {amount}.'],
  partnership: ["We're working with {partner}."],
  customer_win: ['{partner} is our new customer.'],
  event_recap: ['I went to {event}.'],
  speaking: ["I'm speaking at {event}."],
  event_promo: ['Please come to {event}.'],
  award: ['I won an award: {award}.'],
  opinion: ['I have an opinion about {topic}.'],
  prediction: ['I have a prediction about {topic}.'],
  news_reaction: ['Something happened in {topic} and I have thoughts.'],
  generic_advice: ["Here's some advice about {topic}."],
  lessons_learned: ['I learned some lessons about {topic}.'],
  parable: ["Here's a story with a moral about {topic}."],
  congratulations: ['Congratulations, {person}.'],
  shoutout: ['{person} is great.'],
  met_someone: ['I met {person}.'],
  selling: ['Please buy {product}.'],
};

// Closed list for {topic}. Written as they read inside a sentence.
export const TOPICS = [
  'AI', 'remote work', 'hiring', 'leadership', 'management', 'startups', 'fundraising', 'sales', 'marketing',
  'product management', 'design', 'software engineering', 'careers', 'job hunting', 'productivity',
  'work-life balance', 'company culture', 'personal branding', 'LinkedIn', 'the economy', 'investing',
  'education', 'customer service', 'entrepreneurship', 'burnout', 'networking', 'negotiation', 'failure',
];

// Nouls asked alongside the main purpose. When one is clearly yes, its sentence is
// added after the main one, unless the main purpose already says the same thing.
export const EXTRAS = {
  humblebrag: {
    instructions: 'Is `post` showing off the author’s own success, money, status or popularity while presenting it as modesty, gratitude, luck or a lesson?',
    criteria: {
      true: 'The post draws attention to how impressive the author is, dressed up as humility, thanks or advice.',
      false: 'The post does not show off the author, or states an achievement plainly without the false modesty.',
    },
    says: "I'd like you to be impressed.",
    sameAsGroup: 'status',
  },
  selling: {
    instructions: 'Does `post` promote something for readers to buy, sign up for, download or book, such as a course, newsletter, product, service, template or call?',
    criteria: {
      true: 'There is a pitch: a link, a price, a sign-up, a "DM me" offer, or an invitation to book or buy.',
      false: 'Nothing is offered for readers to buy, sign up for or book.',
    },
    says: 'Please buy my thing.',
    sameAsGroup: 'asks',
  },
  asks_engagement: {
    instructions: 'Does `post` explicitly ask readers to like, comment, repost, share, follow, vote, tag someone, or reply with a word?',
    criteria: {
      true: 'An explicit call to engage, including closing lines like "Agree?", "Thoughts?", "Comment YES" or "Repost to help your network".',
      false: 'No request for readers to engage with the post.',
    },
    says: 'Please engage with this post.',
    sameAs: ['engagement_bait', 'poll', 'lead_magnet'],
  },
};

// Asked with every post. Posts about grief, illness or hardship are never translated.
export const SENSITIVE = {
  instructions: 'Is `post` about death, grief, serious illness, mental health, or another serious personal hardship?',
  criteria: {
    true: 'The post is mainly about a death, a loss, an illness, a mental health struggle or a similar hardship.',
    false: 'The post is not about any of these, or only mentions one in passing.',
  },
};

// Added in front when LinkedIn labels the post as promoted. Code spots the label; Jev isn't asked.
export const PROMOTED = 'This is an ad.';

export const NONE = 'none_of_these';

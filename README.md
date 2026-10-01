# Says Who

A Chrome extension for X (formerly Twitter). When someone who builds, sells or invests in AI posts about AI, it writes one line under the post, in red pen, saying what they gain from telling you.

<img src="docs/screenshot.png" alt="Three posts on X predicting and praising AI, each with one red handwritten line under it, such as 'Says someone whose money is riding on it.'" width="480">

Says Who is a fork of [In Other Words](https://github.com/og2701/in-other-words) by Owen Greenhalgh. See [Credits](#credits).

## What it marks

A post gets a note only when two things are both true.

**The post is a take on AI:** an opinion, a prediction or a claim about AI, models, agents, or what they do to people's work. That includes takes that never name it, such as "coding is solved" or "SaaS is dead".

**The author is paid by AI:** an employee, a founder, an investor, or someone selling a course, newsletter or service. That can rest on three things:

- **Their profile:** bio, display name, handle, link, affiliation badge and professional category.
- **The post itself:** when the author says so in their own words ("we just shipped", "my startup"), or launches an AI product as their own.
- **Who they are:** for well-known accounts whose profile and post say nothing, the model is asked, separately and with only the handle and name, whether it recognises the account as someone whose income comes from AI. It has to be at least 90% sure.

Hover over a note to see which of the three it rests on, and how sure the model was.

## What the note says

One fixed sentence, dry but true, about what the author gains by telling you this. It names what they sell or build, in their own words, when it can, and otherwise where their money comes from:

- "Says the person selling AGENTIC TESTING."
- "Says someone paid to build LLMs for search."
- "Says someone whose paycheck comes from OpenAI."
- "Says someone whose money is riding on it."
- "Says someone with AI to sell you."

The post is never hidden or changed.

## What it leaves alone

- neutral announcements, research write-ups, usage tips and genuine questions
- replies too short to mean anything on their own ("this", "nope, seems normal for me")
- anything a marked author posts that isn't about AI
- researchers, ordinary users, and little-known people who say nothing about their work

## What it can't know

- Someone paid by AI who doesn't say so on their profile or in the post, and isn't famous, gets no note.
- A bio that is out of date or a joke can earn a wrong one.
- A company counts as an AI company only if the profile or the post says so, or it is widely known for it. A founder whose bio doesn't say what the company does is left alone until a post of theirs does.
- Recognition of well-known accounts comes from the model's training, not from a lookup. It can be out of date and it misses most people. In testing it recognised accounts like @sama and @karpathy and turned down invented and little-known ones.
- The model's judgment of borderline posts can differ from one run to the next.

A note means "this person has a stake", not "this is wrong".

## Install

1. Take `says-who-v1.0.0.zip` from the [`release`](release) folder and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped `says-who-v1.0.0` folder.

## Set up

1. Get an API key at [console.typesafe.ai](https://console.typesafe.ai).
2. The settings page opens after you install. If it doesn't, right-click the extension's icon and choose **Options**.
3. Paste the key and click **Save and test**.
4. Reload any X tabs that were already open.

## Use

Scroll X. Notes appear under posts as they come into view.

Click the extension's icon to pause it, see how many posts it has marked, and check what it found on the current page. In settings you can change how sure the model has to be before a post gets a note.

## Privacy and cost

Says Who uses [TypeSafe](https://typesafe.ai)'s Jev model, with your own key.

- **What is sent:** a post, together with its author's public display name, handle, bio, profile link, affiliation badge and professional category.
- **When:** only when the post or the profile shows signs of being about AI, or when the author was found to be paid by AI in the last 30 days. Their takes often don't name it ("SaaS is dead", "big week ahead").
- **What isn't:** anything about your own X account. Other posts are never sent.
- **Where things are kept:** your key and all results stay in this browser and aren't synced. A post is only ever sent once.
- **Requests to X:** none. X already downloads each author's profile along with their post, and the extension reads it from the page.

Each post is roughly 2,900 tokens, which at Jev's listed price is around 12 cents per 1,000 posts sent. That figure is worked out from the request size, not from a bill.

## Changing it

- **What counts, and the wording:** the kinds of post, the kinds of stake and their sentences are in [`extension/lib/stakes.js`](extension/lib/stakes.js). Change a `says` line or a template to change the wording, or the `opinion` and `paid` flags to change which kinds earn a note.
- **The thresholds:** [`extension/lib/verdict.js`](extension/lib/verdict.js).
- **If X changes its layout:** the popup will say "No posts found on this page". The selectors it relies on are at the top of [`extension/content.js`](extension/content.js).
- **If X changes how it loads profiles:** the popup will say no author bios could be read. The reader is [`extension/page.js`](extension/page.js).

X currently serves two builds of its site, and both are handled (checked in October 2026). Logged in, it is the long-standing build marked up with `data-testid` attributes, where each post carries its author's profile in the page's own state. Logged out, it is a newer build without those attributes, which keeps profiles in its router.

## Development

```sh
npm install        # only needed for the browser tests
npm test           # unit tests
npm run e2e        # loads the extension in headless Chromium against a test timeline
                   # (add -- --mock to skip real Jev, -- --dark for the dark theme)
npm run live       # opens a browser window on a real public X profile, logged out,
                   # and reports what the extension found
npm run build      # runs the unit tests and packs extension/ into release/
npm run icons      # redraws extension/icons from scripts/art
```

`TYPESAFE_API_KEY=... npm run eval` runs the sample posts in `test/posts.json` through Jev and prints which would get a note and what it would say, then checks which accounts in `test/accounts.json` it recognises. `npm run e2e` and `npm run live` use the same variable.

## Credits

Says Who is a fork of **[In Other Words](https://github.com/og2701/in-other-words)** by **Owen Greenhalgh**, a Chrome extension that crosses out verbose LinkedIn posts and writes, in red pen, the one sentence they're actually saying. Go and look at it: the idea of answering a post in red handwriting is his, and so is most of what makes this one work.

Taken from In Other Words, unchanged or lightly adapted:

- the design: a content script that never sees the API key, and a background worker that does all the talking to TypeSafe
- the Jev client, the request queue, and saving each result so a post is only sent once
- the approach of asking Jev closed questions and turning the answers into fixed sentences with ordinary code, so the model never writes the note
- copying details into a sentence only from words found in the text
- the red pen itself: the handwriting, its tilt, the write-in animation, and loading the font from memory
- the popup, the settings page and their styling
- the build script and the shape of the unit, browser and eval tests

What this fork changes: it runs on X instead of LinkedIn; it reads authors' profiles; it asks different questions (is this a take on AI, and is the author paid by AI); and it adds a line under the post instead of writing over it.

It is a separate extension with its own name, icon, version numbers and saved data, so both can be installed side by side. It is not maintained or endorsed by the original's author, and its mistakes are its own.

Also:

- [TypeSafe](https://typesafe.ai) for Jev, the classification model.
- [Kalam](https://github.com/itfoundry/kalam), the handwriting typeface, by the Indian Type Foundry, under the SIL Open Font License ([`extension/fonts/OFL.txt`](extension/fonts/OFL.txt)).

## Licence

MIT, the same as the original. Both copyright notices are in [`LICENSE`](LICENSE).

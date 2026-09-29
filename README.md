# In Other Words

LinkedIn posts in plain English. A Chrome extension that crosses out verbose posts and writes, in red pen, the one sentence they're actually saying.

<img src="docs/screenshot.png" alt="Three LinkedIn posts crossed out in red pen, with 'We raised $14M.', 'Here's a story with a moral.' and 'Please engage with this post.' written over them" width="480">

It uses [TypeSafe](https://typesafe.ai)'s Jev model to work out what each post is for (a new job, a launch, a humblebrag, a request for likes and so on), then writes a fixed plain sentence over it, naming the company or amount where the post gives one. Posts it isn't sure about, posts with real substance, and posts about grief or illness are left alone.

## Install

1. Download `in-other-words-v1.1.0.zip` from [Releases](../../releases/latest) (it's also in the `release` folder) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped `in-other-words-v1.1.0` folder.

## Set up

1. Get an API key at [console.typesafe.ai](https://console.typesafe.ai).
2. The settings page opens after you install. If it doesn't, right-click the extension's icon and choose **Options**.
3. Paste the key and click **Save and test**.

## Use

Scroll your LinkedIn feed. When a post comes into view, the pen crosses it out and writes the translation, with how many words it cut. Click **Show original** to read the real post, and the small red squiggle in its corner to put the translation back.

Click the extension's icon to pause it, see how many words it's cut, and check how many posts it found on the current page. In settings you can change how sure Jev has to be before it writes over a post, the shortest post it will bother with, and whether it presses LinkedIn's "Load more" for you.

## Privacy and cost

Only the text of each long post is sent, to TypeSafe's API, with your key. Author names, images, links and your account details are not sent. Your key stays in this browser and isn't synced. Results are saved locally, so a post is only ever sent once.

Each post is roughly 3,000 tokens, which at Jev's listed price is around 13 cents per 1,000 new posts. That figure is worked out from the request size, not from a bill.

## Changing it

- **Translations:** every kind of post and its sentences are in [`extension/lib/intents.js`](extension/lib/intents.js). Change a `says` line to change the wording.
- **If LinkedIn changes its layout:** the popup will say "No posts found on this page". The selectors it relies on are at the top of [`extension/content.js`](extension/content.js).

## Development

```sh
npm install        # only needed for the browser tests
npm test           # unit tests
npm run e2e        # loads the extension in Chromium against a test feed (add -- --sdui for LinkedIn's newer layout)
npm run build      # packs extension/ into release/
```

`TYPESAFE_API_KEY=... npm run eval` runs the sample posts in `test/posts.json` through Jev and prints what each one becomes.

## Licence

MIT

# Privacy Policy for Says Who

*Last updated: October 2026*

**Says Who** ("the Extension") is an open-source browser extension that identifies posts on X (formerly Twitter) about artificial intelligence and discloses whether their authors have commercial or financial stakes in AI.

This Privacy Policy explains how data is handled when you use the Extension.

---

## 1. Core Principle: Minimal Data Processing

Says Who is designed with privacy as a foundational requirement:
- We do **not** collect your personal identity, browsing history, private messages, account credentials, or contacts.
- We do **not** track or monitor your activity across any websites other than posts rendered on `x.com` and `twitter.com`.
- We do **not** sell, rent, monetize, or transfer your data to brokers, advertisers, or third parties.

---

## 2. What Data Is Processed

### A. Information Sent to the Classification API (TypeSafe)
When you browse X, the Extension scans public posts in your timeline:
- **Trigger Condition:** Only posts and author profiles that show signs of discussing AI, or authors previously flagged as paid by AI within the last 30 days, are processed. Posts unrelated to AI are ignored and never sent.
- **Data Sent:**
  - The public text of the post.
  - The author's public profile metadata as provided by X (display name, handle, bio text, external link, verification badge, and professional category).
- **Destination:** The data is transmitted securely via HTTPS to TypeSafe's Jev classification model API (`https://api.typesafe.ai/`).
- **Your Personal Account:** Nothing about your own X account (your handle, your timeline composition, your followers, your bookmarks, or your private details) is ever sent.

### B. Information Stored Locally on Your Device
The Extension uses Chrome's local storage (`chrome.storage.local`) to store:
- Your TypeSafe API key (entered by you in the settings page).
- Extension configuration (enabled/disabled status, confidence threshold).
- Locally cached post verdicts and author classifications (to avoid duplicate API queries).

This data is stored **only on your local device** and is never uploaded to any synchronization server or external database. You can clear this cache at any time by clicking "Forget saved results" in the extension options.

---

## 3. Third-Party Services

The Extension relies on:
- **TypeSafe API (`api.typesafe.ai`):** Used to classify AI-related claims and evaluate commercial stakes based on public author profiles. Requests use your own API key under TypeSafe's terms of service and privacy policy.
- **X (`x.com` / `twitter.com`):** The Extension reads public DOM elements and GraphQL timeline responses already fetched by your browser. The Extension makes no independent background requests to X.

---

## 4. Permissions Requested

- **`storage`:** Required to save your settings, API key, and cached classification results locally.
- **`host_permissions` (`https://api.typesafe.ai/*`):** Required to connect to TypeSafe's inference API for post evaluations.
- **Content Scripts (`https://x.com/*`, `https://twitter.com/*`):** Required to inspect public tweet elements in your feed and display handwritten disclosure annotations beneath relevant posts.

---

## 5. Security

All network communications with the classification API are conducted over TLS-encrypted connections (HTTPS). Your API key is stored securely in your browser's private local extension storage.

---

## 6. Open Source and Transparency

Says Who is open-source software licensed under the MIT License. You can inspect the entire source code, build scripts, and network handlers at:
[https://github.com/krzyzanowskim/says-who](https://github.com/krzyzanowskim/says-who)

---

## 7. Contact

If you have questions or concerns about this privacy policy, please open an issue on GitHub:
[https://github.com/krzyzanowskim/says-who/issues](https://github.com/krzyzanowskim/says-who/issues)

// Minimal client for TypeSafe's System One endpoint. Plain fetch, so the extension
// has no build step and no dependencies.

export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export class JevError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function askJev(apiKey, body, { retries = 3, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  if (!apiKey) throw new JevError(401, 'No TypeSafe API key saved.');

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries) {
        await wait(backoff(attempt));
        continue;
      }
      throw new JevError(0, err.name === 'AbortError' ? 'TypeSafe took too long to answer.' : 'Could not reach TypeSafe.');
    }
    clearTimeout(timer);

    if (response.ok) return response.json();

    if (RETRYABLE.has(response.status) && attempt < retries) {
      const after = Number(response.headers.get('retry-after'));
      await wait(Number.isFinite(after) && after > 0 ? after * 1000 : backoff(attempt));
      continue;
    }

    throw new JevError(response.status, await describe(response));
  }
}

function backoff(attempt) {
  return 800 * 2 ** attempt + Math.random() * 400;
}

async function describe(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = typeof body?.detail === 'string' ? body.detail : body?.message || body?.error?.message || '';
  } catch {
    // not JSON
  }
  switch (response.status) {
    case 401:
      return 'TypeSafe rejected this API key.';
    case 403:
      return 'This TypeSafe key is not allowed to use Jev.';
    case 422:
      return `TypeSafe could not read the request${detail ? `: ${detail}` : '.'}`;
    case 429:
    case 529:
      return 'TypeSafe is busy. Posts will be tried again later.';
    default:
      return `TypeSafe answered with status ${response.status}${detail ? `: ${detail}` : '.'}`;
  }
}

export const NJ_API_URL = 'https://www.njlottery.com/api/v1/instant-games/games/?size=1000';
export const USER_AGENT = 'nj-scratch-tracker/0.1 (personal prize-availability analytics; polls at most every few hours)';

export class FetchError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface FetchResult {
  body: string;
  status: number;
  fetchedAt: number;
  url: string;
}

export interface FetchOptions {
  url?: string;
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fetch the official payload with timeouts and bounded exponential backoff on transient failures
 * (network errors, 429, 5xx). Never retries 4xx other than 429. Never bypasses access controls.
 */
export async function fetchGamesPayload(opts: FetchOptions = {}): Promise<FetchResult> {
  const { url = NJ_API_URL, retries = 3, timeoutMs = 30_000, baseDelayMs = 2_000, fetchImpl = fetch, sleep = defaultSleep, log = () => {} } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const retryAfter = lastErr instanceof FetchError && lastErr.status === 429 ? 30_000 : 0;
      const delay = Math.max(retryAfter, baseDelayMs * 2 ** (attempt - 1));
      log(`Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${retries + 1})…`);
      await sleep(delay);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ac.signal });
      const body = await res.text();
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        throw new FetchError(`NJ Lottery API responded ${res.status} ${res.statusText}`, res.status, retryable);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) throw new FetchError(`Unexpected content-type "${ct}" (expected JSON). The endpoint may have changed.`, res.status, false);
      return { body, status: res.status, fetchedAt: Date.now(), url };
    } catch (e) {
      lastErr = e instanceof FetchError ? e : new FetchError(`Network error: ${(e as Error).message}`, undefined, true);
      log(`Fetch failed: ${(lastErr as Error).message}`);
      if (!(lastErr as FetchError).retryable) throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

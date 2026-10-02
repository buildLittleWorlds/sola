export interface JsonRequest<T> { promise: Promise<T>; cancel: () => void }
let retryNumber = 0;

/** Bound both transport and body reading, even if a stalled worker ignores abort. */
export function createJsonRequest<T>(url: string, options: { timeoutMs?: number; refresh?: boolean } = {}): JsonRequest<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  let settled = false;
  let rejectDeadline!: (error: Error) => void;
  const timeoutError = () => new Error('The download took too long. Check your connection and retry. Your saved progress is unchanged.');
  const deadlinePromise = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const expire = () => { if (!settled) { rejectDeadline(timeoutError()); controller.abort(); } };
  const timer = setTimeout(expire, timeoutMs);
  const checkResume = () => { if (Date.now() >= deadline) expire(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', checkResume);
  if (typeof window !== 'undefined') window.addEventListener('pageshow', checkResume);
  const requestUrl = options.refresh ? `${url}${url.includes('?') ? '&' : '?'}bm-retry=${Date.now()}-${++retryNumber}` : url;
  const transfer = (async () => {
    const response = await fetch(requestUrl, { signal: controller.signal, cache: options.refresh ? 'reload' : 'default', credentials: 'same-origin' });
    if (response.status === 401 || response.status === 403 || response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('The site may need you to sign in again. Reload this page, sign in if asked, then retry. Your saved progress is unchanged.');
    }
    if (!response.ok) throw new Error(`The file could not be downloaded (${response.status}). Check your connection and retry.`);
    const data = await response.json() as T;
    if (Date.now() >= deadline) throw timeoutError();
    return data;
  })();
  const promise = Promise.race([transfer, deadlinePromise]).catch(error => {
    if (error instanceof SyntaxError) throw new Error('The downloaded file could not be read. Retry to download a fresh copy.');
    if (error instanceof TypeError) throw new Error('The download was interrupted. Check your connection and retry. Your saved progress is unchanged.');
    throw error;
  }).finally(() => {
    settled = true;
    clearTimeout(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', checkResume);
    if (typeof window !== 'undefined') window.removeEventListener('pageshow', checkResume);
  });
  return { promise, cancel: () => { if (!settled) { rejectDeadline(new Error('The download was restarted.')); controller.abort(); } } };
}

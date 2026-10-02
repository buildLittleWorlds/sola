import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createJsonRequest } from '../src/resources';
import type { Chapter } from '../src/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const chapters = JSON.parse(readFileSync('public/corpus/EXO.json', 'utf8')) as Chapter[];
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const rejected = <T>(promise: Promise<T>) => promise.then(
  () => { throw new Error('Expected the request to reject.'); },
  (error: unknown) => error as Error,
);

beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded JSON requests', () => {
  it('returns parsed JSON and clears its deadline after success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ chapter: 'EXO.1' })));
    await expect(createJsonRequest<{ chapter: string }>('/corpus/EXO.json').promise).resolves.toEqual({ chapter: 'EXO.1' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles after 15 seconds even when fetch ignores abort', async () => {
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const request = createJsonRequest('/corpus/EXO.json');
    const outcome = rejected(request.promise);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await outcome).message).toMatch(/timed out|too long|reconnect|connection/i);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the deadline active while the response body is still pending', async () => {
    const body = deferred<unknown>();
    const readBody = vi.fn(() => body.promise);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'Content-Type': 'application/json' }), json: readBody }));
    const request = createJsonRequest('/corpus/EXO.json');
    const outcome = rejected(request.promise);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(readBody).toHaveBeenCalledTimes(1);
    expect((await outcome).message).toMatch(/timed out|too long|reconnect|connection/i);
    // A late body must not resurrect the already-failed request.
    body.resolve({ stale: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets optional reading aids use a longer deadline without an unbounded wait', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})));
    const outcome = rejected(createJsonRequest('/aids/EXO.json', { timeoutMs: 30_000 }).promise);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await outcome).message).toMatch(/timed out|too long|reconnect|connection/i);
  });

  it('notices an expired deadline when a backgrounded phone returns before suspended timers run', async () => {
    const document = new EventTarget();
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})));
    const outcome = rejected(createJsonRequest('/corpus/EXO.json').promise);
    // Jump wall time only: iOS may suspend the tab's timer while backgrounded.
    vi.setSystemTime(Date.now() + 20_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect((await outcome).message).toMatch(/timed out|too long|reconnect|connection/i);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels promptly even when the browser never rejects the underlying fetch', async () => {
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const request = createJsonRequest('/corpus/EXO.json');
    const outcome = rejected(request.promise);
    request.cancel();
    expect(await outcome).toBeInstanceOf(Error);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports unsuccessful HTTP and invalid JSON instead of returning an unusable book', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await rejected(createJsonRequest('/corpus/EXO.json').promise)).toBeInstanceOf(Error);
    expect(await rejected(createJsonRequest('/corpus/EXO.json').promise)).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives each explicit refresh a unique query while preserving the book URL', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(json([])));
    vi.stubGlobal('fetch', fetch);
    await createJsonRequest('/corpus/EXO.json', { refresh: true }).promise;
    await createJsonRequest('/corpus/EXO.json', { refresh: true }).promise;
    const urls = fetch.mock.calls.map(([input]) => new URL(String(input), 'http://localhost'));
    expect(urls.map(url => url.pathname)).toEqual(['/corpus/EXO.json', '/corpus/EXO.json']);
    expect(urls.every(url => url.searchParams.has('bm-retry'))).toBe(true);
    expect(urls[0].searchParams.get('bm-retry')).not.toBe(urls[1].searchParams.get('bm-retry'));
  });
});

describe('book request recovery', () => {
  it('shares one book fetch between chapters and evicts a timed-out request', async () => {
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation(() => Promise.resolve(json(chapters)));
    vi.stubGlobal('fetch', fetch);
    const { loadChapter } = await import('../src/corpus');
    const first = rejected(loadChapter('EXO.1'));
    const second = rejected(loadChapter('EXO.2'));
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await first).toBeInstanceOf(Error);
    expect(await second).toBeInstanceOf(Error);
    await expect(loadChapter('EXO.1')).resolves.toMatchObject({ id: 'EXO.1' });
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(loadChapter('EXO.2')).resolves.toMatchObject({ id: 'EXO.2' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refresh cancels a pending book and its stale failure cannot evict the replacement', async () => {
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    vi.stubGlobal('fetch', fetch);
    const { loadChapter } = await import('../src/corpus');
    const original = rejected(loadChapter('EXO.1'));
    const replacement = loadChapter('EXO.1', true);
    expect(await original).toBeInstanceOf(Error);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    old.reject(new Error('A delayed failure from the original connection'));
    await vi.advanceTimersByTimeAsync(0);
    const otherChapter = loadChapter('EXO.2');
    expect(fetch).toHaveBeenCalledTimes(2);
    fresh.resolve(json(chapters));
    await expect(replacement).resolves.toMatchObject({ id: 'EXO.1' });
    await expect(otherChapter).resolves.toMatchObject({ id: 'EXO.2' });
    expect(new URL(String(fetch.mock.calls[1][0]), 'http://localhost').searchParams.has('bm-retry')).toBe(true);
  });
});

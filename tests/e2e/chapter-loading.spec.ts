import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { buildCircuit, initialProgress, makeBackup, setEndpoint } from '../../src/model';
import type { Corpus } from '../../src/types';

const corpus = JSON.parse(readFileSync('public/corpus/index.json', 'utf8')) as Corpus;
const exodus = readFileSync('public/corpus/EXO.json', 'utf8');

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await expect(page.getByRole('button', { name: 'Reveal passage', exact: true })).toBeEnabled();
}

async function selectChapter(page: Page, name: string) {
  await page.getByRole('button', { name: 'Browse chapters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find a chapter' }).fill(name);
  await page.getByRole('button', { name: `Practice ${name}`, exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText(name);
}

async function expectExodus(page: Page, words = 3) {
  await expect(page.getByRole('button', { name: 'Reveal passage', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
  await expect(page.getByTestId('passage')).toContainText('וְאֵלֶּה');
  await expect(page.getByTestId('passage')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.word-aid')).toHaveCount(words);
  await expect(page.locator('.aid-gloss').nth(1)).toContainText('names');
}

test.describe('new book loading and recovery', () => {
  // A cold browser with no service worker makes the failure originate in the
  // visible chapter fetch, independently of the background offline download.
  test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

  test('a stalled Exodus request becomes a recoverable error and retry fetches a fresh URL', async ({ page }) => {
    const urls: string[] = [];
    let stalled: Route | undefined;
    await page.route('**/corpus/EXO.json*', async route => {
      urls.push(route.request().url());
      if (urls.length === 1) { stalled = route; return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: exodus });
    });
    await page.clock.install();
    await open(page);
    await selectChapter(page, 'Exodus 1');
    await expect(page.getByText('Opening chapter…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry chapter', exact: true })).toBeVisible();
    await expect.poll(() => urls.length).toBe(1);
    await page.clock.fastForward(15_001);
    await expect(page.locator('.text-error')).toContainText(/timed out|too long|reconnect|connection/i);
    await expect(page.getByText('Opening chapter…', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry chapter', exact: true }).click();
    await expectExodus(page);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[1]).searchParams.has('bm-retry')).toBe(true);
    await stalled?.abort().catch(() => {});
  });

  test('retry can replace a hanging chapter immediately without waiting for its deadline', async ({ page }) => {
    let attempts = 0;
    let stalled: Route | undefined;
    await page.route('**/corpus/EXO.json*', async route => {
      if (++attempts === 1) { stalled = route; return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: exodus });
    });
    await open(page);
    await selectChapter(page, 'Exodus 1');
    await expect(page.getByText('Opening chapter…', { exact: true })).toBeVisible();
    await expect.poll(() => attempts).toBe(1);
    await page.getByRole('button', { name: 'Retry chapter', exact: true }).click();
    await expectExodus(page);
    expect(attempts).toBe(2);
    await stalled?.abort().catch(() => {});
  });

  test('a late Exodus response cannot replace the chapter selected after leaving it', async ({ page }) => {
    let stalled: Route | undefined;
    await page.route('**/corpus/EXO.json*', route => { stalled = route; });
    await open(page);
    await selectChapter(page, 'Exodus 1');
    await expect(page.getByText('Opening chapter…', { exact: true })).toBeVisible();
    await expect.poll(() => Boolean(stalled)).toBe(true);
    await selectChapter(page, 'Genesis 1');
    await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
    await stalled!.fulfill({ status: 200, contentType: 'application/json', body: exodus }).catch(() => {});
    await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
    await expect(page.getByTestId('passage')).toContainText('בְּרֵאשִׁית');
    await expect(page.locator('.aid-gloss').first()).toContainText('beginning');
    await expect(page.getByTestId('passage')).not.toContainText('וְאֵלֶּה');
  });

  test('a stalled reading-aid download leaves Exodus original text usable', async ({ page }) => {
    let stalled: Route | undefined;
    await page.route('**/aids/EXO.json*', route => { stalled = route; });
    await page.clock.install();
    await open(page);
    await selectChapter(page, 'Exodus 1');
    await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
    await expect(page.getByTestId('passage')).toContainText('וְאֵלֶּה');
    await expect(page.getByRole('button', { name: 'Next chapter', exact: true })).toBeEnabled();
    await expect.poll(() => Boolean(stalled)).toBe(true);
    await page.clock.fastForward(30_001);
    await expect(page.getByRole('button', { name: 'Retry reading aids', exact: true })).toBeVisible();
    await expect(page.getByTestId('passage')).toContainText('וְאֵלֶּה');
    await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
    await expect(page.locator('.target-row')).toContainText('6 words');
    await expect(page.getByText('Progress saved on this device')).toBeVisible();
    await stalled?.abort().catch(() => {});
  });

  test('a cold Exodus library visit displays original words and matching meanings on a phone layout', async ({ page }) => {
    await open(page);
    await selectChapter(page, 'Exodus 1');
    await expectExodus(page);
    await expect(page.locator('.aid-pronunciation')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
    await expect(page.getByTestId('chapter-title')).toHaveText('Exodus 2');
    await expect(page.getByRole('button', { name: 'Reveal passage', exact: true })).toBeEnabled();
  });
});

test('the real Genesis-to-Exodus circuit boundary and saved Exodus target reopen offline', async ({ page, context }) => {
  await open(page);
  const circuit = buildCircuit(corpus);
  const exodusMeta = corpus.chapters.find(chapter => chapter.id === 'EXO.1')!;
  const progress = setEndpoint(initialProgress(corpus), exodusMeta, 9);
  progress.circuit.position = circuit.indexOf('GEN.50');
  await page.getByRole('button', { name: 'Settings & backup', exact: true }).click();
  await page.getByLabel('Backup file', { exact: true }).setInputFiles({
    name: 'boundary-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(makeBackup(progress))),
  });
  await page.getByRole('button', { name: 'Replace with this backup', exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 50');
  await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Matthew 14');
  await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Exodus 1');
  await expectExodus(page, 9);
  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await expect(page.locator('.target-row')).toContainText('12 words');
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await expect(page.getByText('All 66 books available offline')).toBeVisible({ timeout: 45_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('chapter-title')).toHaveText('Exodus 1');
  await expect(page.locator('.target-row')).toContainText('12 words');
  await expectExodus(page, 12);
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
});

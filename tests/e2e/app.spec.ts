import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await expect(page.getByRole('button', { name: 'Reveal passage' })).toBeEnabled();
});
async function browse(page: import('@playwright/test').Page, book: string, chapter: number) {
  await page.getByRole('button', { name: 'Browse chapters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find a chapter' }).fill(`${book} ${chapter}`);
  await page.getByRole('button', { name: `Practice ${book} ${chapter}`, exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText(`${book} ${chapter}`);
  await expect(page.getByRole('button', { name: 'Reveal passage' })).toBeEnabled();
}

test('recall, grow, move through the circuit and reload exact progress', async ({ page }) => {
  await expect(page.getByTestId('passage')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('passage')).toContainText('בְּרֵאשִׁית');
  await expect(page.getByTestId('passage')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await expect(page.locator('.new-word')).toHaveCount(3);
  await expect(page.locator('.target-row')).toContainText('6 words');
  await page.keyboard.press('n');
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 2');
  await expect(page.getByTestId('passage')).toHaveCount(0);
  await page.keyboard.press('n');
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 3');
  await page.keyboard.press('n');
  await expect(page.getByTestId('chapter-title')).toHaveText('Matthew 1');
  await expect(page.getByRole('button', { name: 'Reveal passage' })).toBeEnabled();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('passage')).toContainText('Βίβλος');
  await expect(page.getByTestId('passage')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('chapter-title')).toHaveText('Matthew 1');
  await expect(page.getByTestId('passage')).toHaveCount(0);
  await page.keyboard.press('p'); await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 3');
  await page.keyboard.press('p'); await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 2');
  await page.keyboard.press('p'); await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await expect(page.locator('.target-row')).toContainText('6 words');
});

test('full chapter selection, one-word adjustments, browsing and resume', async ({ page }) => {
  await browse(page, 'John', 3);
  await page.getByRole('button', { name: 'View full chapter' }).click();
  await page.getByRole('button', { name: /^Set endpoint to word 20:/ }).click();
  await expect(page.locator('.target-row')).toContainText('20 words');
  await page.getByRole('button', { name: 'Remove one word' }).click();
  await expect(page.locator('.target-row')).toContainText('19 words');
  await page.getByRole('button', { name: 'Add one word' }).click();
  await expect(page.locator('.target-row')).toContainText('20 words');
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('John 4');
  await page.getByRole('button', { name: 'Resume circuit', exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await browse(page, 'John', 3);
  await expect(page.locator('.target-row')).toContainText('20 words');
  await expect(page.getByText('1 visit recorded', { exact: false })).toBeVisible();
});

test('settings, diacritics, variant inspection, source boundaries and long chapter', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings & backup' }).click();
  await page.getByLabel('Words to add at a time').selectOption('5');
  await page.getByLabel('Show Hebrew cantillation').check();
  await page.getByLabel('Text size', { exact: true }).fill('52');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Add 5 words' }).click();
  await expect(page.getByTestId('passage')).toContainText('בְּרֵאשִׁ֖ית');
  await expect(page.getByTestId('passage')).toHaveCSS('font-size', '52px');
  await browse(page, 'Genesis', 30);
  await page.getByRole('button', { name: 'View full chapter' }).click();
  await page.getByText('Reading & written forms', { exact: false }).click();
  await expect(page.locator('.variant-row').filter({ hasText: 'בגד' })).toBeVisible();
  await browse(page, 'Joel', 4);
  await expect(page.locator('.edition-label')).toContainText('source numbering');
  await browse(page, 'Psalms', 119);
  await page.getByRole('button', { name: 'View full chapter' }).click();
  await expect(page.getByTestId('passage').locator('.verse')).toHaveCount(176);
});

test('backups preview before replacing, round trip, and reject wrong editions', async ({ page }) => {
  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await page.getByRole('button', { name: 'Settings & backup' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.progress.chapters['GEN.1'].wordCount).toBe(6);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await page.getByRole('button', { name: 'Settings & backup' }).click();
  const upload = async (data: unknown) => page.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await upload(saved);
  await expect(page.getByRole('heading', { name: 'Review this backup' })).toBeVisible();
  await expect(page.locator('.target-row')).toContainText('9 words');
  await page.getByRole('button', { name: 'Replace with this backup' }).click();
  await expect(page.locator('.target-row')).toContainText('6 words');
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await page.getByRole('button', { name: 'Settings & backup' }).click();
  saved.progress.contentHash = 'different-text';
  await upload(saved);
  await expect(page.getByRole('alert')).toContainText('different corpus');
  await expect(page.getByRole('button', { name: 'Replace with this backup' })).toHaveCount(0);
  await expect(page.locator('.target-row')).toContainText('6 words');
});

test('all books and fonts work after network is disabled', async ({ page, context }) => {
  await expect(page.getByText('All 66 books available offline')).toBeVisible({ timeout: 30000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await expect(page.getByRole('button', { name: 'Reveal passage' })).toBeEnabled();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('passage')).toContainText('בְּרֵאשִׁית');
  await browse(page, 'Revelation', 22);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('passage')).toContainText('Καὶ');
  const fontLoaded = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('44px "Gentium Plus"'); });
  expect(fontLoaded).toBe(true);
});

test('save failure stays visible, permits backup and retries without losing edits', async ({ page }) => {
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as unknown as { restoreStorage: () => void }).restoreStorage = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      if (args[1] === 'readwrite') throw new DOMException('Test quota failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('not been saved');
  await expect(page.locator('.target-row')).toContainText('6 words');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current progress' }).click();
  expect(JSON.parse(await readFile((await (await dl).path())!, 'utf8')).progress.chapters['GEN.1'].wordCount).toBe(6);
  await page.evaluate(() => (window as unknown as { restoreStorage: () => void }).restoreStorage());
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.target-row')).toContainText('6 words');
});

test('keyboard shortcuts do not interfere with search or dialog controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Browse chapters', exact: true }).click();
  await page.getByLabel('Find a chapter').fill('John 3');
  await page.keyboard.press('n'); await page.keyboard.press('Space');
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await expect(page.getByTestId('passage')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a second tab cannot overwrite the active tab’s progress', async ({ page, context }) => {
  const second = await context.newPage(); await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Already open elsewhere' })).toBeVisible();
  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await page.close();
  await second.getByRole('button', { name: 'Try again' }).click();
  await expect(second.locator('.target-row')).toContainText('6 words');
});

test('small screen contains the review controls without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('passage')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 2');
});

test('phone installation assets and touch controls are ready', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.name).toContain('Hebrew & Greek');
  for (const icon of manifest.icons.filter((i: { type: string }) => i.type === 'image/png')) {
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
  }
  expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')).toBe('/icons/apple-touch-icon.png');
  await page.setViewportSize({ width: 375, height: 667 });
  for (const name of ['Reveal passage', 'Next chapter', 'Add one word', 'Remove one word']) {
    const bounds = await page.getByRole('button', { name }).boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const reveal = await page.getByRole('button', { name: 'Reveal passage' }).boundingBox();
  const next = await page.getByRole('button', { name: 'Next chapter' }).boundingBox();
  expect(reveal!.y + reveal!.height).toBeLessThan(next!.y);
  await page.screenshot({ path: 'test-results/phone-hebrew-recall.png', fullPage: true });
  await browse(page, 'Matthew', 1);
  await page.getByRole('button', { name: 'Reveal passage' }).click();
  await expect(page.getByTestId('passage')).toContainText('Βίβλος');
  await page.screenshot({ path: 'test-results/phone-greek-reveal.png', fullPage: true });
});

test('browser restart retains exact progress and circuit position', async ({ baseURL }) => {
  const profile = await mkdtemp(join(tmpdir(), 'bible-memory-e2e-'));
  let context = await chromium.launchPersistentContext(profile, { headless: true });
  try {
    let page = await context.newPage(); await page.goto(baseURL!);
    await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
    await page.getByRole('button', { name: 'Next chapter' }).click();
    await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 2');
    await expect(page.getByText('Progress saved on this device')).toBeVisible();
    await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true });
    page = await context.newPage(); await page.goto(baseURL!);
    await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 2');
    await expect(page.getByRole('button', { name: 'Reveal passage' })).toBeEnabled();
    await page.keyboard.press('p');
    await expect(page.locator('.target-row')).toContainText('6 words');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await expect(page.getByRole('button', { name: 'Reveal passage', exact: true })).toBeEnabled();
}

async function browse(page: Page, book: string, chapter: number) {
  await page.getByRole('button', { name: 'Browse chapters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find a chapter' }).fill(`${book} ${chapter}`);
  await page.getByRole('button', { name: `Practice ${book} ${chapter}`, exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText(`${book} ${chapter}`);
  await expect(page.getByRole('button', { name: 'Reveal passage', exact: true })).toBeEnabled();
}

test('reading aids reveal only the target, grow with it, and expose word details without changing the circuit', async ({ page }) => {
  await open(page);
  await expect(page.locator('.word-aid')).toHaveCount(0);
  await expect(page.locator('.aid-gloss')).toHaveCount(0);
  await expect(page.locator('.aid-pronunciation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
  await expect(page.locator('.word-aid')).toHaveCount(3);
  await expect(page.locator('.aid-gloss')).toHaveCount(3);
  await expect(page.locator('.aid-gloss').first()).toContainText('beginning');
  await expect(page.locator('.aid-pronunciation').first()).toContainText('be');
  await expect(page.locator('.aid-pronunciation').first().locator('strong')).toHaveText('shit');
  await expect(page.getByTestId('passage')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.aid-gloss').first()).toHaveAttribute('dir', 'ltr');

  await page.getByRole('button', { name: /^Word details:/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Word details', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('beginning');
  await page.keyboard.press('n');
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await expect(page.locator('.word-aid')).toHaveCount(6);
  await expect(page.locator('.aid-gloss')).toHaveCount(6);
  await expect(page.locator('.new-word')).toHaveCount(3);
  await page.getByRole('button', { name: 'Hide passage' }).click();
  await expect(page.locator('.word-aid')).toHaveCount(0);
  await expect(page.locator('.aid-gloss')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 2');
  await expect(page.locator('.word-aid')).toHaveCount(0);
});

test('independent reading preferences persist while full-chapter tapping still selects the endpoint', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Settings & backup', exact: true }).click();
  await expect(page.getByLabel('Show literal meanings', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Show Hebrew transliteration', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Show Greek transliteration', { exact: true })).toBeChecked();
  await page.getByLabel('Show literal meanings', { exact: true }).uncheck();
  await page.getByLabel('Show Hebrew transliteration', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
  await expect(page.getByTestId('passage')).toContainText('בְּרֵאשִׁית');
  await expect(page.locator('.aid-gloss')).toHaveCount(0);
  await expect(page.locator('.aid-pronunciation')).toHaveCount(0);

  await browse(page, 'Matthew', 1);
  await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
  await expect(page.locator('.aid-pronunciation')).toHaveCount(3);
  await expect(page.locator('.aid-pronunciation').first().locator('strong')).toHaveText(/bi/i);
  await expect(page.locator('.aid-gloss')).toHaveCount(0);
  await page.getByRole('button', { name: 'View full chapter', exact: true }).click();
  await page.getByRole('button', { name: /^Set endpoint to word 20:/ }).click();
  await expect(page.locator('.target-row')).toContainText('20 words');
  await expect(page.locator('.aid-pronunciation')).toHaveCount(20);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume circuit', exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await expect(page.locator('.target-row')).toContainText('3 words');
});

test('all bundled word aids reopen offline, including an unvisited Greek book', async ({ page, context }) => {
  await open(page);
  await expect(page.getByText('All 66 books available offline')).toBeVisible({ timeout: 45000 });
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
  await expect(page.locator('.aid-gloss').first()).toContainText('beginning');
  await expect(page.locator('.aid-pronunciation').first().locator('strong')).toHaveText('shit');
  await browse(page, 'Revelation', 22);
  await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
  await expect(page.locator('.aid-gloss')).toHaveCount(3);
  await expect(page.locator('.aid-pronunciation')).toHaveCount(3);
  await page.getByRole('button', { name: /^Word details:/ }).first().click();
  await expect(page.getByRole('dialog')).toContainText(/and/i);
});

test('untranslated Greek articles receive a grammatical explanation rather than a dash', async ({ page }) => {
  await open(page);
  await browse(page, 'Matthew', 1);
  await page.getByRole('button', { name: 'View full chapter', exact: true }).click();
  await page.getByRole('button', { name: /^Set endpoint to word 20:/ }).click();
  const article = page.locator('[data-token="MAT.1:2:2"]');
  await expect(article.locator('.aid-gloss')).toContainText('article');
  await expect(article.locator('.aid-gloss')).not.toHaveText('-');
  await article.getByRole('button').click();
  await expect(page.getByRole('dialog')).toContainText('article');
  await expect(page.getByRole('dialog')).toContainText('Documented correction');
});

test('a mismatched aid file leaves the original text and progress usable and can be retried', async ({ page }) => {
  await page.route('**/aids/GEN.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ schemaVersion: 1, bookId: 'GEN', corpusHash: 'different-edition', chapters: {} }),
  }));
  await open(page);
  await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
  await expect(page.getByTestId('passage')).toContainText('בְּרֵאשִׁית');
  await expect(page.getByRole('alert')).toContainText('do not match this edition');
  await expect(page.locator('.aid-pronunciation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await expect(page.locator('.target-row')).toContainText('6 words');
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await page.unroute('**/aids/GEN.json');
  await page.getByRole('button', { name: 'Retry reading aids', exact: true }).click();
  await expect(page.locator('.aid-gloss').first()).toContainText('beginning');
  await expect(page.locator('.aid-pronunciation')).toHaveCount(6);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.target-row')).toContainText('6 words');
});

test('an incomplete bundle with the right corpus hash is evicted so retry can recover its missing token', async ({ page }) => {
  let corrupt = true;
  await page.route('**/aids/GEN.json', async route => {
    const response = await route.fetch();
    const data = await response.json();
    // The corpus hash, book, and other chapters remain correct. This targets
    // token completeness validation after a successful fetch, not HTTP failure.
    if (corrupt) delete data.chapters['GEN.1']['1:0'];
    await route.fulfill({ response, json: data });
  });
  await open(page);
  await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('reading aids are incomplete');
  await expect(page.getByTestId('passage')).toContainText('בְּרֵאשִׁית');
  await expect(page.locator('.aid-pronunciation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await expect(page.locator('.target-row')).toContainText('6 words');
  corrupt = false;
  await page.getByRole('button', { name: 'Retry reading aids', exact: true }).click();
  await expect(page.locator('.aid-gloss').first()).toContainText('beginning');
  await expect(page.locator('.aid-pronunciation')).toHaveCount(6);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.target-row')).toContainText('6 words');
});

test('a legacy worker readiness signal cannot claim the current reading aids are available offline', async ({ page, request }) => {
  const manifest = await (await request.get('/aids/manifest.json')).json();
  // Simulate an already-active pre-aids worker while the new release installs.
  // Actual cache completeness/reopening is covered by the offline test above.
  await page.addInitScript(() => {
    const container = navigator.serviceWorker;
    const state = window as unknown as { oldWorkerRequests: number };
    state.oldWorkerRequests = 0;
    const active = {
      postMessage(data: { type: string }) {
        if (data.type === 'OFFLINE_STATUS') {
          state.oldWorkerRequests++;
          container.dispatchEvent(new MessageEvent('message', { data: { type: 'OFFLINE_READY' } }));
        }
      },
    };
    const registration = { active, installing: null, waiting: null, addEventListener() {} };
    Object.defineProperty(container, 'register', { configurable: true, value: async () => registration });
    Object.defineProperty(container, 'ready', { configurable: true, value: Promise.resolve(registration) });
  });
  await open(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { oldWorkerRequests: number }).oldWorkerRequests)).toBeGreaterThan(0);
  await expect(page.getByText('Preparing offline access…', { exact: true })).toBeVisible();
  await expect(page.getByText('All 66 books available offline')).toHaveCount(0);
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OFFLINE_READY', aidVersion: 'previous-release' } })));
  await expect(page.getByText('All 66 books available offline')).toHaveCount(0);
  await page.evaluate(aidVersion => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OFFLINE_READY', aidVersion } })), manifest.version);
  await expect(page.getByText('All 66 books available offline')).toBeVisible();
});

test('phone word groups keep their reading lines aligned and navigation reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await open(page);
  await page.getByRole('button', { name: 'Add 3 words', exact: true }).click();
  await expect(page.locator('.word-aid')).toHaveCount(6);
  await expect(page.locator('.aid-gloss')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const groups = await page.locator('.word-aid').evaluateAll(elements => elements.map(el => {
    const bounds = el.getBoundingClientRect();
    const children = [...el.querySelectorAll('.aid-pronunciation, .aid-gloss')];
    return children.every(child => { const r = child.getBoundingClientRect(); return r.left >= bounds.left - 1 && r.right <= bounds.right + 1; });
  }));
  expect(groups.every(Boolean)).toBe(true);
  await page.screenshot({ path: 'test-results/phone-hebrew-reading-aids.png', fullPage: true });
  await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 2');
  await browse(page, 'Matthew', 1);
  await page.getByRole('button', { name: 'Reveal passage', exact: true }).click();
  await expect(page.locator('.aid-pronunciation')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/phone-greek-reading-aids.png', fullPage: true });
});

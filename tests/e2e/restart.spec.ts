import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { initialProgress, setEndpoint } from '../../src/model';
import type { Corpus } from '../../src/types';
const corpus = JSON.parse(readFileSync('public/corpus/index.json', 'utf8')) as Corpus;

async function seed(page: Page, legacyHandled = true) {
  await page.goto('/icon.svg');
  const p = setEndpoint(initialProgress(corpus), corpus.chapters[0], 18);
  p.circuit = { position: 5, round: 2 }; p.chapters['GEN.1'].visits = 7;
  await page.evaluate(async ({ progress, handled }) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('bible-memory', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('state'); req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result; const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(progress, 'progress');
        if (handled) tx.objectStore('state').put({ appliedAt: '2026-09-26T23:00:00Z' }, 'completed-action:owner-request-genesis-start-2026-09-27');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  }, { progress: p, handled: legacyHandled });
}

test('direct restart works from Genesis 5 even after the old reset was handled, and later reloads retain new progress', async ({ page }) => {
  await seed(page);
  await page.goto('/restart.html');
  await expect(page.locator('#place')).toContainText('Saved place: Genesis 5');
  await expect(page.locator('#place')).toContainText('18 words');
  await page.getByRole('button', { name: 'Restart at Genesis 1' }).click();
  await expect(page.locator('#message')).toContainText('Saved. Your next review starts at Genesis 1.');
  await page.getByRole('link', { name: 'Continue at Genesis 1' }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 1');
  await expect(page.locator('.target-row')).toContainText('18 words');
  await expect(page.getByText('7 visits recorded', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 2');
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 2');
});

test('visiting the reset page alone or the main app does not silently change the cursor', async ({ page }) => {
  await seed(page, false);
  await page.goto('/restart.html');
  await expect(page.locator('#place')).toContainText('Genesis 5');
  await page.getByRole('link', { name: 'Return to Bible Memory' }).click();
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 5');
});

test('restart waits for another app tab to close instead of racing its saved progress', async ({ page, context }) => {
  await seed(page);
  await page.goto('/');
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 5');
  const restart = await context.newPage(); await restart.goto('/restart.html');
  await restart.getByRole('button', { name: 'Restart at Genesis 1' }).click();
  await expect(restart.locator('#message')).toContainText('Close the other Bible Memory tab');
  await expect(page.getByTestId('chapter-title')).toHaveText('Genesis 5');
  await page.close();
  await restart.getByRole('button', { name: 'Restart at Genesis 1' }).click();
  await expect(restart.locator('#message')).toContainText('Saved. Your next review starts at Genesis 1.');
});

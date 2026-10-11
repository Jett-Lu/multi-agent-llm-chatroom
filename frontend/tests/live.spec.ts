import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

test.skip(!process.env.TEST_DATABASE_URL, 'Requires disposable PostgreSQL via TEST_DATABASE_URL');

test('browser → gateway → provider → PostgreSQL → protected dashboard', async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Provider secret').fill('sk_test_only_provider_key');
  await page.getByLabel('Message', { exact: true }).fill('Test conversation must never be stored');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Verified upstream reply', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Usage analytics', exact: true }).click();
  await page.getByLabel('Administrator secret').fill('e2e-only-admin-secret-never-use-outside-tests');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'e2e-test-model' })).toBeVisible();
  await expect(page.getByRole('meter', { name: `Requests on ${new Date().toISOString().slice(0, 10)}` })).toBeVisible();
  const cookie = (await context.cookies()).find(cookie => cookie.name === 'gateway_analytics');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/analytics' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('gateway_analytics');
  await page.getByLabel('Model', { exact: true }).fill('e2e-test-model');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'e2e-test-model' })).toBeVisible();
  await expect(page.locator('.info-card').filter({ has: page.getByRole('heading', { name: 'Reported total tokens', exact: true }) })).not.toContainText('Unknown');
  await page.getByRole('region', { name: 'Usage analytics' }).scrollIntoViewIfNeeded();
  if (process.env.QA_SCREENSHOT_DIR) await page.getByRole('region', { name: 'Usage analytics' }).screenshot({ path: resolve(process.env.QA_SCREENSHOT_DIR, `analytics-${testInfo.project.name}.png`), scale: 'css' });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Administrator secret')).toBeVisible();
  await page.getByRole('button', { name: 'Use existing session' }).click();
  await expect(page.getByRole('alert')).toContainText('Sign in');
  await page.getByRole('button', { name: 'Clear Conversation', exact: true }).click();
  await expect(page.getByText('Verified upstream reply', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear API Key', exact: true }).click();
  await expect(page.getByLabel('Provider secret')).toHaveValue('');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(errors).toEqual([]);
});

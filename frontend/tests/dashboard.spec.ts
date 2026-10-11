import { test, expect } from '@playwright/test';

const metrics = { totalRequests: 8, successfulRequests: 6, failedRequests: 2, promptTokens: 20, completionTokens: 10, totalTokens: 30, requestsWithTotalTokens: 3, averageLatencyMs: 125 };
const wrap = (data: unknown) => ({ data, range: { start: '2026-01-01Z', end: '2026-01-02Z' }, telemetry: { enabled: true, pending: 0, written: 8, failed: 0, dropped: 0 } });

test('chat remains interactive; analytics authenticates, renders aggregates and clears on logout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/analytics/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session')) return route.fulfill({ json: { authenticated: true } });
    if (path.endsWith('/logout')) return route.fulfill({ status: 204 });
    const data = path.endsWith('/summary') ? metrics : { items: [{ ...metrics, model: 'test-model', timestamp: '2026-01-01T00:00:00.000Z', category: 'upstream_error' }], limit: 100, offset: 0, hasMore: false };
    await route.fulfill({ json: wrap(data) });
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/BringYourOwnAI|Secure AI/);
  await expect(page.getByRole('heading', { name: 'Secure AI API Gateway & Chat System' })).toBeVisible();
  await page.getByRole('button', { name: 'Usage analytics', exact: true }).click();
  await page.getByLabel('Administrator secret').fill('test-only-secret');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'test-model' })).toBeVisible();
  await expect(page.getByText('upstream_error: 8')).toBeVisible();
  await expect(page.getByRole('meter')).toHaveAttribute('value', '8');
  await expect(page.getByRole('button', { name: 'Next models' })).toBeDisabled();
  await page.getByLabel('Model', { exact: true }).fill('test-model');
  const filtered = page.waitForRequest(request => request.url().includes('/analytics/summary?') && request.url().includes('model=test-model'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await filtered;
  await expect(page.getByRole('cell', { name: 'test-model' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Administrator secret')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'test-model' })).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('shows restricted, database unavailable and empty-data states', async ({ page }) => {
  let status = 403;
  await page.route('**/api/analytics/**', route => route.fulfill({ status, json: status === 200 ? wrap(new URL(route.request().url()).pathname.endsWith('/summary') ? { ...metrics, totalRequests: 0 } : { items: [], hasMore: false, limit: 100, offset: 0 }) : { error: {} } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Usage analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Use existing session' }).click();
  await expect(page.getByRole('alert')).toContainText('restricted');
  status = 503;
  await page.getByRole('button', { name: 'Use existing session' }).click();
  await expect(page.getByRole('alert')).toContainText('database is unavailable');
  status = 200;
  await page.getByRole('button', { name: 'Use existing session' }).click();
  await expect(page.getByText('No usage recorded for this period.')).toBeVisible();
});

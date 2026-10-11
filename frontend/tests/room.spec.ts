import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.route('**/api/room/config', route => route.fulfill({ json: { models: ['model-a', 'model-b'], rounds: 3, maxOutputTokens: 800, maxPromptChars: 2000, maxInterjections: 20, maxMessages: 30 } }));
  await page.goto('/');
  await page.getByLabel('Builder API key').fill('sk_builder_test_key');
  await page.getByLabel('Skeptic API key').fill('sk_skeptic_test_key');
  await page.getByLabel('Discussion topic').fill('How should we design a useful library?');
}

test('three rounds and summary use distinct participant keys and show usage without browser storage', async ({ page }) => {
  const requests: any[] = [];
  await page.route('**/api/room/turn', route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const index = body.transcript.filter((item: any) => item.kind === 'agent').length;
    return route.fulfill({ json: { reply: `Answer ${index + 1}`, participantIndex: index === 6 ? 0 : index % 2, phase: index === 6 ? 'summary' : index < 2 ? 'opening' : index < 4 ? 'critique' : 'refinement', round: Math.min(3, Math.floor(index / 2) + 1), usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }, requestId: `request-${index}` } });
  });
  await setup(page);
  await page.getByLabel('Skeptic model').selectOption('model-b');
  await page.getByRole('button', { name: 'Start discussion', exact: true }).click();
  await expect(page.getByText('Discussion complete', { exact: true })).toBeVisible({ timeout: 15000 });
  expect(requests).toHaveLength(7);
  expect(requests.map(body => body.apiKey)).toEqual(['sk_builder_test_key', 'sk_skeptic_test_key', 'sk_builder_test_key', 'sk_skeptic_test_key', 'sk_builder_test_key', 'sk_skeptic_test_key', 'sk_builder_test_key']);
  expect(JSON.stringify(requests[0].participants)).not.toContain('sk_');
  await expect(page.getByText('70 / 20000 reported tokens', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Moderator summary' })).toBeVisible();
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Clear keys and room', exact: true }).click();
  await expect(page.getByLabel('Builder API key')).toHaveValue('');
  await expect(page.getByText('Answer 1', { exact: true })).toHaveCount(0);
});

test('manual turns allow interjections; pause and stop prevent the next request', async ({ page }) => {
  const requests: any[] = [];
  await page.route('**/api/room/turn', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    await route.fulfill({ json: { reply: 'First answer', participantIndex: 0, phase: 'opening', round: 1, usage: { totalTokens: 10 }, requestId: 'r' } });
  });
  await setup(page);
  await page.getByLabel('Run turns automatically').uncheck();
  await page.getByRole('button', { name: 'Start discussion', exact: true }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByLabel('Message to the room').fill('Include accessibility');
  await page.getByRole('button', { name: 'Add message', exact: true }).click();
  await expect(page.getByText('Include accessibility', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next turn', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].transcript.at(-1)).toEqual({ kind: 'user', content: 'Include accessibility' });
  await page.getByRole('button', { name: 'Stop discussion', exact: true }).click();
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next turn', exact: true })).toHaveCount(0);
});

test('missing usage stops automatic spending and explains the limitation', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/room/turn', route => { calls++; return route.fulfill({ json: { reply: 'Unmetered answer', participantIndex: 0, phase: 'opening', round: 1, usage: { totalTokens: null }, requestId: 'r' } }); });
  await setup(page);
  await page.getByRole('button', { name: 'Start discussion', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('did not report total token usage');
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test('clearing an in-flight response cannot restore keys or conversation', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/room/turn', async route => { await pending; await route.fulfill({ json: { reply: 'Late answer', participantIndex: 0, phase: 'opening', round: 1, usage: { totalTokens: 10 }, requestId: 'r' } }).catch(() => {}); });
  await setup(page);
  const started = page.waitForRequest('**/api/room/turn');
  await page.getByRole('button', { name: 'Start discussion', exact: true }).click();
  await started;
  await page.getByRole('button', { name: 'Clear keys and room', exact: true }).click();
  release();
  await expect(page.getByLabel('Builder API key')).toHaveValue('');
  await expect(page.getByText('Late answer', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start discussion', exact: true })).toBeDisabled();
});

test('pausing keeps the active answer but does not queue another billed turn', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/room/turn', async route => {
    calls++; await pending;
    await route.fulfill({ json: { reply: 'Answer before pause', participantIndex: 0, phase: 'opening', round: 1, usage: { totalTokens: 10 }, requestId: 'r' } });
  });
  await setup(page);
  const started = page.waitForRequest('**/api/room/turn');
  await page.getByRole('button', { name: 'Start discussion', exact: true }).click();
  await started;
  await page.getByRole('button', { name: 'Pause after current turn', exact: true }).click();
  release();
  await expect(page.getByText('Answer before pause', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next turn', exact: true })).toBeEnabled();
  // Advance beyond the automatic scheduling interval and prove it stayed paused.
  await page.waitForTimeout(900);
  expect(calls).toBe(1);
});

test('the reported token threshold prevents the next turn', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/room/turn', route => { calls++; return route.fulfill({ json: { reply: 'Budget answer', participantIndex: 0, phase: 'opening', round: 1, usage: { totalTokens: 120 }, requestId: 'r' } }); });
  await setup(page);
  await page.getByLabel('Total reported token limit').fill('100');
  await page.getByRole('button', { name: 'Start discussion', exact: true }).click();
  await expect(page.getByText('Token limit reached', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('No further turns');
  expect(calls).toBe(1);
});

test('a deployment message cap too small for the protocol prevents a billed start', async ({ page }) => {
  await setup(page);
  await page.route('**/api/room/config', route => route.fulfill({ json: { models: ['model-a'], rounds: 3, maxOutputTokens: 800, maxPromptChars: 2000, maxInterjections: 20, maxMessages: 5 } }));
  await page.reload();
  await page.getByLabel('Builder API key').fill('sk_builder_test_key');
  await page.getByLabel('Skeptic API key').fill('sk_skeptic_test_key');
  await page.getByLabel('Discussion topic').fill('A question');
  await expect(page.getByRole('button', { name: 'Start discussion', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('message limit is too small');
});

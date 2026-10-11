import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelemetryService } from '../src/services/telemetry.js';
import type { UsageEvent } from '../src/types/analytics.js';

Object.assign(process.env, { NODE_ENV: 'test', FRONTEND_ORIGIN: 'http://localhost:5173', UPSTREAM_API_URL: 'https://example.com/chat', UPSTREAM_MODEL: 'model-a', UPSTREAM_MODELS: 'model-a,model-b', RATE_LIMIT_MAX: '100', REQUEST_BODY_LIMIT: '128kb' });
const { createApp } = await import('../src/app.js');
const participants = [{ name: 'Builder', model: 'model-a', role: 'Propose options' }, { name: 'Skeptic', model: 'model-b', role: 'Challenge assumptions' }];
const payload = { apiKey: 'sk_private_key_123456789', participants, topic: 'Private topic', transcript: [], tokenBudget: 10000, tokensUsed: 0 };
const turn = (index: number) => ({ kind: 'agent', participantIndex: index % 2, content: `Private answer ${index}` });
const respond = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Private reply' } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('roundtable turns', () => {
  it('publishes only configured models and limits', async () => {
    const res = await request(createApp()).get('/api/room/config');
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual(['model-a', 'model-b']);
    expect(JSON.stringify(res.body)).not.toContain('https://');
  });
  it('keeps opening answers independent and selects the next configured model', async () => {
    let sent: any;
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => { sent = JSON.parse(init.body as string); return respond(); });
    const res = await request(createApp()).post('/api/room/turn').send({ ...payload, transcript: [turn(0)] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ participantIndex: 1, phase: 'opening', round: 1, reply: 'Private reply', usage: { totalTokens: 12 } });
    expect(sent.model).toBe('model-b');
    expect(JSON.stringify(sent.messages)).toContain('Private topic');
    expect(JSON.stringify(sent.messages)).not.toContain('Private answer 0');
    expect(sent.max_tokens).toBeLessThanOrEqual(800);
  });
  it('includes prior discussion for critique and asks the moderator to retain disagreements', async () => {
    const sent: any[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => { sent.push(JSON.parse(init.body as string)); return respond(); });
    const app = createApp();
    const critique = await request(app).post('/api/room/turn').send({ ...payload, transcript: [turn(0), turn(1), { kind: 'user', content: 'Consider accessibility' }] });
    expect(critique.body.phase).toBe('critique');
    expect(JSON.stringify(sent[0].messages)).toContain('Consider accessibility');
    expect(JSON.stringify(sent[0].messages)).toContain('Private answer 1');
    const summary = await request(app).post('/api/room/turn').send({ ...payload, transcript: Array.from({ length: 6 }, (_, i) => turn(i)) });
    expect(summary.body).toMatchObject({ phase: 'summary', participantIndex: 0 });
    expect(JSON.stringify(sent[1].messages)).toMatch(/disagreement/i);
  });
  it('rejects unknown models, forged turn order, exhausted budgets and completed rooms', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const app = createApp();
    for (const body of [
      { ...payload, participants: [{ ...participants[0], model: 'private-untrusted' }, participants[1]] },
      { ...payload, transcript: [turn(1)] },
      { ...payload, tokensUsed: 10000 },
      { ...payload, transcript: Array.from({ length: 7 }, (_, i) => turn(i)) },
      { ...payload, upstreamUrl: 'http://internal' }
    ]) expect((await request(app).post('/api/room/turn').send(body)).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('records allowlisted model metadata without participant names, roles, keys or content', async () => {
    const rows: UsageEvent[] = [];
    const telemetry = new TelemetryService({ insert: async row => { rows.push(row); } }, 10);
    vi.stubGlobal('fetch', respond);
    const res = await request(createApp({ telemetry })).post('/api/room/turn').send({ ...payload, transcript: [turn(0)] });
    expect(res.status).toBe(200);
    await telemetry.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: 'model-b', totalTokens: 12 });
    expect(JSON.stringify(rows)).not.toMatch(/Private|Builder|Skeptic|sk_private|Challenge/);
  });
});

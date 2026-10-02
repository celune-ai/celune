import { createScope } from '@celuneai/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, utf8ToHex, type TestApi } from '../testing/index.ts';

const WS = '11111111-1111-4111-8111-111111111111';
const scope = createScope({ workspaceId: WS });

let api: TestApi;
let token: string;

function seedJob(id = 'job-1') {
  return api.store.seedJob(scope, {
    id,
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    nonce: 'nonce-1',
    job_hmac: `hmac:${id}:nonce-1`,
    messages_encrypted: '\\x' + utf8ToHex(JSON.stringify([{ role: 'user', content: 'hi' }])),
    messages_iv: '\\x00',
    system_prompt_encrypted: '\\x' + utf8ToHex('be brief'),
    system_prompt_iv: '\\x00',
  });
}

beforeEach(async () => {
  api = await createTestApi();
  token = (await api.addKey({ workspaceId: WS })).raw;
});

describe('jobs routes', () => {
  it('lists pending jobs without ciphertext', async () => {
    seedJob();
    const res = await api.request('/jobs/pending', { token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queue_depth).toBe(1);
    expect(body.jobs[0]).not.toHaveProperty('messages_encrypted');
    expect(body.jobs[0]).not.toHaveProperty('job_hmac');
  });

  it('answers 404 for a job in another workspace and leaves it pending', async () => {
    const other = createScope({ workspaceId: '99999999-9999-4999-8999-999999999999' });
    api.store.seedJob(other, { id: 'foreign', status: 'pending', runner: 'external' });
    const res = await api.request('/jobs/foreign/claim', { method: 'POST', token });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Job not found' });
    expect(api.store.jobRows.get('foreign')?.status).toBe('pending');
    const missing = await api.request('/jobs/nope/claim', { method: 'POST', token });
    expect(missing.status).toBe(404);
  });

  it('claims with decryption, heartbeats, submits, and hands back the next job', async () => {
    seedJob('job-1');
    seedJob('job-2');
    const claim = await api.request('/jobs/job-1/claim', { method: 'POST', token });
    expect(claim.status).toBe(200);
    const claimed = await claim.json();
    expect(claimed.claimed).toBe(true);
    expect(claimed.job.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(claimed.job.system_prompt).toBe('be brief');

    const again = await api.request('/jobs/job-1/claim', { method: 'POST', token });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'Job is already claimed' });

    const beat = await api.request('/jobs/job-1/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ progress: { tokens_so_far: 10 } }),
      token,
    });
    expect(await beat.json()).toEqual({ continue: true });

    const submit = await api.request('/jobs/job-1/result', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        job_hmac: claimed.job.job_hmac,
        nonce: claimed.job.nonce,
        result: { content: 'done' },
      }),
      token,
    });
    expect(submit.status).toBe(200);
    const ack = await submit.json();
    expect(ack.acknowledged).toBe(true);
    expect(ack.next_job.id).toBe('job-2');

    const stored = await api.store.jobs.get(scope, 'job-1');
    expect(stored?.status).toBe('completed');
  });

  it('refuses a bad HMAC and a submission from another key', async () => {
    seedJob('job-1');
    const claim = await (await api.request('/jobs/job-1/claim', { method: 'POST', token })).json();
    const bad = await api.request('/jobs/job-1/result', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        job_hmac: 'wrong',
        nonce: claim.job.nonce,
        result: { content: 'x' },
      }),
      token,
    });
    expect(bad.status).toBe(403);

    const other = (await api.addKey({ workspaceId: WS })).raw;
    const notOwner = await api.request('/jobs/job-1/result', {
      method: 'POST',
      body: JSON.stringify({
        status: 'failed',
        job_hmac: claim.job.job_hmac,
        nonce: claim.job.nonce,
        error: { code: 'x', message: 'y', retryable: false },
      }),
      token: other,
    });
    expect(notOwner.status).toBe(403);
  });

  it('keeps JWT principals off the claim path', async () => {
    seedJob('job-1');
    const jwt = await api.mintJwt({ workspace_id: WS });
    const res = await api.request('/jobs/job-1/claim', { method: 'POST', token: jwt });
    expect(res.status).toBe(403);
    expect((await api.request('/jobs/pending', { token: jwt })).status).toBe(200);
  });

  it('gets and cancels a job, redacting secrets', async () => {
    seedJob('job-1');
    const got = await api.request('/jobs/job-1', { token });
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.id).toBe('job-1');
    expect(body).not.toHaveProperty('system_prompt_encrypted');

    const cancel = await api.request('/jobs/job-1/cancel', { method: 'POST', token });
    expect(cancel.status).toBe(200);
    expect((await cancel.json()).status).toBe('cancelled');
    expect((await api.request('/jobs/job-1/cancel', { method: 'POST', token })).status).toBe(409);
    expect((await api.request('/jobs/missing', { token })).status).toBe(404);
  });

  it('answers 501 when the host has no job crypto', async () => {
    const bare = await createTestApi({ host: { jobs: undefined } });
    const key = (await bare.addKey({ workspaceId: WS })).raw;
    bare.store.seedJob(scope, { id: 'job-9' });
    const res = await bare.request('/jobs/job-9/claim', { method: 'POST', token: key });
    expect(res.status).toBe(501);
  });
});

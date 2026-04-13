import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbMock } from '../helpers/fake-db.js';

const mocks = vi.hoisted(() => ({
  authenticateWriteRequest: vi.fn(),
  checkAndConsumeRateLimit: vi.fn(),
  json: vi.fn((data, init = {}) => new Response(JSON.stringify(data), init)),
  validateDisplayName: vi.fn(),
  verifyTurnstile: vi.fn(),
}));

vi.mock('../../functions/_lib/utils.js', () => ({
  authenticateWriteRequest: mocks.authenticateWriteRequest,
  checkAndConsumeRateLimit: mocks.checkAndConsumeRateLimit,
  json: mocks.json,
  validateDisplayName: mocks.validateDisplayName,
  verifyTurnstile: mocks.verifyTurnstile,
}));

import { __testables, onRequestPost } from '../../functions/api/leads/index.js';

describe('leads route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.validateDisplayName.mockReturnValue({ ok: true, value: 'valid-name' });
    mocks.authenticateWriteRequest.mockResolvedValue({
      ok: true,
      sid: 'sid-1',
      ipHashValue: 'ip-h',
      uaHashValue: 'ua-h',
    });
    mocks.checkAndConsumeRateLimit.mockResolvedValue({ ok: true });
    mocks.verifyTurnstile.mockResolvedValue({ ok: true });
  });

  it('normalizes body and validates every input branch', () => {
    expect(__testables.normalizeLeadBody({ consent: true }).consent).toBe(true);
    expect(__testables.normalizeLeadBody({ consent: 'true' }).consent).toBe(true);
    expect(__testables.normalizeLeadBody({ consent: 'on' }).consent).toBe(true);
    expect(__testables.normalizeLeadBody({ consent: false }).consent).toBe(false);

    expect(
      __testables.validateLeadInput({
        serviceType: 'bad',
        name: 'ok-name',
        email: 'a@b.com',
        message: '1234567890',
        consent: true,
      }).error
    ).toBe('invalid_service_type');

    mocks.validateDisplayName.mockReturnValueOnce({ ok: false, reason: 'name_charset' });
    expect(
      __testables.validateLeadInput({
        serviceType: 'training',
        name: 'bad<script>',
        email: 'a@b.com',
        message: '1234567890',
        consent: true,
      }).error
    ).toBe('name_charset');

    expect(
      __testables.validateLeadInput({
        serviceType: 'training',
        name: 'ok-name',
        email: 'bad-email',
        message: '1234567890',
        consent: true,
      }).error
    ).toBe('invalid_email');

    expect(
      __testables.validateLeadInput({
        serviceType: 'training',
        name: 'ok-name',
        email: 'a@b.com',
        message: 'short',
        consent: true,
      }).error
    ).toBe('message_length');

    expect(
      __testables.validateLeadInput({
        serviceType: 'training',
        name: 'ok-name',
        email: 'a@b.com',
        message: '1234567890',
        consent: false,
      }).error
    ).toBe('consent_required');
  });

  it('rejects invalid json and input-validation failures', async () => {
    let res = await onRequestPost({
      request: new Request('https://e/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
      env: {},
    });
    expect(res.status).toBe(400);

    res = await onRequestPost({
      request: new Request('https://e/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceType: 'training', name: 'n', email: 'x', message: 'x', consent: false }),
      }),
      env: {},
    });
    expect(res.status).toBe(400);
  });

  it('rejects auth/rate/turnstile/db branches', async () => {
    const mkReq = () =>
      new Request('https://e/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: 'training',
          name: 'my-name',
          email: 'a@example.com',
          message: 'this is a valid message',
          consent: true,
          turnstileToken: 'ok',
        }),
      });

    mocks.authenticateWriteRequest.mockResolvedValueOnce({ ok: false, status: 401, error: 'invalid_session' });
    let res = await onRequestPost({ request: mkReq(), env: {} });
    expect(res.status).toBe(401);

    mocks.checkAndConsumeRateLimit.mockResolvedValueOnce({ ok: false });
    res = await onRequestPost({ request: mkReq(), env: {} });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('lead_rate_limited');

    mocks.checkAndConsumeRateLimit
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false });
    res = await onRequestPost({ request: mkReq(), env: {} });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('lead_daily_limited');

    mocks.checkAndConsumeRateLimit.mockResolvedValue({ ok: true });
    mocks.verifyTurnstile.mockResolvedValueOnce({ ok: false, reason: 'turnstile_failed' });
    res = await onRequestPost({ request: mkReq(), env: {} });
    expect(res.status).toBe(403);

    res = await onRequestPost({ request: mkReq(), env: {} });
    expect(res.status).toBe(500);
  });

  it('stores lead and returns id/status on success', async () => {
    const db = createDbMock([{ match: 'INSERT INTO client_leads', run: () => ({ success: true }) }]);
    const res = await onRequestPost({
      request: new Request('https://e/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: 'consulting',
          name: 'my-name',
          email: 'A@Example.com',
          message: 'this is a valid message',
          consent: true,
          turnstileToken: 'ok',
        }),
      }),
      env: { DB: db },
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('new');
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO client_leads'))).toBe(true);
  });
});

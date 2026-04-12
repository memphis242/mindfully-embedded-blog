import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbMock } from '../helpers/fake-db.js';

const mocks = vi.hoisted(() => ({
  authenticateWriteRequest: vi.fn(),
  checkAndConsumeRateLimit: vi.fn(),
  json: vi.fn((data, init = {}) => new Response(JSON.stringify(data), init)),
  pageIdFromBody: vi.fn(),
}));

vi.mock('../../functions/_lib/utils.js', () => ({
  authenticateWriteRequest: mocks.authenticateWriteRequest,
  checkAndConsumeRateLimit: mocks.checkAndConsumeRateLimit,
  json: mocks.json,
  pageIdFromBody: mocks.pageIdFromBody,
}));

import { onRequestPost } from '../../functions/api/reactions/index.js';

describe('reactions index route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pageIdFromBody.mockReturnValue('article/test');
    mocks.authenticateWriteRequest.mockResolvedValue({ ok: true, sid: 'sid-1', ipHashValue: 'iphash' });
    mocks.checkAndConsumeRateLimit.mockResolvedValue({ ok: true });
  });

  it('rejects invalid json', async () => {
    const req = new Request('https://example.com/api/reactions', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(400);
  });

  it('rejects invalid page id', async () => {
    mocks.pageIdFromBody.mockReturnValue(null);
    const req = new Request('https://example.com/api/reactions', {
      method: 'POST',
      body: JSON.stringify({ reaction: 'like' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(400);
  });

  it('rejects invalid reaction value', async () => {
    const req = new Request('https://example.com/api/reactions', {
      method: 'POST',
      body: JSON.stringify({ reaction: 'maybe', pageId: 'article/test' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(400);
  });

  it('rejects when auth fails', async () => {
    mocks.authenticateWriteRequest.mockResolvedValue({ ok: false, status: 401, error: 'invalid_session' });
    const req = new Request('https://example.com/api/reactions', {
      method: 'POST',
      body: JSON.stringify({ reaction: 'like', pageId: 'article/test' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(401);
  });

  it('returns rate limit error', async () => {
    mocks.checkAndConsumeRateLimit.mockResolvedValue({ ok: false });
    const req = new Request('https://example.com/api/reactions', {
      method: 'POST',
      body: JSON.stringify({ reaction: 'like', pageId: 'article/test' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(429);
  });

  it('stores reaction and returns selected reaction', async () => {
    const db = createDbMock([{ match: 'INSERT INTO reactions', run: () => ({ success: true }) }]);

    const req = new Request('https://example.com/api/reactions', {
      method: 'POST',
      body: JSON.stringify({ reaction: 'dislike', pageId: 'article/test' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await onRequestPost({ request: req, env: { DB: db } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userReaction).toBe('dislike');
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO reactions'))).toBe(true);
  });
});

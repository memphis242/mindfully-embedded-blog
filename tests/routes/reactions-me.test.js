import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbMock } from '../helpers/fake-db.js';

const mocks = vi.hoisted(() => ({
  json: vi.fn((data, init = {}) => new Response(JSON.stringify(data), init)),
  parseCookies: vi.fn(),
  verifySessionToken: vi.fn(),
}));

vi.mock('../../functions/_lib/utils.js', () => ({
  json: mocks.json,
  parseCookies: mocks.parseCookies,
  verifySessionToken: mocks.verifySessionToken,
}));

import { onRequestGet } from '../../functions/api/reactions/me.js';

describe('reactions me route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseCookies.mockReturnValue({ meb_session: 'token' });
    mocks.verifySessionToken.mockResolvedValue({ ok: true, payload: { sid: 'sid-1' } });
  });

  it('rejects invalid page id', async () => {
    const req = new Request('https://example.com/api/reactions/me?pageId=BAD!');
    const res = await onRequestGet({ request: req, env: {} });
    expect(res.status).toBe(400);
  });

  it('returns null when session invalid', async () => {
    mocks.verifySessionToken.mockResolvedValue({ ok: false });
    const req = new Request('https://example.com/api/reactions/me?pageId=article/test');
    const res = await onRequestGet({ request: req, env: {} });
    const body = await res.json();
    expect(body.userReaction).toBeNull();
  });

  it('returns user reaction when present', async () => {
    const db = createDbMock([
      {
        match: 'SELECT reaction FROM reactions',
        first: () => ({ reaction: 'like' }),
      },
    ]);

    const req = new Request('https://example.com/api/reactions/me?pageId=article/test');
    const res = await onRequestGet({ request: req, env: { DB: db } });
    const body = await res.json();
    expect(body.userReaction).toBe('like');
  });
});

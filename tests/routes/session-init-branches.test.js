import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceOrigin: vi.fn(),
  ipHash: vi.fn(),
  issueSessionToken: vi.fn(),
  json: vi.fn((data, init = {}) => new Response(JSON.stringify(data), init)),
  parseCookies: vi.fn(),
  sessionCookieHeader: vi.fn(),
  uaHash: vi.fn(),
  verifySessionToken: vi.fn(),
}));

vi.mock('../../functions/_lib/utils.js', () => ({
  enforceOrigin: mocks.enforceOrigin,
  ipHash: mocks.ipHash,
  issueSessionToken: mocks.issueSessionToken,
  json: mocks.json,
  parseCookies: mocks.parseCookies,
  sessionCookieHeader: mocks.sessionCookieHeader,
  uaHash: mocks.uaHash,
  verifySessionToken: mocks.verifySessionToken,
}));

import { onRequestPost } from '../../functions/api/session/init.js';
import { createDbMock } from '../helpers/fake-db.js';

describe('session init branch closure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceOrigin.mockReturnValue({ ok: true });
    mocks.parseCookies.mockReturnValue({});
    mocks.issueSessionToken.mockResolvedValue('new-token');
    mocks.verifySessionToken.mockResolvedValue({ ok: true, payload: { sid: 'sid-1' } });
    mocks.ipHash.mockResolvedValue('ip-h');
    mocks.uaHash.mockResolvedValue('ua-h');
    mocks.sessionCookieHeader.mockReturnValue('meb_session=new-token; Path=/');
  });

  it('reuses existing valid session token branch', async () => {
    mocks.parseCookies.mockReturnValue({ meb_session: 'existing-token' });
    mocks.verifySessionToken.mockResolvedValue({ ok: true, payload: { sid: 'sid-existing' } });
    const db = createDbMock([{ match: 'INSERT INTO session_fingerprints', run: () => ({ success: true }) }]);

    const res = await onRequestPost({
      request: new Request('https://example.com/api/session/init', { method: 'POST' }),
      env: { DB: db },
    });

    expect(res.status).toBe(200);
    expect(mocks.issueSessionToken).not.toHaveBeenCalled();
    expect(mocks.verifySessionToken).toHaveBeenCalledWith('existing-token', { DB: db });
    expect(mocks.sessionCookieHeader).toHaveBeenCalledWith('existing-token', 86400);
  });

  it('falls back to issuing new token when existing token fails verification', async () => {
    mocks.parseCookies.mockReturnValue({ meb_session: 'bad-token' });
    mocks.verifySessionToken
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, payload: { sid: 'sid-new' } });
    const db = createDbMock([{ match: 'INSERT INTO session_fingerprints', run: () => ({ success: true }) }]);

    const res = await onRequestPost({
      request: new Request('https://example.com/api/session/init', { method: 'POST' }),
      env: { DB: db },
    });

    expect(res.status).toBe(200);
    expect(mocks.issueSessionToken).toHaveBeenCalledOnce();
    expect(mocks.sessionCookieHeader).toHaveBeenCalledWith('new-token', 86400);
  });

  it('skips fingerprint persistence when DB is absent', async () => {
    const res = await onRequestPost({
      request: new Request('https://example.com/api/session/init', { method: 'POST' }),
      env: {},
    });
    expect(res.status).toBe(200);
    expect(mocks.ipHash).not.toHaveBeenCalled();
    expect(mocks.uaHash).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertAdminRequest,
  authenticateWriteRequest,
  checkAndConsumeRateLimit,
  enforceOrigin,
  getAllowedOrigins,
  getIp,
  getUserAgent,
  hashWithSalt,
  ipHash,
  isBanned,
  issueSessionToken,
  json,
  logSecurityEvent,
  pageIdFromBody,
  parseCookies,
  sessionCookieHeader,
  subnetFromIp,
  uaHash,
  verifySessionToken,
  verifyTurnstile,
} from '../functions/_lib/utils.js';
import { createDbMock } from './helpers/fake-db.js';

function req(url = 'https://example.com/api', headers = {}) {
  return new Request(url, { headers });
}

describe('utils extra', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('json helper sets content type', async () => {
    const res = json({ ok: true }, { status: 201 });
    expect(res.status).toBe(201);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('origin helpers and request metadata', () => {
    const request = req('https://example.com/x', { Origin: 'https://example.com', 'User-Agent': 'ua' });
    const env = { ALLOWED_ORIGINS: 'https://example.com' };

    expect(getAllowedOrigins(env, request).has('https://example.com')).toBe(true);
    expect(enforceOrigin(request, env).ok).toBe(true);
    expect(getIp(req('https://x', { 'CF-Connecting-IP': '1.2.3.4' }))).toBe('1.2.3.4');
    expect(getUserAgent(request)).toBe('ua');
  });

  it('hash helpers produce deterministic outputs', async () => {
    const env = { IP_HASH_SALT: 'salt' };
    const request = req('https://x', { 'CF-Connecting-IP': '203.0.113.1', 'User-Agent': 'agent' });

    const h1 = await hashWithSalt('a', 'salt');
    const h2 = await hashWithSalt('a', 'salt');
    expect(h1).toBe(h2);
    expect(await ipHash(request, env)).toHaveLength(64);
    expect(await uaHash(request, env)).toHaveLength(64);
  });

  it('subnetFromIp handles ipv4/ipv6/invalid', () => {
    expect(subnetFromIp('203.0.113.9')).toBe('203.0.113.0/24');
    expect(subnetFromIp('2001:db8::1')).toContain('/56');
    expect(subnetFromIp('not-an-ip')).toBeNull();
  });

  it('issue/verify token and invalid forms', async () => {
    const env = { APP_SIGNING_SECRET: 'secret' };
    const token = await issueSessionToken(env, 10);
    const ok = await verifySessionToken(token, env);
    expect(ok.ok).toBe(true);

    const malformed = await verifySessionToken('abc', env);
    expect(malformed.ok).toBe(false);

    const badSig = await verifySessionToken(`${token}x`, env);
    expect(badSig.ok).toBe(false);
  });

  it('cookie parser and cookie header', () => {
    const cookies = parseCookies(req('https://x', { Cookie: 'a=1; meb_session=xyz' }));
    expect(cookies.a).toBe('1');
    expect(cookies.meb_session).toBe('xyz');

    const header = sessionCookieHeader('token', 99);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Max-Age=99');
  });

  it('verifyTurnstile branches', async () => {
    let out = await verifyTurnstile({}, req(), null);
    expect(out.ok).toBe(false);

    out = await verifyTurnstile({ TURNSTILE_SECRET_KEY: '' }, req(), 'x');
    expect(out.ok).toBe(false);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), { status: 200 })
    );
    out = await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'secret' }, req('https://x', { 'CF-Connecting-IP': '1.1.1.1' }), 'x');
    expect(out.ok).toBe(false);

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    out = await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'secret' }, req('https://x', { 'CF-Connecting-IP': '1.1.1.1' }), 'x');
    expect(out.ok).toBe(true);
  });

  it('rate limit helper with and without KV', async () => {
    let out = await checkAndConsumeRateLimit({}, 'k', 1, 60);
    expect(out.ok).toBe(true);

    const kv = {
      store: new Map(),
      async get(k) {
        return this.store.get(k) || null;
      },
      async put(k, v) {
        this.store.set(k, v);
      },
    };

    out = await checkAndConsumeRateLimit({ RATE_LIMITS: kv }, 'k', 1, 60);
    expect(out.ok).toBe(true);
    out = await checkAndConsumeRateLimit({ RATE_LIMITS: kv }, 'k', 1, 60);
    expect(out.ok).toBe(false);
  });

  it('admin auth and page id validation', () => {
    const request = req('https://x', {
      'CF-Access-Authenticated-User-Email': 'admin@example.com',
      'x-admin-service-token': 't',
      'CF-Connecting-IP': '203.0.113.7',
    });

    let out = assertAdminRequest(request, { ADMIN_SERVICE_TOKEN: 't', ADMIN_IP_ALLOWLIST: '203.0.113.7' });
    expect(out.ok).toBe(true);

    out = assertAdminRequest(request, { ADMIN_SERVICE_TOKEN: 'bad' });
    expect(out.ok).toBe(false);

    expect(pageIdFromBody({ pageId: 'article/test' })).toBe('article/test');
    expect(pageIdFromBody({ pageId: 'BAD!' })).toBeNull();
  });

  it('logSecurityEvent and isBanned behaviors', async () => {
    const db = createDbMock([
      { match: 'INSERT INTO moderation_audit', run: () => ({ success: true }) },
      { match: 'FROM bans', first: () => ({ reason: 'abuse' }) },
    ]);

    await logSecurityEvent({ DB: db }, 'event', { actor: 'a' });
    const ban = await isBanned({ DB: db }, 'iphash', 'subhash');
    expect(ban.banned).toBe(true);

    const notBan = await isBanned({ DB: createDbMock() }, 'iphash', 'subhash');
    expect(notBan.banned).toBe(false);
  });

  it('authenticateWriteRequest covers success and failures', async () => {
    const env = {
      ALLOWED_ORIGINS: 'https://example.com',
      APP_SIGNING_SECRET: 'secret',
      IP_HASH_SALT: 'salt',
    };

    const token = await issueSessionToken(env, 3600);
    const request = req('https://example.com/api', {
      Origin: 'https://example.com',
      Cookie: `meb_session=${token}`,
      'CF-Connecting-IP': '203.0.113.42',
      'User-Agent': 'ua',
    });

    const ipH = await ipHash(request, env);
    const uaH = await uaHash(request, env);

    const db = createDbMock([
      {
        match: 'FROM session_fingerprints',
        first: () => ({ ip_hash: ipH, ua_hash: uaH, expires_at: 'future' }),
      },
      { match: 'FROM bans', first: () => null },
    ]);

    const ok = await authenticateWriteRequest(request, { ...env, DB: db });
    expect(ok.ok).toBe(true);

    const noOrigin = await authenticateWriteRequest(
      req('https://example.com/api', { Cookie: `meb_session=${token}` }),
      { ...env, DB: db }
    );
    expect(noOrigin.ok).toBe(false);

    const noDb = await authenticateWriteRequest(request, env);
    expect(noDb.ok).toBe(false);

    const badBindDb = createDbMock([
      {
        match: 'FROM session_fingerprints',
        first: () => ({ ip_hash: 'wrong', ua_hash: 'wrong', expires_at: 'future' }),
      },
      { match: 'FROM bans', first: () => null },
    ]);
    const badBind = await authenticateWriteRequest(request, { ...env, DB: badBindDb });
    expect(badBind.error).toBe('session_binding_mismatch');

    const bannedDb = createDbMock([
      { match: 'FROM session_fingerprints', first: () => ({ ip_hash: ipH, ua_hash: uaH }) },
      { match: 'FROM bans', first: () => ({ reason: 'abuse' }) },
    ]);
    const banned = await authenticateWriteRequest(request, { ...env, DB: bannedDb });
    expect(banned.error).toBe('banned');
  });
});

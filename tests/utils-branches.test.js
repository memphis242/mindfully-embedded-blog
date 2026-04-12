import { describe, expect, it, vi } from 'vitest';
import {
  assertAdminRequest,
  authenticateWriteRequest,
  enforceOrigin,
  firstPassModeration,
  getAllowedOrigins,
  getIp,
  getUserAgent,
  ipHash,
  isBanned,
  issueSessionToken,
  logSecurityEvent,
  markdownToSafeHtml,
  pageIdFromBody,
  parseCookies,
  subnetFromIp,
  uaHash,
  validateDisplayName,
  verifySessionToken,
  verifyTurnstile,
} from '../functions/_lib/utils.js';
import { createDbMock } from './helpers/fake-db.js';

function req(url = 'https://example.com/api', headers = {}) {
  return new Request(url, { headers });
}

function base64UrlEncodeString(input) {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmacPayload(payloadEncoded, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadEncoded));
  let str = '';
  for (const byte of new Uint8Array(sig)) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('utils branch-focused coverage', () => {
  it('covers origin allowlist defaults and invalid origin branch', () => {
    const request = req('https://example.com/x', { Origin: 'https://evil.example' });
    const allowed = getAllowedOrigins({}, request);
    expect(allowed.has('https://example.com')).toBe(true);
    expect(allowed.has('http://localhost:3000')).toBe(true);

    const out = enforceOrigin(request, { ALLOWED_ORIGINS: 'https://good.example' });
    expect(out).toEqual({ ok: false, reason: 'invalid_origin' });
  });

  it('covers ip/user-agent fallback branches', () => {
    expect(getIp(req('https://x', { 'x-forwarded-for': ' 198.51.100.9 , 10.0.0.1' }))).toBe(
      '198.51.100.9'
    );
    expect(getIp(req('https://x'))).toBe('0.0.0.0');
    expect(getUserAgent(req('https://x'))).toBe('unknown');
  });

  it('covers hash salt fallback branches for ipHash and uaHash', async () => {
    const request = req('https://x', { 'CF-Connecting-IP': '203.0.113.5', 'User-Agent': 'agent' });
    const fromSecretIp = await ipHash(request, { APP_SIGNING_SECRET: 'secret-salt' });
    const fromDefaultIp = await ipHash(request, {});
    const fromSecretUa = await uaHash(request, { APP_SIGNING_SECRET: 'secret-salt' });
    const fromDefaultUa = await uaHash(request, {});
    expect(fromSecretIp).toHaveLength(64);
    expect(fromDefaultIp).toHaveLength(64);
    expect(fromSecretUa).toHaveLength(64);
    expect(fromDefaultUa).toHaveLength(64);
  });

  it('covers parseCookies empty-key skip branch', () => {
    const cookies = parseCookies(req('https://x', { Cookie: '; a=1; b=2' }));
    expect(cookies).toEqual({ a: '1', b: '2' });
  });

  it('covers verifySessionToken malformed, bad_payload, expired, and missing_sid', async () => {
    const env = { APP_SIGNING_SECRET: 'abc123' };

    const malformed = await verifySessionToken('x.', env);
    expect(malformed).toEqual({ ok: false, reason: 'missing_or_malformed' });

    const badPayloadEncoded = base64UrlEncodeString('not-json');
    const badPayloadToken = `${badPayloadEncoded}.${await hmacPayload(badPayloadEncoded, env.APP_SIGNING_SECRET)}`;
    const badPayload = await verifySessionToken(badPayloadToken, env);
    expect(badPayload).toEqual({ ok: false, reason: 'bad_payload' });

    const now = Math.floor(Date.now() / 1000);
    const expiredPayloadEncoded = base64UrlEncodeString(
      JSON.stringify({ sid: 'sid-1', iat: now - 100, exp: now - 1 })
    );
    const expiredToken = `${expiredPayloadEncoded}.${await hmacPayload(expiredPayloadEncoded, env.APP_SIGNING_SECRET)}`;
    const expired = await verifySessionToken(expiredToken, env);
    expect(expired).toEqual({ ok: false, reason: 'expired' });

    const noSidPayloadEncoded = base64UrlEncodeString(JSON.stringify({ iat: now, exp: now + 60 }));
    const noSidToken = `${noSidPayloadEncoded}.${await hmacPayload(noSidPayloadEncoded, env.APP_SIGNING_SECRET)}`;
    const noSid = await verifySessionToken(noSidToken, env);
    expect(noSid).toEqual({ ok: false, reason: 'missing_sid' });
  });

  it('covers verifySessionToken default secret branch', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payloadEncoded = base64UrlEncodeString(
      JSON.stringify({ sid: 'sid-default', iat: now, exp: now + 60 })
    );
    const token = `${payloadEncoded}.${await hmacPayload(payloadEncoded, 'dev-signing-secret')}`;
    const out = await verifySessionToken(token, {});
    expect(out.ok).toBe(true);
  });

  it('covers verifyTurnstile http error and unreachable branches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const httpError = await verifyTurnstile(
      { TURNSTILE_SECRET_KEY: 'k' },
      req('https://x', { 'CF-Connecting-IP': '1.1.1.1' }),
      't'
    );
    expect(httpError).toEqual({ ok: false, reason: 'turnstile_verification_http_error' });

    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    const unreachable = await verifyTurnstile(
      { TURNSTILE_SECRET_KEY: 'k' },
      req('https://x', { 'CF-Connecting-IP': '1.1.1.1' }),
      't'
    );
    expect(unreachable).toEqual({ ok: false, reason: 'turnstile_unreachable' });
  });

  it('covers display-name empty and length policy branches', () => {
    expect(validateDisplayName('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateDisplayName('a')).toEqual({ ok: false, reason: 'name_length' });
    expect(validateDisplayName('x'.repeat(41))).toEqual({ ok: false, reason: 'name_length' });
  });

  it('covers markdown and moderation fallback branches', () => {
    expect(markdownToSafeHtml()).toBe('<p></p>');
    expect(firstPassModeration()).toEqual({ status: 'held', reason: 'length_policy' });
    expect(firstPassModeration('x')).toEqual({ status: 'held', reason: 'length_policy' });
    expect(firstPassModeration('a'.repeat(11))).toEqual({ status: 'held', reason: 'character_spam' });
  });

  it('covers issueSessionToken default secret branch', async () => {
    const token = await issueSessionToken({}, 30);
    const out = await verifySessionToken(token, {});
    expect(out.ok).toBe(true);
  });

  it('covers ipv6 invalid-hextet branch in subnet expansion', () => {
    expect(subnetFromIp('1.2.3')).toBeNull();
    expect(subnetFromIp('::1')).toContain('/56');
    expect(subnetFromIp('2001:db8::')).toContain('/56');
    expect(subnetFromIp('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(subnetFromIp('2001:db8::zzzz')).toBeNull();
  });

  it('covers logSecurityEvent no-DB and default actor branch', async () => {
    await expect(logSecurityEvent({}, 'event', { targetType: 'request' })).resolves.toBeUndefined();

    const db = createDbMock([{ match: 'INSERT INTO moderation_audit', run: () => ({ success: true }) }]);
    await logSecurityEvent({ DB: db }, 'event', { targetType: 'request' });
    expect(db.calls.some((c) => c.args.includes('system'))).toBe(true);
  });

  it('covers isBanned no-DB, subnet fallback, and default reason branch', async () => {
    const noDb = await isBanned({}, 'ip', null);
    expect(noDb).toEqual({ banned: false });

    const db = createDbMock([{ match: 'FROM bans', first: () => ({ reason: null }) }]);
    const banned = await isBanned({ DB: db }, 'ip-hash', null);
    expect(banned).toEqual({ banned: true, reason: 'banned' });
  });

  it('covers admin auth missing identity and ip allowlist mismatch branches', () => {
    const withNoIdentity = assertAdminRequest(
      req('https://x', { 'x-admin-service-token': 't', 'CF-Connecting-IP': '203.0.113.7' }),
      { ADMIN_SERVICE_TOKEN: 't' }
    );
    expect(withNoIdentity).toEqual({ ok: false, reason: 'missing_access_identity' });

    const notAllowlisted = assertAdminRequest(
      req('https://x', {
        'CF-Access-Authenticated-User-Email': 'admin@example.com',
        'x-admin-service-token': 't',
        'CF-Connecting-IP': '203.0.113.99',
      }),
      { ADMIN_SERVICE_TOKEN: 't', ADMIN_IP_ALLOWLIST: '203.0.113.7' }
    );
    expect(notAllowlisted).toEqual({ ok: false, reason: 'ip_not_allowlisted' });
  });

  it('covers pageIdFromBody missing page id branch', () => {
    expect(pageIdFromBody({})).toBeNull();
    expect(pageIdFromBody({ pageId: '   ' })).toBeNull();
  });

  it('covers authenticateWriteRequest invalid session, unknown session, and null subnet branch', async () => {
    const env = { ALLOWED_ORIGINS: 'https://example.com', APP_SIGNING_SECRET: 'secret' };

    const invalidSession = await authenticateWriteRequest(
      req('https://example.com/api', { Origin: 'https://example.com', Cookie: 'meb_session=bad' }),
      { ...env, DB: createDbMock() }
    );
    expect(invalidSession).toEqual({ ok: false, status: 401, error: 'invalid_session' });

    const now = Math.floor(Date.now() / 1000);
    const payloadEncoded = base64UrlEncodeString(
      JSON.stringify({ sid: 'sid-unknown', iat: now, exp: now + 300 })
    );
    const token = `${payloadEncoded}.${await hmacPayload(payloadEncoded, env.APP_SIGNING_SECRET)}`;
    const unknown = await authenticateWriteRequest(
      req('https://example.com/api', {
        Origin: 'https://example.com',
        Cookie: `meb_session=${token}`,
        'CF-Connecting-IP': '203.0.113.10',
        'User-Agent': 'ua',
      }),
      { ...env, DB: createDbMock([{ match: 'FROM session_fingerprints', first: () => null }]) }
    );
    expect(unknown).toEqual({ ok: false, status: 401, error: 'session_unknown' });

    const request = req('https://example.com/api', {
      Origin: 'https://example.com',
      Cookie: `meb_session=${token}`,
      'CF-Connecting-IP': 'not-an-ip',
      'User-Agent': 'ua',
    });
    const ipH = await ipHash(request, env);
    const uaH = await uaHash(request, env);
    const success = await authenticateWriteRequest(request, {
      ...env,
      DB: createDbMock([
        { match: 'FROM session_fingerprints', first: () => ({ ip_hash: ipH, ua_hash: uaH }) },
        { match: 'FROM bans', first: () => null },
      ]),
    });
    expect(success.ok).toBe(true);
    expect(success.subnetHashValue).toBeNull();
  });

  it('covers authenticateWriteRequest subnet hash with APP_SIGNING_SECRET fallback branch', async () => {
    const env = {
      ALLOWED_ORIGINS: 'https://example.com',
      APP_SIGNING_SECRET: 'secret-only',
    };
    const now = Math.floor(Date.now() / 1000);
    const payloadEncoded = base64UrlEncodeString(
      JSON.stringify({ sid: 'sid-app-secret', iat: now, exp: now + 120 })
    );
    const token = `${payloadEncoded}.${await hmacPayload(payloadEncoded, env.APP_SIGNING_SECRET)}`;
    const request = req('https://example.com/api', {
      Origin: 'https://example.com',
      Cookie: `meb_session=${token}`,
      'CF-Connecting-IP': '203.0.113.77',
      'User-Agent': 'ua',
    });
    const ipH = await ipHash(request, env);
    const uaH = await uaHash(request, env);
    const out = await authenticateWriteRequest(request, {
      ...env,
      DB: createDbMock([
        { match: 'FROM session_fingerprints', first: () => ({ ip_hash: ipH, ua_hash: uaH }) },
        { match: 'FROM bans', first: () => null },
      ]),
    });
    expect(out.ok).toBe(true);
    expect(out.subnetHashValue).toHaveLength(64);
  });

  it('covers authenticateWriteRequest subnet hash default fallback-salt branch', async () => {
    const env = {
      ALLOWED_ORIGINS: 'https://example.com',
    };
    const now = Math.floor(Date.now() / 1000);
    const payloadEncoded = base64UrlEncodeString(
      JSON.stringify({ sid: 'sid-default-salt', iat: now, exp: now + 120 })
    );
    const token = `${payloadEncoded}.${await hmacPayload(payloadEncoded, 'dev-signing-secret')}`;
    const request = req('https://example.com/api', {
      Origin: 'https://example.com',
      Cookie: `meb_session=${token}`,
      'CF-Connecting-IP': '198.51.100.10',
      'User-Agent': 'ua',
    });
    const ipH = await ipHash(request, env);
    const uaH = await uaHash(request, env);
    const out = await authenticateWriteRequest(request, {
      ...env,
      DB: createDbMock([
        { match: 'FROM session_fingerprints', first: () => ({ ip_hash: ipH, ua_hash: uaH }) },
        { match: 'FROM bans', first: () => null },
      ]),
    });
    expect(out.ok).toBe(true);
    expect(out.subnetHashValue).toHaveLength(64);
  });
});

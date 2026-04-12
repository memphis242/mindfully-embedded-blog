import { describe, expect, it } from 'vitest';
import { onRequestPost } from '../../functions/api/session/init.js';
import { createDbMock } from '../helpers/fake-db.js';

describe('session init route', () => {
  it('rejects missing origin', async () => {
    const req = new Request('https://example.com/api/session/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('issues session cookie and persists fingerprint', async () => {
    const db = createDbMock([{ match: 'INSERT INTO session_fingerprints', run: () => ({ success: true }) }]);

    const req = new Request('https://example.com/api/session/init', {
      method: 'POST',
      headers: {
        Origin: 'https://example.com',
        'CF-Connecting-IP': '203.0.113.10',
        'User-Agent': 'vitest-agent',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    const res = await onRequestPost({
      request: req,
      env: {
        ALLOWED_ORIGINS: 'https://example.com',
        APP_SIGNING_SECRET: 'secret',
        IP_HASH_SALT: 'salt',
        DB: db,
      },
    });

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('meb_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO session_fingerprints'))).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbMock } from '../helpers/fake-db.js';

const mocks = vi.hoisted(() => ({
  assertAdminRequest: vi.fn(),
  json: vi.fn((data, init = {}) => new Response(JSON.stringify(data), init)),
  logSecurityEvent: vi.fn(),
  hashWithSalt: vi.fn(async (v) => `hash-${v}`),
  subnetFromIp: vi.fn((ip) => (ip.includes('.') ? '203.0.113.0/24' : null)),
}));

vi.mock('../../functions/_lib/utils.js', () => ({
  assertAdminRequest: mocks.assertAdminRequest,
  json: mocks.json,
  logSecurityEvent: mocks.logSecurityEvent,
  hashWithSalt: mocks.hashWithSalt,
  subnetFromIp: mocks.subnetFromIp,
}));

import { onRequestGet as commentsGet } from '../../functions/api/admin/comments/index.js';
import { onRequestPost as commentsAction } from '../../functions/api/admin/comments/[id].js';
import {
  onRequestDelete as bansDelete,
  onRequestGet as bansGet,
  onRequestPost as bansPost,
} from '../../functions/api/admin/bans/index.js';
import { onRequestGet as digestGet } from '../../functions/api/admin/digest.js';
import { onRequestPost as maintenancePost } from '../../functions/api/admin/maintenance.js';

describe('admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdminRequest.mockReturnValue({ ok: true, actor: 'admin@example.com' });
  });

  it('comments list rejects unauthorized', async () => {
    mocks.assertAdminRequest.mockReturnValue({ ok: false, reason: 'missing_access_identity' });
    const res = await commentsGet({ request: new Request('https://e/api/admin/comments'), env: {} });
    expect(res.status).toBe(403);
  });

  it('comments list returns records', async () => {
    const db = createDbMock([{ match: 'FROM comments', all: () => ({ results: [{ id: 'c1' }] }) }]);
    const res = await commentsGet({ request: new Request('https://e/api/admin/comments'), env: { DB: db } });
    const body = await res.json();
    expect(body.comments).toHaveLength(1);
  });

  it('comment action validates id/json/action and logs', async () => {
    let res = await commentsAction({
      request: new Request('https://e/api/admin/comments/x', { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } }),
      env: { DB: createDbMock() },
      params: { id: 'x' },
    });
    expect(res.status).toBe(400);

    res = await commentsAction({
      request: new Request('https://e/api/admin/comments/x', {
        method: 'POST',
        body: JSON.stringify({ action: 'bogus' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: createDbMock() },
      params: { id: 'x' },
    });
    expect(res.status).toBe(400);

    const db = createDbMock([{ match: 'UPDATE comments SET status', run: () => ({ success: true }) }]);
    res = await commentsAction({
      request: new Request('https://e/api/admin/comments/x', {
        method: 'POST',
        body: JSON.stringify({ action: 'hidden' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db },
      params: { id: 'x' },
    });
    expect(res.status).toBe(200);
    expect(mocks.logSecurityEvent).toHaveBeenCalled();
  });

  it('bans get/post/delete cover key branches', async () => {
    let db = createDbMock([{ match: 'FROM bans', all: () => ({ results: [] }) }]);
    let res = await bansGet({ request: new Request('https://e/api/admin/bans'), env: { DB: db } });
    expect(res.status).toBe(200);

    res = await bansPost({
      request: new Request('https://e/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: createDbMock(), APP_SIGNING_SECRET: 'secret' },
    });
    expect(res.status).toBe(400);

    db = createDbMock([{ match: 'INSERT INTO bans', run: () => ({ success: true }) }]);
    res = await bansPost({
      request: new Request('https://e/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({ ipAddress: '203.0.113.5', reason: 'abuse' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db, APP_SIGNING_SECRET: 'secret' },
    });
    expect(res.status).toBe(200);

    db = createDbMock([{ match: 'DELETE FROM bans', run: () => ({ success: true }) }]);
    res = await bansDelete({ request: new Request('https://e/api/admin/bans?id=b1', { method: 'DELETE' }), env: { DB: db } });
    expect(res.status).toBe(200);
  });

  it('digest and maintenance paths', async () => {
    const db = createDbMock([
      { match: "status = 'hidden'", first: () => ({ count: 1 }) },
      { match: "status = 'deleted'", first: () => ({ count: 2 }) },
      { match: "status = 'held'", first: () => ({ count: 3 }) },
      { match: 'FROM bans', first: () => ({ count: 4 }) },
      { match: 'DELETE FROM moderation_audit', run: () => ({ success: true }) },
      { match: 'DELETE FROM session_fingerprints', run: () => ({ success: true }) },
    ]);

    let res = await digestGet({ request: new Request('https://e/api/admin/digest'), env: { DB: db } });
    let body = await res.json();
    expect(body.digest.heldComments).toBe(3);

    res = await maintenancePost({ request: new Request('https://e/api/admin/maintenance', { method: 'POST' }), env: { DB: db } });
    body = await res.json();
    expect(body.cleaned).toBe(true);
    expect(mocks.logSecurityEvent).toHaveBeenCalled();
  });
});

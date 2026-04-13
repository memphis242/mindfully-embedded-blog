import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbMock } from '../helpers/fake-db.js';

const mocks = vi.hoisted(() => ({
  assertAdminRequest: vi.fn(),
  json: vi.fn((data, init = {}) => new Response(JSON.stringify(data), init)),
  logSecurityEvent: vi.fn(),
  hashWithSalt: vi.fn(async (v) => `hash-${v}`),
  subnetFromIp: vi.fn(() => null),
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

describe('admin routes branch closure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdminRequest.mockReturnValue({ ok: true, actor: 'admin@example.com' });
    mocks.subnetFromIp.mockReturnValue('203.0.113.0/24');
  });

  it('admin comments list handles db-missing and empty-result fallback', async () => {
    const noDbRes = await commentsGet({ request: new Request('https://e/api/admin/comments'), env: {} });
    expect(noDbRes.status).toBe(500);

    const db = createDbMock([{ match: 'FROM comments', all: () => ({}) }]);
    const res = await commentsGet({ request: new Request('https://e/api/admin/comments'), env: { DB: db } });
    expect((await res.json()).comments).toEqual([]);
  });

  it('admin comment action covers missing id, unauthorized, db missing, defaults, and update failure', async () => {
    let res = await commentsAction({
      request: new Request('https://e/api/admin/comments/x', { method: 'POST' }),
      env: { DB: createDbMock() },
      params: {},
    });
    expect(res.status).toBe(400);

    mocks.assertAdminRequest.mockReturnValueOnce({ ok: false, reason: 'denied' });
    res = await commentsAction({
      request: new Request('https://e/api/admin/comments/x', { method: 'POST' }),
      env: { DB: createDbMock() },
      params: { id: 'x' },
    });
    expect(res.status).toBe(403);

    res = await commentsAction({
      request: new Request('https://e/api/admin/comments/x', { method: 'POST' }),
      env: {},
      params: { id: 'x' },
    });
    expect(res.status).toBe(500);

    const failingDb = createDbMock([{ match: 'UPDATE comments SET status', run: () => ({ success: false }) }]);
    res = await commentsAction({
      request: new Request('https://e/api/admin/comments/x', {
        method: 'POST',
        body: JSON.stringify({ reason: 'r' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: failingDb },
      params: { id: 'x' },
    });
    expect(res.status).toBe(400);

    res = await commentsAction({
      request: new Request('https://e/api/admin/comments/x', {
        method: 'POST',
        body: JSON.stringify({ action: 'visible', reason: 'r' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: failingDb },
      params: { id: 'x' },
    });
    expect(res.status).toBe(500);
  });

  it('admin bans covers unauthorized, invalid-json, subnet invalid, invalid subject/type, and missing delete id', async () => {
    mocks.assertAdminRequest.mockReturnValueOnce({ ok: false, reason: 'denied' });
    let res = await bansGet({ request: new Request('https://e/api/admin/bans'), env: { DB: createDbMock() } });
    expect(res.status).toBe(403);

    const emptyDb = createDbMock([{ match: 'FROM bans', all: () => ({}) }]);
    res = await bansGet({ request: new Request('https://e/api/admin/bans'), env: { DB: emptyDb } });
    expect((await res.json()).bans).toEqual([]);

    mocks.assertAdminRequest.mockReturnValueOnce({ ok: false, reason: 'denied' });
    res = await bansPost({
      request: new Request('https://e/api/admin/bans', { method: 'POST' }),
      env: {},
    });
    expect(res.status).toBe(403);

    res = await bansPost({
      request: new Request('https://e/api/admin/bans', {
        method: 'POST',
        body: '{',
        headers: { 'Content-Type': 'application/json' },
      }),
      env: {},
    });
    expect(res.status).toBe(400);

    mocks.subnetFromIp.mockReturnValueOnce(null);
    res = await bansPost({
      request: new Request('https://e/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({ subnetFromIp: 'bad' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: createDbMock(), APP_SIGNING_SECRET: 'secret' },
    });
    expect(res.status).toBe(400);

    res = await bansPost({
      request: new Request('https://e/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({ banType: 'bogus', subjectHash: 'abc' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: createDbMock(), APP_SIGNING_SECRET: 'secret' },
    });
    expect(res.status).toBe(400);

    mocks.assertAdminRequest.mockReturnValueOnce({ ok: false, reason: 'denied' });
    res = await bansDelete({
      request: new Request('https://e/api/admin/bans?id=b1', { method: 'DELETE' }),
      env: { DB: createDbMock() },
    });
    expect(res.status).toBe(403);

    res = await bansDelete({
      request: new Request('https://e/api/admin/bans', { method: 'DELETE' }),
      env: { DB: createDbMock() },
    });
    expect(res.status).toBe(400);
  });

  it('admin bans create covers parseExpiry branches and fallback salt path', async () => {
    const db = createDbMock([{ match: 'INSERT INTO bans', run: () => ({ success: true }) }]);

    let res = await bansPost({
      request: new Request('https://e/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({ subjectHash: 'x', banType: 'ip_hash', expiresInDays: -1 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db, IP_HASH_SALT: 'salt' },
    });
    expect(res.status).toBe(200);

    res = await bansPost({
      request: new Request('https://e/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({ subjectHash: 'x', banType: 'ip_hash', expiresInDays: 500 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db },
    });
    expect(res.status).toBe(200);

    res = await bansPost({
      request: new Request('https://e/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({ subnetFromIp: '203.0.113.7', expiresInDays: 7 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db, IP_HASH_SALT: 'salt' },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.banType).toBe('subnet_hash');
  });

  it('admin digest and maintenance cover unauthorized, db-missing, and count fallbacks', async () => {
    mocks.assertAdminRequest.mockReturnValueOnce({ ok: false, reason: 'denied' });
    let res = await digestGet({ request: new Request('https://e/api/admin/digest'), env: {} });
    expect(res.status).toBe(403);

    res = await digestGet({ request: new Request('https://e/api/admin/digest'), env: {} });
    expect(res.status).toBe(500);

    const db = createDbMock([
      { match: "status = 'hidden'", first: () => ({}) },
      { match: "status = 'deleted'", first: () => ({}) },
      { match: "status = 'held'", first: () => ({}) },
      { match: 'FROM bans', first: () => ({}) },
    ]);
    res = await digestGet({ request: new Request('https://e/api/admin/digest'), env: { DB: db } });
    const body = await res.json();
    expect(body.digest.heldComments).toBe(0);
    expect(body.digest.hiddenComments).toBe(0);
    expect(body.digest.deletedComments).toBe(0);
    expect(body.digest.bansCreated).toBe(0);

    mocks.assertAdminRequest.mockReturnValueOnce({ ok: false, reason: 'denied' });
    res = await maintenancePost({ request: new Request('https://e/api/admin/maintenance', { method: 'POST' }), env: {} });
    expect(res.status).toBe(403);

    res = await maintenancePost({ request: new Request('https://e/api/admin/maintenance', { method: 'POST' }), env: {} });
    expect(res.status).toBe(500);
  });
});

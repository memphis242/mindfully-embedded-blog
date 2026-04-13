import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbMock } from '../helpers/fake-db.js';

const mocks = vi.hoisted(() => ({
  assertAdminRequest: vi.fn(),
  json: vi.fn((data, init = {}) => new Response(JSON.stringify(data), init)),
  logSecurityEvent: vi.fn(),
}));

vi.mock('../../functions/_lib/utils.js', () => ({
  assertAdminRequest: mocks.assertAdminRequest,
  json: mocks.json,
  logSecurityEvent: mocks.logSecurityEvent,
}));

import { onRequestGet } from '../../functions/api/admin/leads/index.js';
import { onRequestPost } from '../../functions/api/admin/leads/[id].js';

describe('admin leads routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdminRequest.mockReturnValue({ ok: true, actor: 'admin@example.com' });
  });

  it('GET handles unauthorized/db missing/invalid status and empty fallback', async () => {
    mocks.assertAdminRequest.mockReturnValueOnce({ ok: false, reason: 'denied' });
    let res = await onRequestGet({ request: new Request('https://e/api/admin/leads'), env: {} });
    expect(res.status).toBe(403);

    res = await onRequestGet({ request: new Request('https://e/api/admin/leads'), env: {} });
    expect(res.status).toBe(500);

    res = await onRequestGet({
      request: new Request('https://e/api/admin/leads?status=nope'),
      env: { DB: createDbMock() },
    });
    expect(res.status).toBe(400);

    const db = createDbMock([{ match: 'FROM client_leads', all: () => ({}) }]);
    res = await onRequestGet({
      request: new Request('https://e/api/admin/leads?status=all'),
      env: { DB: db },
    });
    expect((await res.json()).leads).toEqual([]);
  });

  it('GET returns filtered and unfiltered lists', async () => {
    const db = createDbMock([{ match: 'FROM client_leads', all: () => ({ results: [{ id: 'l1' }] }) }]);

    let res = await onRequestGet({
      request: new Request('https://e/api/admin/leads'),
      env: { DB: db },
    });
    expect((await res.json()).leads).toHaveLength(1);

    res = await onRequestGet({
      request: new Request('https://e/api/admin/leads?status=new'),
      env: { DB: db },
    });
    expect((await res.json()).leads).toHaveLength(1);
  });

  it('POST handles missing id/unauthorized/db missing/invalid json/invalid status/no changes', async () => {
    let res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', { method: 'POST' }),
      env: { DB: createDbMock() },
      params: {},
    });
    expect(res.status).toBe(400);

    mocks.assertAdminRequest.mockReturnValueOnce({ ok: false, reason: 'denied' });
    res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', { method: 'POST' }),
      env: { DB: createDbMock() },
      params: { id: 'x' },
    });
    expect(res.status).toBe(403);

    res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', { method: 'POST' }),
      env: {},
      params: { id: 'x' },
    });
    expect(res.status).toBe(500);

    res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', {
        method: 'POST',
        body: '{',
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: createDbMock() },
      params: { id: 'x' },
    });
    expect(res.status).toBe(400);

    res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', {
        method: 'POST',
        body: JSON.stringify({ status: 'nope' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: createDbMock() },
      params: { id: 'x' },
    });
    expect(res.status).toBe(400);

    res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: createDbMock() },
      params: { id: 'x' },
    });
    expect(res.status).toBe(400);
  });

  it('POST handles update failure and success actions', async () => {
    let db = createDbMock([{ match: 'UPDATE client_leads', run: () => ({ success: false }) }]);
    let res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', {
        method: 'POST',
        body: JSON.stringify({ status: 'contacted' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db },
      params: { id: 'x' },
    });
    expect(res.status).toBe(500);

    db = createDbMock([{ match: 'UPDATE client_leads', run: () => ({ success: true }) }]);
    res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', {
        method: 'POST',
        body: JSON.stringify({ status: 'contacted', note: 'emailed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db },
      params: { id: 'x' },
    });
    let body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('contacted');
    expect(body.noteUpdated).toBe(true);

    res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', {
        method: 'POST',
        body: JSON.stringify({ markSpam: true }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db },
      params: { id: 'x' },
    });
    body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('spam');
    expect(mocks.logSecurityEvent).toHaveBeenCalled();

    res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', {
        method: 'POST',
        body: JSON.stringify({ note: 'note-only-update' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db },
      params: { id: 'x' },
    });
    body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBeNull();
    expect(body.noteUpdated).toBe(true);

    res = await onRequestPost({
      request: new Request('https://e/api/admin/leads/x', {
        method: 'POST',
        body: JSON.stringify({ status: 'new', note: '' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env: { DB: db },
      params: { id: 'x' },
    });
    body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('new');
    expect(body.noteUpdated).toBe(true);
  });
});

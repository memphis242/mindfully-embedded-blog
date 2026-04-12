import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbMock } from '../helpers/fake-db.js';

const mocks = vi.hoisted(() => ({
  authenticateWriteRequest: vi.fn(),
  checkAndConsumeRateLimit: vi.fn(),
  firstPassModeration: vi.fn(),
  generateFunnyName: vi.fn(),
  json: vi.fn((data, init = {}) => new Response(JSON.stringify(data), init)),
  markdownToSafeHtml: vi.fn(),
  pageIdFromBody: vi.fn(),
  validateDisplayName: vi.fn(),
  verifyTurnstile: vi.fn(),
}));

vi.mock('../../functions/_lib/utils.js', () => ({
  authenticateWriteRequest: mocks.authenticateWriteRequest,
  checkAndConsumeRateLimit: mocks.checkAndConsumeRateLimit,
  firstPassModeration: mocks.firstPassModeration,
  generateFunnyName: mocks.generateFunnyName,
  json: mocks.json,
  markdownToSafeHtml: mocks.markdownToSafeHtml,
  pageIdFromBody: mocks.pageIdFromBody,
  validateDisplayName: mocks.validateDisplayName,
  verifyTurnstile: mocks.verifyTurnstile,
}));

import { onRequestGet, onRequestPost } from '../../functions/api/comments/index.js';

describe('comments route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pageIdFromBody.mockReturnValue('article/test');
    mocks.authenticateWriteRequest.mockResolvedValue({ ok: true, sid: 'sid-1', ipHashValue: 'iphash' });
    mocks.checkAndConsumeRateLimit.mockResolvedValue({ ok: true });
    mocks.verifyTurnstile.mockResolvedValue({ ok: true });
    mocks.validateDisplayName.mockReturnValue({ ok: true, value: 'valid-name' });
    mocks.markdownToSafeHtml.mockReturnValue('<p>ok</p>');
    mocks.firstPassModeration.mockReturnValue({ status: 'visible', reason: null });
    mocks.generateFunnyName.mockReturnValue('curious-circuit');
  });

  it('GET rejects invalid page id', async () => {
    const req = new Request('https://example.com/api/comments?pageId=BAD!');
    const res = await onRequestGet({ request: req, env: {} });
    expect(res.status).toBe(400);
  });

  it('GET returns nested comments structure', async () => {
    const db = createDbMock([
      {
        match: 'FROM comments',
        all: () => ({
          results: [
            {
              id: 'c1',
              page_id: 'article/test',
              parent_id: null,
              display_name: 'A',
              markdown_html_sanitized: '<p>a</p>',
              created_at: 'now',
              status: 'visible',
            },
            {
              id: 'r1',
              page_id: 'article/test',
              parent_id: 'c1',
              display_name: 'B',
              markdown_html_sanitized: '<p>b</p>',
              created_at: 'now',
              status: 'visible',
            },
          ],
        }),
      },
    ]);

    const req = new Request('https://example.com/api/comments?pageId=article/test');
    const res = await onRequestGet({ request: req, env: { DB: db } });
    const body = await res.json();
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].replies).toHaveLength(1);
  });

  it('POST rejects invalid json', async () => {
    const req = new Request('https://example.com/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(400);
  });

  it('POST rejects auth failure', async () => {
    mocks.authenticateWriteRequest.mockResolvedValue({ ok: false, status: 401, error: 'invalid_session' });
    const req = new Request('https://example.com/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 'article/test', markdown: 'x' }),
    });

    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(401);
  });

  it('POST rejects on burst rate limit', async () => {
    mocks.checkAndConsumeRateLimit.mockResolvedValueOnce({ ok: false });
    const req = new Request('https://example.com/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 'article/test', markdown: 'x' }),
    });

    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(429);
  });

  it('POST rejects turnstile failure', async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: false, reason: 'turnstile_failed' });
    const req = new Request('https://example.com/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 'article/test', markdown: 'x' }),
    });

    const res = await onRequestPost({ request: req, env: { DB: createDbMock() } });
    expect(res.status).toBe(403);
  });

  it('POST rejects invalid parent and depth exceeded', async () => {
    const dbInvalid = createDbMock([{ match: 'SELECT id, parent_id, page_id FROM comments', first: () => null }]);
    const req1 = new Request('https://example.com/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 'article/test', parentId: 'p1', markdown: 'x', turnstileToken: 'ok' }),
    });
    const res1 = await onRequestPost({ request: req1, env: { DB: dbInvalid } });
    expect(res1.status).toBe(400);

    const dbDepth = createDbMock([
      {
        match: 'SELECT id, parent_id, page_id FROM comments',
        first: () => ({ id: 'p1', parent_id: 'already-reply', page_id: 'article/test' }),
      },
    ]);
    const req2 = new Request('https://example.com/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 'article/test', parentId: 'p1', markdown: 'x', turnstileToken: 'ok' }),
    });
    const res2 = await onRequestPost({ request: req2, env: { DB: dbDepth } });
    expect(res2.status).toBe(400);
  });

  it('POST validates provided name and writes comment', async () => {
    const db = createDbMock([
      { match: 'INSERT INTO comments', run: () => ({ success: true }) },
      { match: 'SELECT COUNT(*) AS count FROM comments', first: () => ({ count: 0 }) },
    ]);

    const req = new Request('https://example.com/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId: 'article/test',
        nameOrPseudonym: 'my-name',
        markdown: 'hello',
        turnstileToken: 'ok',
      }),
    });

    const res = await onRequestPost({ request: req, env: { DB: db } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.displayName).toBe('valid-name');
  });

  it('POST uses generated name when omitted and can hold moderation', async () => {
    mocks.firstPassModeration.mockReturnValue({ status: 'held', reason: 'link_density' });
    const db = createDbMock([
      { match: 'SELECT COUNT(*) AS count FROM comments', first: () => ({ count: 1 }) },
      { match: 'INSERT INTO comments', run: () => ({ success: true }) },
    ]);

    const req = new Request('https://example.com/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 'article/test', markdown: 'links', turnstileToken: 'ok' }),
    });

    const res = await onRequestPost({ request: req, env: { DB: db } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('held');
    expect(body.displayName.startsWith('curious-circuit')).toBe(true);
  });
});

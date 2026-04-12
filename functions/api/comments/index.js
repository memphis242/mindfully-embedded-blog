import {
  authenticateWriteRequest,
  checkAndConsumeRateLimit,
  firstPassModeration,
  generateFunnyName,
  json,
  markdownToSafeHtml,
  pageIdFromBody,
  validateDisplayName,
  verifyTurnstile,
} from '../../_lib/utils.js';

function mapCommentRow(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    parentId: row.parent_id,
    displayName: row.display_name,
    html: row.markdown_html_sanitized,
    createdAt: row.created_at,
    status: row.status,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const pageId = new URL(request.url).searchParams.get('pageId');

  if (!pageId || !/^[a-z0-9\-_/]+$/.test(pageId)) {
    return json({ ok: false, error: 'invalid_page_id' }, { status: 400 });
  }

  if (!env.DB) {
    return json({ ok: false, error: 'db_not_configured' }, { status: 500 });
  }

  const rows = await env.DB.prepare(
    `
      SELECT id, page_id, parent_id, display_name, markdown_html_sanitized, created_at, status
      FROM comments
      WHERE page_id = ? AND status = 'visible'
      ORDER BY created_at ASC
      LIMIT 300
    `
  )
    .bind(pageId)
    .all();

  const comments = [];
  const repliesByParent = new Map();

  for (const row of rows.results || []) {
    if (!row.parent_id) {
      comments.push({ ...mapCommentRow(row), replies: [] });
      continue;
    }

    if (!repliesByParent.has(row.parent_id)) {
      repliesByParent.set(row.parent_id, []);
    }

    repliesByParent.get(row.parent_id).push(mapCommentRow(row));
  }

  for (const comment of comments) {
    comment.replies = repliesByParent.get(comment.id) || [];
  }

  return json({ ok: true, comments });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const pageId = pageIdFromBody(body);
  if (!pageId) return json({ ok: false, error: 'invalid_page_id' }, { status: 400 });

  const markdown = String(body?.markdown || '');
  const parentId = body?.parentId ? String(body.parentId) : null;

  const auth = await authenticateWriteRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });

  const rateKeyBase = `comments:${auth.ipHashValue}`;
  const commentBurst = await checkAndConsumeRateLimit(env, `${rateKeyBase}:burst`, 3, 600);
  if (!commentBurst.ok) return json({ ok: false, error: 'comment_rate_limited' }, { status: 429 });

  const commentDaily = await checkAndConsumeRateLimit(env, `${rateKeyBase}:daily`, 10, 86400);
  if (!commentDaily.ok) return json({ ok: false, error: 'comment_daily_limited' }, { status: 429 });

  if (parentId) {
    const replyDaily = await checkAndConsumeRateLimit(
      env,
      `${rateKeyBase}:reply:${pageId}`,
      5,
      86400
    );
    if (!replyDaily.ok) return json({ ok: false, error: 'reply_daily_limited' }, { status: 429 });
  }

  const turnstile = await verifyTurnstile(env, request, body?.turnstileToken);
  if (!turnstile.ok) return json({ ok: false, error: turnstile.reason }, { status: 403 });

  if (!env.DB) {
    return json({ ok: false, error: 'db_not_configured' }, { status: 500 });
  }

  if (parentId) {
    const parent = await env.DB.prepare(
      'SELECT id, parent_id, page_id FROM comments WHERE id = ? LIMIT 1'
    )
      .bind(parentId)
      .first();

    if (!parent || parent.page_id !== pageId) {
      return json({ ok: false, error: 'invalid_parent' }, { status: 400 });
    }

    if (parent.parent_id) {
      return json({ ok: false, error: 'reply_depth_exceeded' }, { status: 400 });
    }
  }

  const providedName = String(body?.nameOrPseudonym || '').trim();
  let displayName;

  if (providedName) {
    const validated = validateDisplayName(providedName);
    if (!validated.ok) {
      return json({ ok: false, error: validated.reason }, { status: 400 });
    }
    displayName = validated.value;
  } else {
    displayName = generateFunnyName();
    const existing = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM comments WHERE page_id = ? AND display_name = ?'
    )
      .bind(pageId, displayName)
      .first();

    if (Number(existing?.count || 0) > 0) {
      const rand = new Uint32Array(1);
      crypto.getRandomValues(rand);
      const suffix = 10 + (rand[0] % 90);
      displayName = `${displayName}-${suffix}`;
    }
  }

  const moderation = firstPassModeration(markdown);
  const htmlSafe = markdownToSafeHtml(markdown);
  const commentId = crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO comments (
        id, page_id, parent_id, session_id, ip_hash, display_name,
        markdown_raw, markdown_html_sanitized, status, moderation_reason,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `
  )
    .bind(
      commentId,
      pageId,
      parentId,
      auth.sid,
      auth.ipHashValue,
      displayName,
      markdown,
      htmlSafe,
      moderation.status,
      moderation.reason
    )
    .run();

  return json({
    ok: true,
    commentId,
    status: moderation.status,
    displayName,
  });
}

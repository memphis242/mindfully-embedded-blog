import {
  authenticateWriteRequest,
  checkAndConsumeRateLimit,
  json,
  pageIdFromBody,
} from '../../_lib/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const pageId = pageIdFromBody(body);
  if (!pageId) {
    return json({ ok: false, error: 'invalid_page_id' }, { status: 400 });
  }

  const reaction = body?.reaction;
  if (reaction !== 'like' && reaction !== 'dislike') {
    return json({ ok: false, error: 'invalid_reaction' }, { status: 400 });
  }

  const auth = await authenticateWriteRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });

  const rate = await checkAndConsumeRateLimit(env, `reactions:${auth.ipHashValue}`, 20, 86400);
  if (!rate.ok) {
    return json({ ok: false, error: 'reaction_rate_limited' }, { status: 429 });
  }

  await env.DB.prepare(
    `
      INSERT INTO reactions (id, page_id, session_id, reaction, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(page_id, session_id) DO UPDATE SET reaction = excluded.reaction, updated_at = datetime('now')
    `
  )
    .bind(crypto.randomUUID(), pageId, auth.sid, reaction)
    .run();

  return json({ ok: true, userReaction: reaction });
}

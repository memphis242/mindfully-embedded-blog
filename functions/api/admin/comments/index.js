import { assertAdminRequest, json } from '../../../_lib/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = assertAdminRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, { status: 403 });

  if (!env.DB) return json({ ok: false, error: 'db_not_configured' }, { status: 500 });

  const rows = await env.DB
    .prepare(`
      SELECT id, page_id, parent_id, display_name, markdown_raw, status, moderation_reason, created_at
      FROM comments
      ORDER BY created_at DESC
      LIMIT 200
    `)
    .all();

  return json({ ok: true, comments: rows.results || [] });
}

import { assertAdminRequest, json, logSecurityEvent } from '../../../_lib/utils.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const id = String(params.id || '').trim();

  if (!id) return json({ ok: false, error: 'missing_id' }, { status: 400 });

  const auth = assertAdminRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, { status: 403 });

  if (!env.DB) return json({ ok: false, error: 'db_not_configured' }, { status: 500 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const action = String(body?.action || '');
  const reason = String(body?.reason || '').slice(0, 180) || null;
  const allowedActions = new Set(['visible', 'hidden', 'deleted']);

  if (!allowedActions.has(action)) {
    return json({ ok: false, error: 'invalid_action' }, { status: 400 });
  }

  const result = await env.DB
    .prepare('UPDATE comments SET status = ?, moderation_reason = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(action, reason, id)
    .run();

  if (!result.success) {
    return json({ ok: false, error: 'update_failed' }, { status: 500 });
  }

  await logSecurityEvent(env, 'admin_comment_action', {
    actor: auth.actor,
    targetType: 'comment',
    targetId: id,
    reason: reason || action,
    action,
  });

  return json({ ok: true, id, status: action });
}

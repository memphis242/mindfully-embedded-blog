import { assertAdminRequest, json, logSecurityEvent } from '../../_lib/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = assertAdminRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, { status: 403 });

  if (!env.DB) return json({ ok: false, error: 'db_not_configured' }, { status: 500 });

  await env.DB.prepare(
    `DELETE FROM moderation_audit WHERE created_at < datetime('now', '-90 day')`
  ).run();
  await env.DB.prepare(`DELETE FROM session_fingerprints WHERE expires_at < datetime('now')`).run();

  await logSecurityEvent(env, 'admin_maintenance', {
    actor: auth.actor,
    targetType: 'maintenance',
    targetId: 'retention_cleanup',
    reason: 'manual_cleanup',
  });

  return json({ ok: true, cleaned: true });
}

import { assertAdminRequest, json } from '../../_lib/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = assertAdminRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, { status: 403 });

  if (!env.DB) return json({ ok: false, error: 'db_not_configured' }, { status: 500 });

  const hidden = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM comments WHERE status = 'hidden' AND updated_at > datetime('now', '-1 day')`
  ).first();
  const deleted = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM comments WHERE status = 'deleted' AND updated_at > datetime('now', '-1 day')`
  ).first();
  const held = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM comments WHERE status = 'held' AND created_at > datetime('now', '-1 day')`
  ).first();
  const bans = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM bans WHERE created_at > datetime('now', '-1 day')`
  ).first();

  return json({
    ok: true,
    digest: {
      window: 'last_24h',
      heldComments: held?.count || 0,
      hiddenComments: hidden?.count || 0,
      deletedComments: deleted?.count || 0,
      bansCreated: bans?.count || 0,
    },
  });
}

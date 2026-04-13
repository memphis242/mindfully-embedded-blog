import { assertAdminRequest, json, logSecurityEvent } from '../../../_lib/utils.js';

const VALID_STATUSES = new Set(['new', 'contacted', 'closed', 'spam']);

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

  const markSpam = body?.markSpam === true || body?.markSpam === 'true';
  const statusInput = markSpam ? 'spam' : String(body?.status || '').trim();
  const nextStatus = statusInput ? statusInput : null;
  const nextNote = body?.note === undefined ? null : String(body.note || '').slice(0, 2000);

  if (nextStatus && !VALID_STATUSES.has(nextStatus)) {
    return json({ ok: false, error: 'invalid_status' }, { status: 400 });
  }

  if (!nextStatus && nextNote === null) {
    return json({ ok: false, error: 'no_changes' }, { status: 400 });
  }

  const result = await env.DB.prepare(
    `
      UPDATE client_leads
      SET
        status = COALESCE(?, status),
        admin_notes = COALESCE(?, admin_notes),
        updated_at = datetime('now')
      WHERE id = ?
    `
  )
    .bind(nextStatus, nextNote, id)
    .run();

  if (!result.success) {
    return json({ ok: false, error: 'update_failed' }, { status: 500 });
  }

  await logSecurityEvent(env, 'admin_lead_update', {
    actor: auth.actor,
    targetType: 'lead',
    targetId: id,
    reason: markSpam ? 'mark_spam' : nextStatus || 'note_update',
    status: nextStatus,
  });

  return json({ ok: true, id, status: nextStatus || null, noteUpdated: nextNote !== null });
}

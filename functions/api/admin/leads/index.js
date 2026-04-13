import { assertAdminRequest, json } from '../../../_lib/utils.js';

const VALID_STATUSES = new Set(['new', 'contacted', 'closed', 'spam']);

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = assertAdminRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, { status: 403 });

  if (!env.DB) return json({ ok: false, error: 'db_not_configured' }, { status: 500 });

  const statusParam = String(new URL(request.url).searchParams.get('status') || '').trim();
  const statusFilter = statusParam && statusParam !== 'all' ? statusParam : null;
  if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
    return json({ ok: false, error: 'invalid_status' }, { status: 400 });
  }

  const rows = statusFilter
    ? await env.DB.prepare(
        `
          SELECT id, service_type, name, email, message_raw, consent_given, status, admin_notes, created_at, updated_at
          FROM client_leads
          WHERE status = ?
          ORDER BY created_at DESC
          LIMIT 300
        `
      )
        .bind(statusFilter)
        .all()
    : await env.DB.prepare(
        `
          SELECT id, service_type, name, email, message_raw, consent_given, status, admin_notes, created_at, updated_at
          FROM client_leads
          ORDER BY created_at DESC
          LIMIT 300
        `
      ).all();

  return json({ ok: true, leads: rows.results || [] });
}

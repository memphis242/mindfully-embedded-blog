import {
  assertAdminRequest,
  hashWithSalt,
  json,
  logSecurityEvent,
  subnetFromIp,
} from '../../../_lib/utils.js';

function parseExpiry(days) {
  if (!days) return null;
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `+${Math.min(365, Math.floor(n))} day`;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = assertAdminRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, { status: 403 });

  const rows = await env.DB.prepare(
    'SELECT id, ban_type, subject_hash, reason, expires_at, created_at FROM bans ORDER BY created_at DESC LIMIT 200'
  ).all();

  return json({ ok: true, bans: rows.results || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = assertAdminRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const reason = String(body?.reason || 'admin_ban').slice(0, 180);
  const durationExpr = parseExpiry(body?.expiresInDays);
  const salt = String(env.IP_HASH_SALT || env.APP_SIGNING_SECRET || 'fallback-salt');

  let banType = String(body?.banType || 'ip_hash');
  let subjectHash = String(body?.subjectHash || '').trim();

  if (!subjectHash && body?.ipAddress) {
    subjectHash = await hashWithSalt(String(body.ipAddress), salt);
    banType = 'ip_hash';
  }

  if (!subjectHash && body?.subnetFromIp) {
    const subnet = subnetFromIp(String(body.subnetFromIp));
    if (!subnet) {
      return json({ ok: false, error: 'invalid_subnet_ip' }, { status: 400 });
    }
    subjectHash = await hashWithSalt(subnet, salt);
    banType = 'subnet_hash';
  }

  if (!subjectHash || (banType !== 'ip_hash' && banType !== 'subnet_hash')) {
    return json({ ok: false, error: 'invalid_ban_subject' }, { status: 400 });
  }

  const banId = crypto.randomUUID();

  if (durationExpr) {
    await env.DB.prepare(
      `INSERT INTO bans (id, ban_type, subject_hash, reason, expires_at, created_at) VALUES (?, ?, ?, ?, datetime('now', ?), datetime('now'))`
    )
      .bind(banId, banType, subjectHash, reason, durationExpr)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO bans (id, ban_type, subject_hash, reason, expires_at, created_at) VALUES (?, ?, ?, ?, NULL, datetime('now'))`
    )
      .bind(banId, banType, subjectHash, reason)
      .run();
  }

  await logSecurityEvent(env, 'admin_ban_create', {
    actor: auth.actor,
    targetType: 'ban',
    targetId: banId,
    reason,
    banType,
  });

  return json({ ok: true, banId, banType });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = assertAdminRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, { status: 403 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ ok: false, error: 'missing_id' }, { status: 400 });

  await env.DB.prepare('DELETE FROM bans WHERE id = ?').bind(id).run();

  await logSecurityEvent(env, 'admin_ban_delete', {
    actor: auth.actor,
    targetType: 'ban',
    targetId: id,
    reason: 'admin_unban',
  });

  return json({ ok: true, id });
}

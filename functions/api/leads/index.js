import {
  authenticateWriteRequest,
  checkAndConsumeRateLimit,
  json,
  validateDisplayName,
  verifyTurnstile,
} from '../../_lib/utils.js';

const VALID_SERVICE_TYPES = new Set(['training', 'consulting', 'contracts']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeLeadBody(body) {
  return {
    serviceType: String(body?.serviceType || '').trim(),
    name: String(body?.name || '').trim(),
    email: String(body?.email || '')
      .trim()
      .toLowerCase(),
    message: String(body?.message || '').trim(),
    consent: body?.consent === true || body?.consent === 'true' || body?.consent === 'on',
    turnstileToken: body?.turnstileToken,
  };
}

function validateLeadInput(input) {
  if (!VALID_SERVICE_TYPES.has(input.serviceType)) {
    return { ok: false, error: 'invalid_service_type' };
  }

  const name = validateDisplayName(input.name);
  if (!name.ok) {
    return { ok: false, error: name.reason };
  }

  if (!input.email || input.email.length > 254 || !EMAIL_REGEX.test(input.email)) {
    return { ok: false, error: 'invalid_email' };
  }

  if (input.message.length < 10 || input.message.length > 4000) {
    return { ok: false, error: 'message_length' };
  }

  if (!input.consent) {
    return { ok: false, error: 'consent_required' };
  }

  return { ok: true, normalizedName: name.value };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const input = normalizeLeadBody(body);
  const validation = validateLeadInput(input);
  if (!validation.ok) {
    return json({ ok: false, error: validation.error }, { status: 400 });
  }

  const auth = await authenticateWriteRequest(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });

  const rateKeyBase = `leads:${auth.ipHashValue}`;
  const burst = await checkAndConsumeRateLimit(env, `${rateKeyBase}:burst`, 3, 600);
  if (!burst.ok) return json({ ok: false, error: 'lead_rate_limited' }, { status: 429 });

  const daily = await checkAndConsumeRateLimit(env, `${rateKeyBase}:daily`, 10, 86400);
  if (!daily.ok) return json({ ok: false, error: 'lead_daily_limited' }, { status: 429 });

  const turnstile = await verifyTurnstile(env, request, input.turnstileToken);
  if (!turnstile.ok) return json({ ok: false, error: turnstile.reason }, { status: 403 });

  if (!env.DB) {
    return json({ ok: false, error: 'db_not_configured' }, { status: 500 });
  }

  const leadId = crypto.randomUUID();
  await env.DB.prepare(
    `
      INSERT INTO client_leads (
        id, service_type, session_id, ip_hash, ua_hash, name, email, message_raw, consent_given,
        status, admin_notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NULL, datetime('now'), datetime('now'))
    `
  )
    .bind(
      leadId,
      input.serviceType,
      auth.sid,
      auth.ipHashValue,
      auth.uaHashValue,
      validation.normalizedName,
      input.email,
      input.message,
      1
    )
    .run();

  return json({ ok: true, leadId, status: 'new' });
}

export const __testables = {
  normalizeLeadBody,
  validateLeadInput,
};

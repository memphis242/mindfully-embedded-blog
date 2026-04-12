import {
  enforceOrigin,
  ipHash,
  issueSessionToken,
  json,
  parseCookies,
  sessionCookieHeader,
  uaHash,
  verifySessionToken,
} from '../../_lib/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const originCheck = enforceOrigin(request, env);
  if (!originCheck.ok) {
    return json({ ok: false, error: originCheck.reason }, { status: 403 });
  }

  const cookies = parseCookies(request);
  const existing = cookies.meb_session;

  let token = existing;
  let payload;

  if (existing) {
    const verified = await verifySessionToken(existing, env);
    if (verified.ok) {
      payload = verified.payload;
    }
  }

  if (!payload) {
    token = await issueSessionToken(env, 86400);
    const verified = await verifySessionToken(token, env);
    payload = verified.payload;
  }

  if (env.DB) {
    const ipHashValue = await ipHash(request, env);
    const uaHashValue = await uaHash(request, env);

    await env.DB.prepare(
      `
        INSERT INTO session_fingerprints (session_id, ip_hash, ua_hash, expires_at, updated_at)
        VALUES (?, ?, ?, datetime('now', '+1 day'), datetime('now'))
        ON CONFLICT(session_id) DO UPDATE SET
          ip_hash = excluded.ip_hash,
          ua_hash = excluded.ua_hash,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `
    )
      .bind(payload.sid, ipHashValue, uaHashValue)
      .run();
  }

  return json(
    { ok: true, sessionReady: true },
    {
      status: 200,
      headers: {
        'Set-Cookie': sessionCookieHeader(token, 86400),
      },
    }
  );
}

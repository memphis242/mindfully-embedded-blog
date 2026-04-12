import { SAFE_ADJECTIVES, SAFE_NOUNS } from './name-words.js';

const encoder = new TextEncoder();

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function getAllowedOrigins(env, request) {
  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const requestOrigin = new URL(request.url).origin;
  return new Set([...configured, requestOrigin, 'http://localhost:3000', 'http://127.0.0.1:3000']);
}

export function enforceOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) {
    return { ok: false, reason: 'missing_origin' };
  }

  const allow = getAllowedOrigins(env, request);
  if (!allow.has(origin)) {
    return { ok: false, reason: 'invalid_origin' };
  }

  return { ok: true };
}

export function getIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

export function getUserAgent(request) {
  return request.headers.get('User-Agent') || 'unknown';
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashWithSalt(value, salt) {
  return sha256Hex(`${salt}::${value}`);
}

export async function ipHash(request, env) {
  return hashWithSalt(
    getIp(request),
    String(env.IP_HASH_SALT || env.APP_SIGNING_SECRET || 'fallback-salt')
  );
}

export async function uaHash(request, env) {
  return hashWithSalt(
    getUserAgent(request),
    String(env.IP_HASH_SALT || env.APP_SIGNING_SECRET || 'fallback-salt')
  );
}

export function subnetFromIp(ip) {
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  if (!ip.includes(':')) return null;
  const expanded = expandIpv6(ip);
  if (!expanded) return null;
  return `${expanded.slice(0, 14)}::/56`;
}

function expandIpv6(ip) {
  const [left, right = ''] = ip.split('::');
  const leftParts = left ? left.split(':').filter(Boolean) : [];
  const rightParts = right ? right.split(':').filter(Boolean) : [];
  const missing = 8 - (leftParts.length + rightParts.length);
  if (missing < 0) return null;

  const full = [...leftParts, ...Array(missing).fill('0'), ...rightParts].map((part) =>
    part.padStart(4, '0')
  );

  if (full.some((part) => !/^[0-9a-f]{4}$/i.test(part))) return null;
  return full.join('');
}

function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const raw = atob(padded);
  return new Uint8Array([...raw].map((ch) => ch.charCodeAt(0)));
}

async function hmacSign(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(sig));
}

export async function issueSessionToken(env, ttlSeconds = 86400) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sid: crypto.randomUUID(),
    iat: now,
    exp: now + ttlSeconds,
  };

  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSign(
    payloadEncoded,
    String(env.APP_SIGNING_SECRET || 'dev-signing-secret')
  );
  return `${payloadEncoded}.${signature}`;
}

export async function verifySessionToken(token, env) {
  if (!token || !token.includes('.')) return { ok: false, reason: 'missing_or_malformed' };
  const [payloadEncoded, signature] = token.split('.');
  if (!payloadEncoded || !signature) return { ok: false, reason: 'missing_or_malformed' };

  const expectedSig = await hmacSign(
    payloadEncoded,
    String(env.APP_SIGNING_SECRET || 'dev-signing-secret')
  );
  if (signature !== expectedSig) return { ok: false, reason: 'bad_signature' };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadEncoded)));
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return { ok: false, reason: 'expired' };
  if (!payload.sid) return { ok: false, reason: 'missing_sid' };

  return { ok: true, payload };
}

export function parseCookies(request) {
  const raw = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    cookies[k] = rest.join('=');
  }
  return cookies;
}

export function sessionCookieHeader(token, maxAgeSeconds = 86400) {
  return [
    `meb_session=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export async function verifyTurnstile(env, request, token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'missing_turnstile_token' };
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: false, reason: 'turnstile_not_configured' };
  }

  const ip = getIp(request);
  const form = new URLSearchParams();
  form.set('secret', String(env.TURNSTILE_SECRET_KEY));
  form.set('response', token);
  form.set('remoteip', ip);

  try {
    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });

    if (!result.ok) {
      return { ok: false, reason: 'turnstile_verification_http_error' };
    }

    const body = await result.json();
    if (!body.success) {
      return { ok: false, reason: 'turnstile_failed' };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: 'turnstile_unreachable' };
  }
}

export async function checkAndConsumeRateLimit(env, key, limit, windowSeconds) {
  if (!env.RATE_LIMITS) {
    return { ok: true };
  }

  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSeconds);
  const storageKey = `rl:${key}:${bucket}`;

  const currentRaw = await env.RATE_LIMITS.get(storageKey);
  const current = currentRaw ? Number(currentRaw) : 0;

  if (current >= limit) {
    return { ok: false, remaining: 0 };
  }

  await env.RATE_LIMITS.put(storageKey, String(current + 1), {
    expirationTtl: windowSeconds + 90,
  });

  return { ok: true, remaining: limit - (current + 1) };
}

export function validateDisplayName(value) {
  const trimmed = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }

  if (trimmed.length < 2 || trimmed.length > 40) {
    return { ok: false, reason: 'name_length' };
  }

  if (!/^[A-Za-z0-9._\- ]+$/.test(trimmed)) {
    return { ok: false, reason: 'name_charset' };
  }

  return { ok: true, value: trimmed };
}

export function markdownToSafeHtml(markdown) {
  const src = String(markdown || '').trim();
  const escaped = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const linked = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
  );
  const bold = linked.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const italic = bold.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const code = italic.replace(/`([^`]+)`/g, '<code>$1</code>');

  return code
    .split(/\n\n+/)
    .map((block) => `<p>${block.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export function firstPassModeration(markdown) {
  const text = String(markdown || '');

  if (text.length < 2 || text.length > 2000) {
    return { status: 'held', reason: 'length_policy' };
  }

  const linkCount = (text.match(/https?:\/\//g) || []).length;
  if (linkCount > 3) {
    return { status: 'held', reason: 'link_density' };
  }

  if (/(.)\1{10,}/.test(text)) {
    return { status: 'held', reason: 'character_spam' };
  }

  return { status: 'visible', reason: null };
}

export function selectRandomWord(list) {
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  return list[rand[0] % list.length];
}

export function generateFunnyName() {
  return `${selectRandomWord(SAFE_ADJECTIVES)}-${selectRandomWord(SAFE_NOUNS)}`;
}

export async function logSecurityEvent(env, eventType, payload) {
  if (!env.DB) return;

  await env.DB.prepare(
    `INSERT INTO moderation_audit (id, action, target_type, target_id, actor, reason, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  )
    .bind(
      crypto.randomUUID(),
      eventType,
      payload.targetType || 'request',
      payload.targetId || '',
      payload.actor || 'system',
      payload.reason || null,
      JSON.stringify(payload)
    )
    .run();
}

export async function isBanned(env, ipHashValue, subnetHashValue) {
  if (!env.DB) return { banned: false };

  const res = await env.DB.prepare(
    `SELECT id, ban_type, reason, expires_at FROM bans WHERE (subject_hash = ? OR subject_hash = ?) AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1`
  )
    .bind(ipHashValue, subnetHashValue || '')
    .first();

  if (!res) return { banned: false };
  return { banned: true, reason: res.reason || 'banned' };
}

export function assertAdminRequest(request, env) {
  const userEmail = request.headers.get('CF-Access-Authenticated-User-Email');
  const serviceToken = request.headers.get('x-admin-service-token');
  const ip = getIp(request);

  const allowIps = String(env.ADMIN_IP_ALLOWLIST || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  if (!userEmail) return { ok: false, reason: 'missing_access_identity' };
  if (!env.ADMIN_SERVICE_TOKEN || serviceToken !== env.ADMIN_SERVICE_TOKEN) {
    return { ok: false, reason: 'invalid_service_token' };
  }
  if (allowIps.length > 0 && !allowIps.includes(ip)) {
    return { ok: false, reason: 'ip_not_allowlisted' };
  }

  return { ok: true, actor: userEmail };
}

export function pageIdFromBody(body) {
  const value = String(body?.pageId || '').trim();
  if (!value) return null;
  if (!/^[a-z0-9\-_/]+$/.test(value)) return null;
  return value;
}

export async function authenticateWriteRequest(request, env) {
  const originCheck = enforceOrigin(request, env);
  if (!originCheck.ok) return { ok: false, status: 403, error: originCheck.reason };

  const cookies = parseCookies(request);
  const token = cookies.meb_session;
  const verified = await verifySessionToken(token, env);
  if (!verified.ok) return { ok: false, status: 401, error: 'invalid_session' };

  const sid = verified.payload.sid;
  const ipHashValue = await ipHash(request, env);
  const uaHashValue = await uaHash(request, env);
  const subnet = subnetFromIp(getIp(request));
  const subnetHashValue = subnet
    ? await hashWithSalt(
        subnet,
        String(env.IP_HASH_SALT || env.APP_SIGNING_SECRET || 'fallback-salt')
      )
    : null;

  if (!env.DB) {
    return { ok: false, status: 500, error: 'db_not_configured' };
  }

  const fingerprint = await env.DB.prepare(
    'SELECT ip_hash, ua_hash, expires_at FROM session_fingerprints WHERE session_id = ? LIMIT 1'
  )
    .bind(sid)
    .first();

  if (!fingerprint) return { ok: false, status: 401, error: 'session_unknown' };
  if (fingerprint.ip_hash !== ipHashValue || fingerprint.ua_hash !== uaHashValue) {
    return { ok: false, status: 401, error: 'session_binding_mismatch' };
  }

  const banState = await isBanned(env, ipHashValue, subnetHashValue);
  if (banState.banned) {
    return { ok: false, status: 403, error: 'banned' };
  }

  return {
    ok: true,
    sid,
    ipHashValue,
    uaHashValue,
    subnetHashValue,
  };
}

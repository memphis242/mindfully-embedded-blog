import { json, parseCookies, verifySessionToken } from '../../_lib/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const pageId = new URL(request.url).searchParams.get('pageId');

  if (!pageId || !/^[a-z0-9\-_/]+$/.test(pageId)) {
    return json({ ok: false, error: 'invalid_page_id' }, { status: 400 });
  }

  const cookies = parseCookies(request);
  const token = cookies.meb_session;
  const verified = await verifySessionToken(token, env);
  if (!verified.ok || !env.DB) {
    return json({ ok: true, userReaction: null });
  }

  const sid = verified.payload.sid;
  const row = await env.DB.prepare(
    'SELECT reaction FROM reactions WHERE page_id = ? AND session_id = ? LIMIT 1'
  )
    .bind(pageId, sid)
    .first();

  return json({ ok: true, userReaction: row?.reaction || null });
}

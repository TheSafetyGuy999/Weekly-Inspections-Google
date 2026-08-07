import { json, verifyAdminCredentials } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const username = body.username || '';
  const password = body.password || '';

  const ok = await verifyAdminCredentials(username, password, env);
  if (ok) {
    const credToken = btoa(`${username}:${password}`);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': `admin_session=${encodeURIComponent(credToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      }
    });
  }

  return json({ error: 'Invalid username or password' }, 401);
}

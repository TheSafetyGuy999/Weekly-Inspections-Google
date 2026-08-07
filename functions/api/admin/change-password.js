import { json, requireAdmin, verifyAdminCredentials } from '../../_lib.js';

/**
 * POST /api/admin/change-password — update the admin password.
 * Accepts: { oldPassword, newPassword }
 */
export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const oldPassword = body.oldPassword || '';
  const newPassword = body.newPassword || '';

  if (!oldPassword || !newPassword) {
    return json({ error: 'Both old password and new password are required' }, 400);
  }

  if (newPassword.length < 6) {
    return json({ error: 'New password must be at least 6 characters long' }, 400);
  }

  // Extract current username from authorization/cookie
  let header = request.headers.get('authorization') || '';
  if (!header) {
    const cookie = request.headers.get('cookie') || '';
    const match = cookie.match(/admin_session=([^;]+)/);
    if (match) {
      header = 'Basic ' + decodeURIComponent(match[1]);
    }
  }

  let username = 'Safety';
  if (/^Basic\s/i.test(header)) {
    try {
      const decoded = atob(header.replace(/^Basic\s+/i, ''));
      const split = decoded.indexOf(':');
      if (split >= 0) username = decoded.slice(0, split);
    } catch {}
  }

  // Verify old password against current configuration / KV
  const isValid = await verifyAdminCredentials(username, oldPassword, env);
  if (!isValid) {
    return json({ error: 'Incorrect old password' }, 400);
  }

  // Store new password in KV
  if (env.FILES) {
    await env.FILES.put('config:admin_password', newPassword);
  } else {
    return json({ error: 'KV storage is not available' }, 500);
  }

  // Return success response and update session cookie with new credential token
  const credToken = btoa(`${username}:${newPassword}`);
  return new Response(JSON.stringify({ ok: true, message: 'Password successfully updated' }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': `admin_session=${encodeURIComponent(credToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
    }
  });
}

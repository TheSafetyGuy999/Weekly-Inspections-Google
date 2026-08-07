import { json } from '../../_lib.js';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': `admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    }
  });
}

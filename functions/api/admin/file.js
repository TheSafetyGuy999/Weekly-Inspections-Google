import { json, requireAdmin } from '../../_lib.js';

/**
 * GET /api/admin/file?key=inspections/<uuid>/report.pdf
 *
 * KV holds these privately; this is the only way out, behind the admin login.
 */
export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const key = new URL(request.url).searchParams.get('key') || '';

  // The key comes from a query string, so it is matched against the exact shape
  // this app writes rather than trusted. Without this, "../" or any other key
  // in the bucket would be fetchable.
  if (!/^inspections\/[0-9a-f-]{36}\/(report\.pdf|photo-\d{1,2}\.jpg)$/i.test(key)) {
    return json({ error: 'Bad key' }, 400);
  }

  // KV keeps no content type of its own — it was stored as metadata on write.
  const obj = await env.FILES.getWithMetadata(key, { type: 'stream' });
  if (!obj || !obj.value) return json({ error: 'Not found' }, 404);

  const headers = new Headers();
  headers.set(
    'content-type',
    (obj.metadata && obj.metadata.contentType) || 'application/octet-stream'
  );
  headers.set('cache-control', 'private, max-age=3600');
  // Render in the browser rather than forcing a download; Safety is reviewing
  // these, not filing them.
  headers.set('content-disposition', 'inline');
  return new Response(obj.value, { headers });
}

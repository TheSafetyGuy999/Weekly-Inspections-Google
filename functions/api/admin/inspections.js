import { json, requireAdmin, verifyAdminCredentials, isUuid } from '../../_lib.js';

/**
 * GET /api/admin/inspections — the register, newest first.
 * Filters: ?airfield=&from=&to=&issue=  (all optional)
 */
export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const q = new URL(request.url).searchParams;
  const where = [];
  const binds = [];

  if (q.get('airfield')) {
    where.push('airfield = ?');
    binds.push(q.get('airfield'));
  }
  if (q.get('from')) {
    where.push('week_ending >= ?');
    binds.push(q.get('from'));
  }
  if (q.get('to')) {
    where.push('week_ending <= ?');
    binds.push(q.get('to'));
  }
  if (q.get('issue')) {
    where.push('issue_type = ?');
    binds.push(q.get('issue'));
  }

  const limit = Math.min(parseInt(q.get('limit') || '500', 10) || 500, 1000);
  const sql = `
    select id, week_ending, airfield, employee,
           check_grass, check_windsock, check_surface, check_erosion, check_fod,
           issue_type, issue_note, signature, signed_date,
           completed_at, received_at, pdf_key, photo_count
      from inspections
      ${where.length ? 'where ' + where.join(' and ') : ''}
     order by week_ending desc, received_at desc
     limit ?`;

  const { results } = await env.DB.prepare(sql).bind(...binds, limit).all();

  // Counts for trend analysis, over the same filter rather than the page.
  const trendSql = `
    select airfield, week_ending, issue_type, count(*) as n
      from inspections
      ${where.length ? 'where ' + where.join(' and ') : ''}
     group by airfield, week_ending, issue_type`;
  const { results: trend } = await env.DB.prepare(trendSql).bind(...binds).all();

  const { results: airfields } = await env.DB.prepare(
    'select distinct airfield from inspections order by airfield'
  ).all();

  return json({
    inspections: results,
    trend,
    airfields: airfields.map((r) => r.airfield),
  });
}

/**
 * DELETE /api/admin/inspections — Delete an inspection by ID after verifying the admin password.
 * Body: { id, password }
 */
export async function onRequestDelete({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const id = body.id || '';
  const password = body.password || '';

  if (!id || !isUuid(id)) {
    return json({ error: 'Valid inspection ID is required' }, 400);
  }

  if (!password) {
    return json({ error: 'Admin password is required to delete an inspection' }, 400);
  }

  // Extract username from session cookie/authorization
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

  // Verify entered admin password
  const isValid = await verifyAdminCredentials(username, password, env);
  if (!isValid) {
    return json({ error: 'Incorrect admin password. Deletion cancelled.' }, 401);
  }

  // Check if inspection exists
  const { results } = await env.DB.prepare('select pdf_key from inspections where id = ?').bind(id).all();
  if (!results || results.length === 0) {
    return json({ error: 'Inspection not found' }, 404);
  }

  const pdfKey = results[0].pdf_key;

  // Delete from DB
  await env.DB.prepare('delete from inspections where id = ?').bind(id).run();

  // Delete associated photos if any
  try {
    await env.DB.prepare('delete from inspection_photos where inspection_id = ?').bind(id).run();
  } catch (e) {
    // ignore if table doesn't exist
  }

  // Delete stored PDF if key exists
  if (pdfKey && env.FILES) {
    try {
      await env.FILES.delete(pdfKey);
    } catch (e) {
      // ignore
    }
  }

  return json({ ok: true, message: 'Inspection deleted successfully' });
}


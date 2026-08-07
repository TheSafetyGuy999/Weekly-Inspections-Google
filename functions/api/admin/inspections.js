import { json, requireAdmin } from '../../_lib.js';

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

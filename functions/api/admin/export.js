import { requireAdmin } from '../../_lib.js';

const COLUMNS = [
  ['week_ending', 'Week ending'],
  ['airfield', 'Airfield'],
  ['employee', 'Employee'],
  ['check_grass', 'Grass trimmed'],
  ['check_windsock', 'Windsock'],
  ['check_surface', 'Runway surface'],
  ['check_erosion', 'Erosion checked'],
  ['check_fod', 'FOD tools'],
  ['issue_type', 'Issue'],
  ['issue_note', 'Note'],
  ['signature', 'Signed by'],
  ['signed_date', 'Signed date'],
  ['completed_at', 'Completed'],
  ['received_at', 'Received'],
  ['photo_count', 'Photos'],
  ['id', 'Id'],
];

// Excel splits on commas, respects quotes, and doubles quotes to escape them.
const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** GET /api/admin/export — the whole register as CSV, for trend analysis in Excel. */
export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    `select ${COLUMNS.map(([k]) => k).join(', ')}
       from inspections order by week_ending desc, airfield`
  ).all();

  const lines = [COLUMNS.map(([, label]) => cell(label)).join(',')];
  for (const row of results) lines.push(COLUMNS.map(([k]) => cell(row[k])).join(','));

  // BOM so Excel opens UTF-8 correctly on Windows — without it, names with
  // accents arrive mangled.
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="airfield-inspections-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

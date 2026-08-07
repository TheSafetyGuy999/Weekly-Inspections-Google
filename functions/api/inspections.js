import { json, CHECKS, submitKeyOk, isUuid } from '../_lib.js';

const MAX_PHOTOS = 12;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * POST /api/inspections — receive one completed inspection.
 *
 * multipart/form-data:
 *   meta    JSON blob of the checklist fields
 *   pdf     the generated report
 *   photo0..photoN
 *
 * Idempotent: the device generates the id before queueing, so a retry after
 * patchy signal resolves to the same row instead of a duplicate inspection.
 */
export async function onRequestPost({ request, env }) {
  if (!submitKeyOk(request, env)) return json({ error: 'Unauthorized' }, 401);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Expected multipart/form-data' }, 400);
  }

  let meta;
  try {
    meta = JSON.parse(form.get('meta') || '');
  } catch {
    return json({ error: 'meta must be JSON' }, 400);
  }

  const id = meta.id;
  if (!isUuid(id)) return json({ error: 'meta.id must be a uuid' }, 400);

  for (const field of ['weekEnding', 'airfield', 'employee', 'signature', 'date', 'completedAt']) {
    if (!meta[field] || typeof meta[field] !== 'string') {
      return json({ error: `meta.${field} is required` }, 400);
    }
  }
  if (!['none', 'minor', 'major'].includes(meta.issueType)) {
    return json({ error: 'meta.issueType must be none, minor or major' }, 400);
  }

  // Already have it? Say so without touching storage. This is the retry path,
  // and it must look identical to success or the device will never stop trying.
  const existing = await env.DB.prepare('select id from inspections where id = ?').bind(id).first();
  if (existing) return json({ ok: true, id, duplicate: true });

  const pdf = form.get('pdf');
  const photos = [];
  for (let i = 0; i < MAX_PHOTOS; i++) {
    const f = form.get(`photo${i}`);
    if (f && typeof f !== 'string') photos.push(f);
  }
  for (const f of [pdf, ...photos]) {
    if (f && typeof f !== 'string' && f.size > MAX_FILE_BYTES) {
      return json({ error: 'file too large' }, 413);
    }
  }

  // Files first: a row pointing at a missing object is worse than an object
  // with no row, which the next retry simply overwrites.
  //
  // KV stores no content type of its own, so it rides along as metadata and is
  // read back when serving. Keys keep the same layout R2 used, so moving to R2
  // later is a swap rather than a migration.
  let pdfKey = null;
  if (pdf && typeof pdf !== 'string') {
    pdfKey = `inspections/${id}/report.pdf`;
    await env.FILES.put(pdfKey, await pdf.arrayBuffer(), {
      metadata: { contentType: 'application/pdf' },
    });
  }

  const photoKeys = [];
  for (let i = 0; i < photos.length; i++) {
    const key = `inspections/${id}/photo-${i + 1}.jpg`;
    await env.FILES.put(key, await photos[i].arrayBuffer(), {
      metadata: { contentType: photos[i].type || 'image/jpeg' },
    });
    photoKeys.push(key);
  }

  const c = meta.checks || {};
  const statements = [
    env.DB.prepare(
      `insert or ignore into inspections
         (id, week_ending, airfield, employee,
          check_grass, check_windsock, check_surface, check_erosion, check_fod,
          issue_type, issue_note, signature, signed_date, completed_at,
          pdf_key, photo_count)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      meta.weekEnding,
      meta.airfield,
      meta.employee,
      ...CHECKS.map((k) => (c[k] || c['check_' + k] ? 1 : 0)),
      meta.issueType,
      meta.issueNote || null,
      meta.signature,
      meta.date,
      meta.completedAt,
      pdfKey,
      photoKeys.length
    ),
    ...photoKeys.map((key, i) =>
      env.DB.prepare(
        'insert or ignore into inspection_photos (inspection_id, position, r2_key) values (?, ?, ?)'
      ).bind(id, i + 1, key)
    ),
  ];

  await env.DB.batch(statements);
  return json({ ok: true, id });
}

export const onRequestGet = () => json({ error: 'Method not allowed' }, 405);

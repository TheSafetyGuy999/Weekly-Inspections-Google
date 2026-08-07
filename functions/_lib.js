export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const CHECKS = ['grass', 'windsock', 'surface', 'erosion', 'fod'];

/**
 * Shared submission secret.
 *
 * The app is public, so anyone can read this key out of it. It is a speed bump
 * against drive-by posting, not a real access control — the protection that
 * matters is that reading inspections back needs the admin login, which this
 * key can never grant. Rotate SUBMIT_KEY and redeploy if it is abused.
 * Unset means open, which is fine locally and is not fine in production.
 */
export function submitKeyOk(request, env) {
  if (!env.SUBMIT_KEY) return true;
  const given = request.headers.get('x-airfield-key') || '';
  if (given.length !== env.SUBMIT_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ env.SUBMIT_KEY.charCodeAt(i);
  return diff === 0;
}

const enc = new TextEncoder();

const sha256 = async (s) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));

// Compare digests, never the raw strings: digests are a fixed length, so
// neither the value's length nor its contents leak through response timing.
function sameDigest(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Who may read the register.
 *
 * HTTP Basic against ADMIN_USER / ADMIN_PASSWORD, set as Pages secrets. The
 * browser draws the login prompt, so there is no login page to build and no
 * session to get wrong.
 *
 * Fails closed: with no credentials configured, nobody gets in. Being locked
 * out of your own register is recoverable; publishing it is not.
 *
 * TRUST_CF_ACCESS is opt-in for a reason. Trusting the Cf-Access-Jwt-Assertion
 * header whenever it happens to be present is worthless unless Cloudflare
 * Access is actually in front of the route — anyone can send a header. Only
 * turn it on once Access is deployed.
 */
export async function adminState(request, env) {
  if (env.ALLOW_INSECURE_ADMIN === 'true') return 'ok'; // local dev only
  if (env.TRUST_CF_ACCESS === 'true' && request.headers.get('cf-access-jwt-assertion')) {
    return 'ok';
  }
  // Reported separately from a wrong password. Both used to answer with the
  // same bare 401, so an unconfigured Worker looked exactly like mistyped
  // credentials — the browser just re-prompts forever and nothing says why.
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) return 'unconfigured';

  const header = request.headers.get('authorization') || '';
  if (!/^Basic\s/i.test(header)) return 'denied';

  let decoded;
  try {
    decoded = atob(header.replace(/^Basic\s+/i, ''));
  } catch {
    return 'denied';
  }
  const split = decoded.indexOf(':');
  if (split < 0) return 'denied';

  const [gotUser, wantUser, gotPass, wantPass] = await Promise.all([
    sha256(decoded.slice(0, split)),
    sha256(env.ADMIN_USER),
    sha256(decoded.slice(split + 1)),
    sha256(env.ADMIN_PASSWORD),
  ]);
  // Both compared every time — no early return that would reveal which half
  // was wrong.
  const userOk = sameDigest(gotUser, wantUser);
  const passOk = sameDigest(gotPass, wantPass);
  return userOk && passOk ? 'ok' : 'denied';
}

export const unauthorized = () =>
  new Response('Authentication required.', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="Inspection Register", charset="UTF-8"',
      'cache-control': 'no-store',
    },
  });

// Deliberately NO www-authenticate header: prompting for a password that
// cannot possibly be accepted is what made this failure invisible. Say what is
// wrong instead. This reveals only that the Worker is unconfigured, which
// nobody can act on — the register stays shut either way.
export const notConfigured = () =>
  new Response(
    'The inspection register is not configured.\n\n' +
      'The ADMIN_USER and ADMIN_PASSWORD secrets are not set on this Worker, ' +
      'so no password can be accepted. Set both in the Cloudflare dashboard ' +
      'under Settings > Variables and Secrets, then reload.\n',
    {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    }
  );

export function denyResponse(state) {
  return state === 'unconfigured' ? notConfigured() : unauthorized();
}

export async function requireAdmin(request, env) {
  const state = await adminState(request, env);
  return state === 'ok' ? null : denyResponse(state);
}

// Ids come from the client, so they are never interpolated anywhere without
// passing this first — an id is only ever a uuid.
export const isUuid = (s) =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

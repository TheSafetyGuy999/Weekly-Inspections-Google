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
/**
 * The credentials in force, or null when none are configured.
 *
 * A password changed from the admin panel is written to KV, so KV wins where
 * it is set. It has to *replace* the secret rather than be accepted alongside
 * it: accepting both means changing the password revokes nothing, and the
 * value it was changed away from — the one committed to this repo's history —
 * keeps working forever.
 *
 * There is no fallback value. A default that stands in for an unset secret is
 * indistinguishable from a configured one at the login prompt, so a register
 * nobody had secured yet would open to whoever knew the default. Returning
 * null lets the caller shut the door and say why.
 */
async function adminCredentials(env) {
  let kvUser = null;
  let kvPass = null;

  if (env.FILES) {
    try {
      kvUser = await env.FILES.get('config:admin_user');
      kvPass = await env.FILES.get('config:admin_password');
    } catch {
      // KV unreachable — fall back to the secrets rather than lock everyone out.
    }
  }

  const user = kvUser || env.ADMIN_USER;
  const pass = kvPass || env.ADMIN_PASSWORD;
  return user && pass ? { user, pass } : null;
}

async function credentialsMatch(user, pass, want) {
  const [gotU, wantU, gotP, wantP] = await Promise.all([
    sha256((user || '').trim().toLowerCase()),
    sha256(want.user.trim().toLowerCase()),
    sha256((pass || '').trim()),
    sha256(want.pass.trim()),
  ]);
  return sameDigest(gotU, wantU) && sameDigest(gotP, wantP);
}

export async function verifyAdminCredentials(user, pass, env = {}) {
  const want = await adminCredentials(env);
  return want ? credentialsMatch(user, pass, want) : false;
}

export async function adminState(request, env) {
  if (env.TRUST_CF_ACCESS === 'true' && request.headers.get('cf-access-jwt-assertion')) {
    return 'ok';
  }

  // Before reading the header, so an unconfigured Worker says so instead of
  // rejecting a password it was never able to accept.
  const want = await adminCredentials(env);
  if (!want) return 'unconfigured';

  let header = request.headers.get('authorization') || '';
  if (!header) {
    const cookie = request.headers.get('cookie') || '';
    const match = cookie.match(/admin_session=([^;]+)/);
    if (match) {
      header = 'Basic ' + decodeURIComponent(match[1]);
    }
  }

  if (!/^Basic\s/i.test(header)) return 'denied';

  let decoded;
  try {
    decoded = atob(header.replace(/^Basic\s+/i, ''));
  } catch {
    return 'denied';
  }
  const split = decoded.indexOf(':');
  if (split < 0) return 'denied';

  const ok = await credentialsMatch(decoded.slice(0, split), decoded.slice(split + 1), want);
  return ok ? 'ok' : 'denied';
}

export const unauthorized = () =>
  new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: {
      'content-type': 'application/json; charset=utf-8',
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

/**
 * Denial for a request for the admin *page* rather than its data.
 *
 * The login form lives inside admin.html, so gating that page with the JSON
 * 401 above would leave no way in at all — the page holding the only login UI
 * would be the page you cannot reach without logging in. Send the browser's
 * own Basic prompt instead, which needs no page to draw. Credentials entered
 * there are replayed on the page's own fetches, so the in-page modal simply
 * never has to appear.
 *
 * This carries www-authenticate where notConfigured() deliberately does not:
 * here a password can be accepted, so asking for one is not a dead end.
 */
export const unauthorizedPage = () =>
  new Response('Authentication required.\n', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="Inspection Register", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

export function denyResponse(state, { challenge = false } = {}) {
  if (state === 'unconfigured') return notConfigured();
  return challenge ? unauthorizedPage() : unauthorized();
}

export async function requireAdmin(request, env) {
  const state = await adminState(request, env);
  return state === 'ok' ? null : denyResponse(state);
}

// Ids come from the client, so they are never interpolated anywhere without
// passing this first — an id is only ever a uuid.
export const isUuid = (s) =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

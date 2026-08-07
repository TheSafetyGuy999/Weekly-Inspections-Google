import { adminState, denyResponse } from './_lib.js';

/**
 * Gate everything under /admin and /api/admin.
 *
 * The API routes check for themselves too, but admin.html is a static asset
 * served by Pages without touching a function — so without this middleware the
 * page itself would be readable by anyone. The page holds no data on its own,
 * yet handing out the register's UI to the internet invites exactly the
 * probing this is meant to stop.
 *
 * Everything else — the app, the service worker, the icons — passes straight
 * through. The inspection form must never require a login.
 */
export async function onRequest(context) {
  const { request, env, next } = context;
  const path = new URL(request.url).pathname;

  const isApiAdmin = path.startsWith('/api/admin');

  // The page itself, however it is addressed: assets answer /admin with
  // admin.html, and both spellings have to be gated or the gate is decoration.
  const isAdminPage =
    path === '/admin' || path.startsWith('/admin.') || path.startsWith('/admin/');

  // Login/logout endpoints are public so authentication can take place
  if (path === '/api/admin/login' || path === '/api/admin/logout') {
    return next();
  }

  if (isApiAdmin || isAdminPage) {
    const state = await adminState(request, env);
    // A page denial has to offer a way in — see unauthorizedPage().
    if (state !== 'ok') return denyResponse(state, { challenge: isAdminPage });
  }

  return next();
}

# Weekly Airfield Maintenance App

Mobile-first app for Wilderness Air lodge staff to complete the **Weekly Airfield
Maintenance Checklist**, capture photos, sign off, and send the completed report
to Safety as a PDF with photo attachments. It works with no connectivity and
queues unsent reports until the device is back online.

```
web/       the app — static assets served by a Cloudflare Worker
backend/   optional Node/Express mail server, for sending via your own SMTP
```

## The app (`web/`)

`web/index.html` is the bundled build handed off from design: React, jsPDF, the
fonts and the Wilderness Air logo are all inlined, so the page makes **zero
external requests** at runtime. Around it this repo adds the pieces that make it
a deployable field app:

- `manifest.webmanifest` + `icons/` — installable to a phone home screen
  ("Add to Home Screen"), launches standalone with the navy status bar.
- `sw.js` — a service worker that precaches the shell so the app opens and works
  with no signal at all. It deliberately ignores non-GET and cross-origin
  requests so report delivery to the mail backend is never intercepted or
  silently cached.

Inspection records live in `localStorage` on the device. Nothing is stored
server-side.

### Local changes to the bundle

`web/index.html` is not a pristine design export — it carries edits applied
inside the bundle's inner template. **If the design is ever re-exported, these
have to be re-applied:**

1. `<title>`, `theme-color`, the Apple web-app meta tags, and the
   `manifest.webmanifest` / icon links. They go in the *inner* template, because
   the bundler swaps the whole document on boot and discards the outer `<head>`.
   The service-worker registration is the exception — it sits in the outer
   document, where registration survives the swap.
2. The **Access key** field on the Settings screen, stored as `wai_mail_key`,
   sent to the mail backend as the `X-Airfield-Key` header, and the toast copy
   that names an auth failure instead of reporting a generic outage.
3. Photos downscaled on capture (max 1600px JPEG), and honest reporting when
   `localStorage` is full instead of a silently dropped record.

### Run it locally

```bash
python3 -m http.server 8000 --directory web
# then open http://localhost:8000
```

Service workers need a secure context — `localhost` counts, as does any HTTPS
origin. Opening `index.html` straight off the filesystem still runs the app, but
without offline install.

## Deploying

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full walkthrough. In short:

- **App** — Workers Builds deploys on every push. Completed inspections upload
  to the central register (D1 + KV) and are then deleted from the device;
  Safety reads them at `/admin`, behind a login held in Worker secrets. Staff
  never log in.
- **Mail backend** — optional. Point a device at it in Settings and that device
  emails Safety automatically instead of using the share sheet.
  `backend/Dockerfile` runs it on any container host.

## Source material

`Weekly Airstrip Maintenance App.zip` is the original design handoff bundle. Its
`README.md` documents every screen, design token, and interaction, and is the
reference for any future rebuild in a native or framework codebase.

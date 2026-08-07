# Weekly Airfield Maintenance App

Mobile-first app for Wilderness Air lodge staff to complete the **Weekly Airfield
Maintenance Checklist**, capture photos, sign off, and send the completed report
to Safety as a PDF with photo attachments. It works with no connectivity and
queues unsent reports until the device is back online.

```
web/       the app and the register page — static assets served by a Worker
functions/ the API behind them, compiled into that Worker at build time
db/        D1 schema for the central register
backend/   optional Node/Express mail server, for sending via your own SMTP
```

> **The app only works from the Worker.** `web/` looks like a folder of static
> files, and any static host will happily serve it — but `/api/*` then answers
> with that host's `index.html` instead of data, so the register cannot load and
> completed inspections cannot upload. The register page says so by name if it
> happens. Serve the app from the deployed Worker URL and nowhere else.

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
  silently cached, and skips `/api/*` and `/admin` outright: a cached answer
  there would be a stale register, or a login that appears to succeed offline.

  Its cache name carries a `__BUILD_ID__` placeholder that `tools/stamp-sw.sh`
  replaces with the commit SHA at build time. **Never commit a stamped value
  back** — the build fails if the placeholder is missing, because a fixed cache
  name pins every phone that ever installed the app to that one release.

A record is held in `localStorage` while it is being filled in and until it
uploads, so the app works through a whole shift with no signal. Once accepted by
the register the device deletes its copy — the server-side record is the one
that lasts.

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

## The register (`/admin`)

Completed inspections upload to D1, with the PDF and photos in KV. Safety reads
them at `/admin`; staff never log in, and the inspection form must never ask
them to.

That page is gated, not just its data. It holds no records itself, but handing
the register's UI to the internet invites exactly the probing the login exists
to stop — so the Worker challenges for a password before serving it.

The login is `ADMIN_USER` / `ADMIN_PASSWORD`, set as Worker secrets. **There is
no default.** With either unset the register answers 503 to everyone and says
which secrets are missing. That is deliberate: a fallback password is
indistinguishable from a real one at the prompt, so a register nobody had
secured yet would open to whoever knew the default. Being locked out of your own
register is recoverable; publishing every inspection is not.

Changing the password from the admin screen writes it to KV, which then replaces
the secret rather than being accepted alongside it — otherwise changing the
password would revoke nothing.

## Run it locally

```bash
cp .dev.vars.example .dev.vars   # fill in ADMIN_USER and ADMIN_PASSWORD
npm install
npm run dev                      # http://localhost:3000
```

`npm run dev` builds the Worker, applies `db/schema.sql` to a local D1, and
serves the app, the API and `/admin` together. `.dev.vars` is gitignored and
must stay that way — it is the file a working password goes in.

For a quick look at the app's screens alone, any static server will do:

```bash
python3 -m http.server 8000 --directory web
```

That serves the front end only. `/admin` and report upload need the Worker, so
they will fail exactly as they do on any other static host. Service workers need
a secure context — `localhost` counts, as does any HTTPS origin. Opening
`index.html` straight off the filesystem still runs the app, but without offline
install.

## Deploying

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full walkthrough. In short:

- **App** — Workers Builds deploys on every push to `main`, running
  `npm run build` (which compiles `functions/` into the Worker) and then
  `npx wrangler deploy`. Set `ADMIN_USER` and `ADMIN_PASSWORD` as secrets before
  the first deploy, or the register will be shut when you go to read it.
- **Secrets, not vars** — `wrangler.jsonc` is committed, so anything in a `vars`
  block is published with the repo and stays in its history. Use
  `npx wrangler secret put <NAME>`, and rotate rather than scrub if a value ever
  lands in a commit: rewriting history does not retract what was pushed.
- **Mail backend** — optional. Point a device at it in Settings and that device
  emails Safety automatically instead of using the share sheet.
  `backend/Dockerfile` runs it on any container host.

## Source material

`Weekly Airstrip Maintenance App.zip` is the original design handoff bundle. Its
`README.md` documents every screen, design token, and interaction, and is the
reference for any future rebuild in a native or framework codebase.

It is **not committed here** — `web/index.html` is the build taken from it. Keep
a copy somewhere durable if the design is ever to be re-exported, since the
edits listed above have to be re-applied by hand against it.

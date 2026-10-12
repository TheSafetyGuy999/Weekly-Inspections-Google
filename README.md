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

`web/index.html` is the app. Its one library, jsPDF, is vendored in
`web/vendor/` rather than loaded from a CDN, so the page makes **no requests off
its own origin** and can open and build a report with no signal. Around it this
repo adds the pieces that make it a deployable field app:

- `manifest.webmanifest` + `icons/` — installable to a phone home screen
  ("Add to Home Screen"), launches standalone with the navy status bar.
- `sw.js` — a service worker that precaches the shell, jsPDF and the logo so the
  app opens and builds reports with no signal at all. It deliberately ignores
  non-GET and cross-origin
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

### Vendored libraries

Two copies of jsPDF are committed under `web/vendor/`, both unmodified from the npm
package and both with their own MIT licence banner:

| file | version | source file | sha256 |
|---|---|---|---|
| `jspdf.umd.min.js` | **4.2.1** | `jspdf@4.2.1` `dist/jspdf.umd.min.js` | `e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54` |
| `jspdf-legacy.umd.min.js` | **2.5.1** | `jspdf@2.5.1` `dist/jspdf.umd.min.js` | `98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875` |

They are committed rather than fetched at build time so a deploy can never leave the
app without them.

**Why two.** jsPDF 4 is written in modern JavaScript (class fields, optional
chaining), so it only runs on a browser from about 2020 or later: **Chrome / Android
WebView 80, Safari / iOS 14, Firefox 74, Samsung Internet 13**. 2.5.1 is plain ES5 and
runs almost anywhere. `index.html` loads the modern build and, if it did not produce a
PDF builder, loads the legacy one instead. The two make the same PDFs (same text, zero
differing pixels on the four reports compared), so a report from an old phone looks
like any other.

The check is *"did it produce a builder?"* and not a feature test for particular
syntax: a feature test can pass while the real file still fails, and the real file is
what has to work. It also covers the modern file failing to download.

The service worker caches **both** and treats both as required, because it cannot know
in advance which phone it is on, and an old phone that starts offline with only the
modern build cached would have no PDF builder at all. The cost is one extra 364 KB
download per release. Only phones that need the legacy build ever run it.

**The legacy copy is out of date.** `npm audit` listed twelve advisories against 2.5.1
(two critical), all fixed only in 4.x; it reports none against 4.2.1. By title they
concern features this app never calls (AcroForms, `addJS`, HTML output, BMP/GIF
decoding), so exposure is low, and it only ever runs on phones too old for the modern
build. Treat it as temporary: once no staff phone needs it, delete
`jspdf-legacy.umd.min.js`, the `document.write` fallback in `index.html`, and its line
in `sw.js`.

To update either file, replace it from the new release, then:

1. check what JavaScript level the modern build now needs — if the requirement rises,
   update the list above, because phones below it fall back to the legacy copy;
2. compare a generated PDF against the previous version's (text, and every embedded
   image's declared size against its data — Acrobat rejects a mismatch that
   browsers tolerate);
3. check a report still builds with the network off, and opens cleanly in Acrobat.

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

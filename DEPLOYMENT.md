# Deployment

The app is a Cloudflare Worker serving static assets, with the inspection
register behind it: D1 for the records, KV for the PDFs and photos. The
`backend/` mail server is an unrelated leftover and is optional.

---

## 1. The app → Cloudflare Workers

The project deploys through **Workers Builds** (Git integration), not Pages.
That distinction matters: the API lives in `functions/`, which is Pages
Functions source, so the build compiles it into a Worker before deploying.

### Build settings

| | |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

`npm run build` does two things:

1. `tools/stamp-sw.sh` replaces `__BUILD_ID__` in `sw.js` with the commit SHA,
   so each release gets its own cache name and evicts the previous one. It
   fails the build if the placeholder survives — shipping it unstamped would
   pin every installed device to one release forever.
2. `wrangler pages functions build` compiles `functions/` into
   `web/_worker.js`, which `wrangler.jsonc` points `main` at.

`web/.assetsignore` keeps that compiled Worker from also being served as a
static file.

### Secrets

Set in the dashboard under **Settings → Variables and Secrets**, or
`npx wrangler secret put <NAME>`:

| name | effect if unset |
|---|---|
| `SUBMIT_KEY` | anyone who finds the URL can file inspections |
| `ADMIN_USER` | **register locked to everyone** |
| `ADMIN_PASSWORD` | **register locked to everyone** |

Locked-out fails closed on purpose: being unable to read your own register is
recoverable, publishing every inspection is not. There is no default login
standing in for an unset secret — one that opens the register to whoever knows
the default is indistinguishable from a real password at the prompt.

For local runs, `wrangler dev` reads the same names from `.dev.vars`. Copy
`.dev.vars.example` to `.dev.vars` and fill it in; the file is gitignored, and
should stay that way — it was committed once, which is how a working password
reached this repo's history, where it cannot be removed from.

`SUBMIT_KEY` must also be set in the app bundle (`const SUBMIT_KEY` near the
top of the template in `web/index.html`) — it is public by necessity, since the
app ships to phones.

### Installing it on a phone

Open the site in Chrome (Android) or Safari (iOS) → **Add to Home Screen**.
After the first load the app opens and runs entirely offline.

### Using a custom domain

Add it under the Worker's **Domains & Routes**.

---

## The central register

Completed inspections upload to Cloudflare and the device then deletes its
copy. Safety reads them at **`/admin`**.

| piece | service | free allowance | what this app needs |
|## 2. The mail backend (optional)

`backend/` is a small Express server exposing `POST /send`, which emails the
checklist PDF and photos to Safety over SMTP. It turns the manual "share or
download the PDF" step into an automatic send.

It holds real SMTP credentials, so it is not deployed from CI here — deploy it
yourself to a host where those secrets can live. A device only uses it once an
endpoint is entered in the app's Settings screen.

### Configuration

Copy `backend/.env.example` and fill it in. The values that matter in
production:

| Variable | Notes |
|---|---|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Google Workspace, M365, SendGrid, SES… For Gmail use an **App Password**. |
| `MAIL_FROM` | A mailbox you are permitted to send as. |
| `ALLOWED_TO` | Recipient allow-list. Keep it to `safety@wildernessdestinations.com` so the endpoint can't be used to send mail elsewhere. |
| `CORS_ORIGIN` | The exact site origin, e.g. `https://<project>.workers.dev`. Never `*` in production. |
| `API_KEY` | **Required in production.** Shared secret every device must send. Generate with `openssl rand -base64 32`. |

Set these as the host's secret environment variables rather than shipping a
`.env` file in the image — `.dockerignore` excludes `.env` for that reason.

### Container

```bash
docker build -t airfield-mail ./backend
docker run --rm -p 3000:3000 --env-file backend/.env airfield-mail
curl http://localhost:3000/health    # {"ok":true}

# /health stays open so container health checks work; /send does not:
curl -i -X POST http://localhost:3000/send            # 401 Unauthorized
```

The image honours an injected `PORT`, so it runs as-is on Fly.io, Render,
Railway, Cloud Run, or a plain VPS behind nginx. Two hard requirements:

- **HTTPS.** The app is served over HTTPS, and a browser will block a plaintext
  request to the backend as mixed content.
- **`CORS_ORIGIN` set to the app's origin**, or the browser will refuse the POST.

### Connect the app to it

In the app: **gear icon (home screen) → Mail server endpoint URL →**
`https://your-server.example/send`, then paste the same value you set for
`API_KEY` into **Access key** → **Save settings**. The status line turns green
("Connected") once a URL is saved. Both values are stored on that device only,
so each phone is configured once.

The app sends the key as an `X-Airfield-Key` header on every report. If the
server rejects it, the toast says so by name ("Access key rejected") rather than
reporting a generic outage — otherwise a mistyped key looks identical to a
server being down. The report is not lost either way: it falls through to the
share sheet or PDF download exactly as it would offline.

### Rotating the key

Change `API_KEY` on the server and re-enter it on every device. There is no
per-device revocation — it is one deployment-wide secret. Devices still holding
the old key keep working through the fallback path, so reports keep reaching
Safety while you work through the fleet.

### Delivery order

The app tries, in order: a configured mail server (if any) → device share sheet
(mobile) → PDF download plus a pre-filled `mailto:` draft (desktop). A report is
never lost; it stays `Pending` on the home screen until a send succeeds.

### Before exposing it publicly

With `API_KEY` set, a leaked URL alone is not enough to send mail, and the
recipient allow-list means even a leaked key can only reach Safety. What is
still missing is rate limiting — add it at the proxy or with
`express-rate-limit` if the endpoint is reachable from the open internet.

Leaving `API_KEY` blank is supported for local testing only; the server logs a
warning on startup when it is unset.

---

## Verifying a deployment

1. Open the Pages URL on a phone; the header shows the logo and an **Online**
   pill.
2. Turn on airplane mode and reload — the app still opens, and the pill reads
   **Offline**.
3. Complete a checklist offline; it saves as **Pending**.
4. Restore connectivity; the gold "Back online" banner appears on the home
   screen with a **Send** button, and the record flips to **Sent**.

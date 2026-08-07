# Airfield Maintenance — Mail Backend

A tiny Node server that receives a completed **Weekly Airfield Maintenance Checklist** (PDF + photos) from the app and emails it to Wilderness Air Safety. This is what turns the desktop "download + attach it yourself" step into a true one-click automatic send.

## What it does
- Exposes `POST /send` — accepts the checklist PDF and photo attachments as `multipart/form-data`.
- Sends them to `safety@wildernessdestinations.com` (locked to an allow-list) over SMTP via **nodemailer**.
- Returns `{ ok: true }` on success. The app marks the inspection **Sent**; if the server is unreachable it automatically falls back to a PDF download + pre-filled email draft.

## Setup
1. Install Node 18+.
2. In this `backend/` folder:
   ```bash
   npm install
   cp .env.example .env
   ```
3. Edit `.env` with your SMTP details (host, port, user, password/app-password) and set `MAIL_FROM`. For Gmail/Google Workspace use an **App Password**, not your account password.
4. Run it:
   ```bash
   npm start
   ```
   The server listens on `http://localhost:3000`. Health check: `GET /health`.

## Connect the app
Open the app → tap the **gear icon** (top-right on the home screen) → paste your server's `/send` URL, e.g. `https://your-server.com/send`, and the **Access key** if you set `API_KEY` → **Save**. From then on, every completed checklist is emailed automatically with the PDF attached.

## Deploy
Deploy like any Node app — Render, Railway, Fly.io, a VPS, or a container. Two production must-dos:
- Serve over **HTTPS** (browsers block mixed content, and the share/fetch flow needs a secure origin).
- Set **`CORS_ORIGIN`** in `.env` to the exact origin that hosts the app (not `*`).

## Request shape (for reference)
`POST /send` — `multipart/form-data`:
Header: `X-Airfield-Key: <API_KEY>` — required whenever `API_KEY` is set, otherwise the request is rejected with `401`.

| field | type | notes |
|-------|------|-------|
| `to` | text | must be on the `ALLOWED_TO` list |
| `subject` | text | email subject |
| `text` | text | email body |
| `pdf` | file | the checklist PDF (1) |
| `photos` | file[] | original photos (0–20) |

## Security notes
- **Set `API_KEY` in production.** Without it `/send` is open to anyone who learns the URL. The app sends the key as `X-Airfield-Key`; the server compares SHA-256 digests in constant time, so neither the key's length nor its contents leak through response timing.
- The recipient is validated against `ALLOWED_TO`, so the endpoint can't be abused to send mail elsewhere even by a holder of the key.
- The key is stored per device in `localStorage`. Rotating it means updating `API_KEY` on the server and re-entering it on each device, so treat it as a deployment-wide secret rather than a per-user credential.
- Still worth adding if the URL is widely known: rate limiting, and a request-size cap at the proxy.
- Attachments are held in memory only and never written to disk.

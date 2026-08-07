import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import nodemailer from 'nodemailer';

const app = express();

// ── Config (from environment / .env) ───────────────────────────────
const {
  PORT = 3000,
  SMTP_HOST,
  SMTP_PORT = 587,
  SMTP_SECURE = 'false',          // 'true' for port 465
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,                      // e.g. "Airfield App <noreply@wildernessdestinations.com>"
  ALLOWED_TO = 'safety@wildernessdestinations.com', // comma-separated allow-list of recipients
  CORS_ORIGIN = '*',              // set to your app's origin in production
  API_KEY = '',                   // shared secret; when set, /send requires it
} = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.warn('[warn] SMTP_HOST / SMTP_USER / SMTP_PASS not set — mail sending will fail until configured. See .env.example');
}
if (!API_KEY) {
  console.warn('[warn] API_KEY not set — /send is open to anyone who knows the URL. Set one before exposing this publicly. See .env.example');
}

const allowList = ALLOWED_TO.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const KEY_HEADER = 'X-Airfield-Key';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const keyDigest = API_KEY ? sha256(API_KEY) : null;

// ── Middleware ─────────────────────────────────────────────────────
// The key header must be allow-listed or the browser's preflight rejects it.
app.use(cors({
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()),
  allowedHeaders: ['Content-Type', KEY_HEADER],
}));

// Shared secret. The app sends it as a header from every device; it is the only
// thing standing between a leaked URL and anyone being able to mail Safety.
// Skipped entirely when API_KEY is unset, so existing deployments keep working.
function requireKey(req, res, next) {
  if (!keyDigest) return next();
  // Compare digests rather than the raw strings: timingSafeEqual throws on a
  // length mismatch, and digests are always the same length, so neither the
  // key's length nor its contents leak through timing.
  const given = sha256(String(req.get(KEY_HEADER) || ''));
  if (!crypto.timingSafeEqual(given, keyDigest)) {
    console.warn('[send] rejected: bad or missing ' + KEY_HEADER);
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// In-memory upload handling: PDF + up to 20 photos, 25 MB each.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 25 },
});

// ── Mail transport ─────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: String(SMTP_SECURE) === 'true',
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

// ── Routes ─────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// Field names must match the app's FormData: to, subject, text, pdf (1 file), photos (many)
app.post(
  '/send',
  requireKey,
  upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'photos', maxCount: 20 }]),
  async (req, res) => {
    try {
      const to = String(req.body.to || '').trim().toLowerCase();
      const subject = String(req.body.subject || 'Weekly Airfield Maintenance Checklist');
      const text = String(req.body.text || '');

      // Only allow sending to the approved Safety inbox(es).
      if (!allowList.includes(to)) {
        return res.status(400).json({ ok: false, error: 'Recipient not allowed' });
      }

      const files = req.files || {};
      const attachments = [];
      (files.pdf || []).forEach(f => attachments.push({ filename: f.originalname || 'checklist.pdf', content: f.buffer, contentType: 'application/pdf' }));
      (files.photos || []).forEach(f => attachments.push({ filename: f.originalname, content: f.buffer, contentType: f.mimetype }));

      if (!attachments.length) {
        return res.status(400).json({ ok: false, error: 'No PDF attached' });
      }

      const info = await transporter.sendMail({
        from: MAIL_FROM || SMTP_USER,
        to,
        subject,
        text,
        attachments,
      });

      res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error('[send] failed:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

app.listen(PORT, () => console.log(`Airfield mail backend listening on :${PORT}`));

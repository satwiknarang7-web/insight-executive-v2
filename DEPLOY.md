# Deploying Insight Executive

This is a Next.js app. Below is the fastest reliable path to a live Replit URL, plus a Vercel alternative.

## 0. Push the latest code first

All recent work is committed locally. Push it to GitHub so Replit can import it:

```bash
git push origin main
```

(Run this from your machine, where your GitHub credentials live.)

Repo: `https://github.com/satwiknarang7-web/insight-executive-v2`

## 1. Import into Replit (from GitHub)

1. Go to https://replit.com → **Create Repl** → **Import from GitHub**.
2. Select `satwiknarang7-web/insight-executive-v2`.
3. Replit reads the included `.replit` file and sets up Node 20 automatically.

## 2. Add your Secrets (API keys)

In the Repl, open the **Secrets** panel (lock icon) and add:

| Key | Required | Purpose |
|-----|----------|---------|
| `GROQ_API_KEY` | optional | Groq — first choice for narrative wording (fastest) |
| `ANTHROPIC_API_KEY` | optional | Claude — second choice |
| `GEMINI_API_KEY` | optional | Gemini — third choice |
| `ELEVENLABS_API_KEY` | optional | Narrate the presentation with an ElevenLabs voice instead of the browser's |
| `ELEVENLABS_VOICE_ID` | optional | Override the default narration voice (id from the ElevenLabs voice library) |
| `SMTP_USER` | for accounts | Gmail address that sends the two-factor codes |
| `SMTP_PASSWORD` | for accounts | Gmail **app password** (16 characters, not the account password) |
| `SMTP_HOST` / `SMTP_PORT` | optional | Defaults to `smtp.gmail.com` / `465` |
| `SMTP_FROM` | optional | Overrides the From header |
| `AUTH_OTP_PEPPER` | optional | Peppers one-time-code hashes; falls back to `VAULT_MASTER_KEY` |

**All three are optional.** Analysis, charts and every number are computed in the
browser and are correct with no keys at all; a key only buys nicer wording on the
narrative and natural-language questions on `/ask` (which otherwise falls back to
matching the question against the planner's own charts).

Do **not** commit these — `.env` is gitignored.

## 3. Run + get a URL

- Click **Run**. Replit builds and serves on port 3000, giving you a live `*.replit.dev` preview URL.
- For a permanent, always-on URL, click **Deploy** (top right). The included `.replit` is preconfigured for an **autoscale** deployment: it runs `npm run build` then `npm run start`. This gives you a `*.replit.app` production URL.

## Notes / caveats

- **PDF export.** `/report` has two buttons. **Print / Save PDF** uses the browser's
  own print dialogue and works everywhere — this is the recommended path. **Server
  PDF** (`/api/export/pdf`) uses `puppeteer-core` + `@sparticuz/chromium`, which is
  built for AWS Lambda and may not run on Replit; if it fails, the page says so and
  points at the print button.
- **Data never reaches the server.** Rows are parsed and queried in a web worker in
  the browser, so no upload size limit or serverless payload limit applies. Only a
  few KB of already-computed statistics are POSTed, and only when an LLM key is set.
- First build on Replit installs dependencies and can take a few minutes.

## Alternative: Vercel (most robust for Next.js)

Next.js is made by Vercel, so this is the smoothest host:

1. Go to https://vercel.com → **Add New… → Project** → import the same GitHub repo.
2. Optionally add `GROQ_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`.
3. Deploy → you get a `*.vercel.app` URL. Serverless functions handle the API routes natively.

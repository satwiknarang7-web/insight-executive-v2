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
| `ELEVENLABS_API_KEY` | optional | Narrate the presentation with an ElevenLabs voice instead of the browser's |
| `ELEVENLABS_VOICE_ID` | optional | Override the default narration voice (id from the ElevenLabs voice library) |
| `SMTP_USER` | for accounts | Gmail address that sends the two-factor codes |
| `SMTP_PASSWORD` | for accounts | Gmail **app password** (16 characters, not the account password) |
| `SMTP_HOST` / `SMTP_PORT` | optional | Defaults to `smtp.gmail.com` / `465` |
| `SMTP_FROM` | optional | Overrides the From header |
| `AUTH_OTP_PEPPER` | optional | Peppers one-time-code hashes; falls back to `VAULT_MASTER_KEY` |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` | optional | The model **Pro** accounts use when they have not brought a key of their own. Billed to you. |
| `SERVER_MODEL_PROVIDER` | optional | Which of those to use when several are set: `anthropic`, `google`, `openai` or `xai` |

**All of these are optional.** Analysis, charts and every number are computed in
the browser and are correct with no keys at all. A model key buys a model's
suggestions on the question card, the written summary and narration, and
natural-language questions on `/ask`.

**Whose model key is spent.** A reader's own key (saved in their browser) always
wins, billed to them. Otherwise a model runs on the deployment's key only for an
account on the **Pro** plan — never for Free, signed-out visitors, or a
deployment without accounts. When it does, the table summary (column names,
values or ranges, twenty sample rows) goes to that provider, and the landing
page says so. Each model route is rate-limited per account (`lib/routeLimits.js`).

Do **not** commit these — `.env` is gitignored.

### Checking the account setup

Two-factor sign-in depends on a database migration and on SMTP, and both fail in
ways that look like the other: a missing table means the code is never stored,
which presents as an email that never arrives. Each has a check that answers
directly.

| Command | What it does |
|---|---|
| `npm run db:apply supabase/APPLY_TO_LIVE_PROJECT.sql` | Applies the auth (and vault) migration, then prints every `svc_*` function with whether the server can call it and the browser is blocked. Safe to re-run. |
| `npm run mail:check` | Authenticates against SMTP without sending anything. Pass an address — `npm run mail:check you@example.com` — to also send one test message. |

Both read `.env.local`. `db:apply` needs `SUPABASE_DB_URL`, the project's Postgres
connection string, which is **not** one of the API keys above and carries the
database password — take the *session pooler* URI from Project Settings ->
Database, since the direct `db.<ref>.supabase.co` host is IPv6-only and
unreachable from most networks. Never give it a `NEXT_PUBLIC_` prefix: anything
so named is inlined into the browser bundle.

If sign-in returns 503 naming `APPLY_TO_LIVE_PROJECT.sql`, the migration has not
been applied. If sign-up returns 501, SMTP is not configured.

### Turning on "Continue with Google"

The button appears on `/sign-in` as soon as the two `NEXT_PUBLIC_SUPABASE_*`
variables are set, because that is the only thing the browser can check. It
does **not** mean Google is configured — the code is in place and the provider
is not, so the two steps below are what make it work rather than error.

Nothing needs to be redeployed for either. Both are console settings on
services you own.

**1. Google Cloud — create the OAuth client.** In *APIs & Services →
Credentials*, create an **OAuth client ID** of type *Web application*. The only
field that matters is **Authorised redirect URI**, and it is Supabase's
callback, not this app's:

```
https://<your-project-ref>.supabase.co/auth/v1/callback
```

Copy the client ID and client secret.

**2. Supabase — enable the provider.** In *Authentication → Providers →
Google*, switch it on and paste that ID and secret. Then in *Authentication →
URL Configuration*, add this app's callback to **Redirect URLs** — once per
origin you actually serve from:

```
https://your-domain.example/api/auth/callback
http://localhost:3000/api/auth/callback
```

Supabase refuses any `redirectTo` not on that list, which is what stops
somebody pointing your sign-in at their own site. A preview deployment on a
new hostname needs its own entry or its Google button will fail at the last
hop; the app builds the URL from `window.location.origin`, so it asks to come
back to whichever origin it was served from.

**What failure looks like.** Every error path lands back on `/sign-in` with a
sentence rather than a blank page: "Google did not complete the sign-in" means
the provider refused or the visitor declined; "that sign-in link could not be
completed" means the code exchange failed, and the reason is in the server log
under `[auth/callback]` — it is kept out of the page because it can name the
project and the grant type.

**One thing to decide.** A Google account and an email-plus-code account with
the same address are two identities to Supabase unless you turn on account
linking (*Authentication → Providers → "Allow linking"*). Without it, somebody
who signed up with a password and later clicks the Google button gets a second,
empty account and will report their saved analyses as missing. Signing in with
Google also bypasses the six-digit code by design: Google has already done the
second factor.

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
2. No model key is needed or read — viewers connect their own Gemini key in the app.
3. Deploy → you get a `*.vercel.app` URL. Serverless functions handle the API routes natively.

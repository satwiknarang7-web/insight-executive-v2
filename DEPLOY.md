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
| `GEMINI_API_KEY` | yes | Google Gemini (chart curation + analyst fallback) |
| `GROQ_API_KEY` | yes | Groq (primary LLM for analysis narrative) |
| `ANTHROPIC_API_KEY` | optional | Claude fallback if Groq/Gemini are down |

Do **not** commit these — `.env` is gitignored. The deterministic insight engine still produces correct, verified metrics even if every LLM key is missing; the keys only add the polished narrative wording.

## 3. Run + get a URL

- Click **Run**. Replit builds and serves on port 3000, giving you a live `*.replit.dev` preview URL.
- For a permanent, always-on URL, click **Deploy** (top right). The included `.replit` is preconfigured for an **autoscale** deployment: it runs `npm run build` then `npm run start`. This gives you a `*.replit.app` production URL.

## Notes / caveats

- **PDF export** (`/api/export/pdf`) uses `puppeteer-core` + `@sparticuz/chromium`, which is built for AWS Lambda and may not run on Replit. The rest of the app is unaffected; if PDF export errors, it can be swapped for a Replit-friendly Chromium later.
- First build on Replit installs dependencies and can take a few minutes.

## Alternative: Vercel (most robust for Next.js)

Next.js is made by Vercel, so this is the smoothest host:

1. Go to https://vercel.com → **Add New… → Project** → import the same GitHub repo.
2. Add the same environment variables (`GEMINI_API_KEY`, `GROQ_API_KEY`, optional `ANTHROPIC_API_KEY`).
3. Deploy → you get a `*.vercel.app` URL. Serverless functions handle the API routes natively.

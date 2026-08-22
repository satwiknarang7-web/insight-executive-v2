# Connection vault schema

These migrations create everything the connector layer stores: organisations,
membership, connection metadata, the encrypted credential vault and its audit
trail. Applying them is required before any database connector can be used —
and *only* if you want connectors. Uploading a spreadsheet needs none of this.

Files are named `<timestamp>_<name>.sql` and must be applied in filename order.
They match the schema currently deployed byte for byte.

## Applying them

### With the Supabase CLI (recommended)

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### By hand

Paste each file, in filename order, into the SQL editor in your Supabase
dashboard. Migrations 4, 5 and 6 depend on the earlier ones, so order matters.

## Then set the environment

Copy `.env.example` to `.env.local` and fill in four values:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → Project URL. The `https://…supabase.co` one, **not** a Postgres connection string. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable. Safe to expose; RLS gates it. |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys → service role. **Secret.** Bypasses RLS entirely. |
| `VAULT_MASTER_KEY` | Generate: `openssl rand -base64 32` |

Two things that are easy to get wrong and expensive to get wrong:

- Anything prefixed `NEXT_PUBLIC_` is **inlined into the browser bundle**. A
  Postgres connection string there would publish your database password to every
  visitor. Only the project URL and the publishable key belong under that prefix.
- `VAULT_MASTER_KEY` must not live in the Supabase project it protects. If the
  database and the key are compromised together, the encryption bought nothing.
  Losing it makes every stored credential unrecoverable — they must be re-entered.

## What the schema guarantees

- **Tenant isolation** — every table carries an organisation column with RLS
  enabled, even though a self-hosted deployment has exactly one organisation.
  Retrofitting this onto a live credential store is the migration nobody wants.
- **Secrets are unreachable from the browser** — they live in `app_private`, a
  schema PostgREST does not expose, with grants revoked and deny-all RLS. Only
  the service role, held solely by the server, can read them.
- **The audit trail cannot be forged** — clients may read their organisation's
  entries; only the server writes them.
- **Rotation is cheap** — each credential is encrypted under its own data key,
  and that key under the master key. Rotating the master key re-wraps a handful
  of small keys and never touches the credential ciphertext.

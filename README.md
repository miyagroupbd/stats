# Miya Stats — operations control plane

The board at **stats.miyagroupbd.com**. One place to run and report on Miya's
automation systems.

Today it controls/reports on:
- **Email pipeline** (`../email-pipeline`) — domains, leads, campaigns, messages,
  runs with live logs. Reads/writes the shared **PostgreSQL** directly.
- **N8N automations** — workflow health + recent executions via the N8N REST API.

Built to add more systems later: each gets an integration client or a DB reader.

```
stats/
├── backend/            FastAPI control-plane API  (uvicorn app.main:app)
│   ├── app/            routers, schemas, services, integrations
│   ├── app/core/       prisma client, settings, security (JWT/Argon2/Fernet)
│   ├── prisma/         schema.prisma (introspected from the shared PostgreSQL)
│   ├── Procfile
│   └── requirements.txt
└── frontend/           Next.js 16 + Tailwind v4 board
```
Same shape as the other Miya backends (`backend/app` + `Procfile`, run as `app.main:app`).

## How it talks to the email pipeline

- **Reads/writes** the shared PostgreSQL directly (leads, campaigns, messages, stats).
- **Triggering a run** is decoupled: the board writes a `Run` row with
  `status=queued`; the pipeline's worker (`python -m engine.worker` over in
  `email-pipeline/`) claims and executes it, streaming progress into `run_logs`
  which the board then displays live. The board never executes agent code.

## Local development

```bash
# Postgres comes from the email-pipeline compose file
cd ../email-pipeline && docker compose up -d db && cd ../stats

python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements.txt
cp .env.example .env            # fill DATABASE_URL, APP_SECRET, JWT_SECRET

cd backend
../.venv/Scripts/python -m uvicorn app.main:app --port 8099
cd ..

cd frontend
pnpm install
echo "NEXT_PUBLIC_API_URL=http://127.0.0.1:8099" > .env.local
pnpm dev                        # http://localhost:3000
```

## Deploy (planned)
- **backend** → Hostinger VPS (Coolify), same Postgres as the pipeline.
- **frontend** → Vercel at `stats.miyagroupbd.com`, `NEXT_PUBLIC_API_URL` → backend.

## Notes
- Stack is **FastAPI + prisma-client-py + PostgreSQL**, same as the other Miya backends.
- `backend/prisma/schema.prisma` was introspected (`prisma db pull`) from the shared DB.
  **The email-pipeline owns migrations** (its `alembic/`); after a schema change run
  `prisma db pull` + `prisma generate` here.
- ⚠ On Windows, generate with the target venv FIRST on PATH and `PYTHONUTF8=1`, or the
  client lands in another project's venv (see the prisma trap note).
- `APP_SECRET` must match the pipeline's, or encrypted SMTP passwords won't decrypt.

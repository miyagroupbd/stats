# GRAPH_REPORT — stats

Generated: 2026-08-11 · graphify: files 55 · symbols 193 · edges 164
(193 = 160 declarations + 33 file-level nodes. 47 files carry declarations;
74 files on disk outside `node_modules`/`.venv`/`.next`.)

Edge relations: contains=158 · inherits=4 · method=2

## Architecture notes (graph sweep 2026-08-11)

**What it is:** `stats.miyagroupbd.com` — the operations board for the email pipeline.
FastAPI backend + Next.js 16 App Router frontend, both reading/writing the **shared
email-pipeline PostgreSQL**. It is the pipeline's control plane and UI; the pipeline
repo itself ships no web app.

### Correction to workspace CLAUDE.md

CLAUDE.md says *"`stats/db/` mirrors the email-pipeline schema"*. **That directory no
longer exists** — commits `0ce9938` (*refactor: match the house backend layout (no
top-level db/)*) and `51412af` (*switch stats backend to prisma-client-py*) replaced it.
The schema mirror is now:

- **`backend/prisma/schema.prisma`** — 239 lines, 14 introspected models
  (`users`, `domains`, `campaigns`, `leads`, `messages`, `events`, `suppression`,
  `runs`, `run_logs`, `email_cache`, `domain_intel`, `settings`, `alembic_version`).
  It is **pulled, not authored** — email-pipeline's alembic still owns migrations.
- **`backend/scripts/prisma_pull.sh`** — Coolify-scheduled every 6h: `prisma db pull`,
  sha256-compare, and only on a real change `prisma generate`. A regenerated client
  needs an app restart to take effect (the script says so; it does not restart itself).
- **`backend/scripts/entrypoint.sh`** — never pushes schema; regenerates the client only
  if the baked one is missing, then `uvicorn app.main:app`.

### Backend (`backend/app/`)

- **`core/db.py`** — `Prisma(auto_register=True)` singleton; `connect_db`/`disconnect_db`.
  `main.py`'s lifespan **swallows a failed connect on purpose** so `/health` and `/docs`
  still serve when Postgres is down.
- **`core/security.py`** — JWT create/decode, **Argon2id** `hash_password`/`verify_password`
  (same scheme as the pipeline's `db/passwords.py`, consolidated here), plus the *same* Fernet
  `encrypt`/`decrypt`/`is_encrypted` as email-pipeline `db/crypto.py`. **`APP_SECRET` must
  match the pipeline's** or stored SMTP passwords won't decrypt.
- **`core/config.py`** — `Settings` + `cors_origin_list`. **`deps.py`** — `get_current_user`,
  `require_admin`.
- **`routers/`** — `auth` (login/me), `domains` (CRUD, admin-gated, SMTP config),
  `campaigns`, `leads` (CRUD + CSV `import_leads` + `lead_messages`), `messages`
  (list/detail + **edit/approve/reject/send** — the human approval gate), `runs`
  (`trigger_run`, `get_run_logs`, `stream_run_logs`), `stats` (reply/bounce/sent rates),
  `automations` (n8n via `integrations/n8n.py`, key-gated, degrades gracefully).
- **`services/runner.py`** — `start_run` writes a `runs` row with `status='queued'` and
  `triggered_by='dashboard'`; **no agent code is imported**. `VALID_MODES = full, daily,
  monitor, report, harvest, send`. `stage` on a `send` run targets one approved message
  (individual send).

**Approval-gate invariant (`routers/messages.py`):** editing a message is allowed while
`drafted/approved/rejected/failed` and refused once `queued/sent`; **any edit of an
APPROVED message resets it to `drafted`** and clears `approved_at`/`approved_by`, so what
a human approved is exactly what ships. `approve` only flips status — A5 in the pipeline
does the sending.

### Frontend (`frontend/src/`)

13 routes under `app/`: `(dashboard)` overview, `domains` + `[slug]`, `leads`, `messages`,
`runs` + `[id]`, `campaigns`, `automations`, `settings`, plus `login` and the two layouts.
`lib/` = `api.ts` (token-injecting `apiFetch` + `ApiError`), `auth.tsx` (`AuthProvider`/
`useAuth`), `hooks.ts` (`useDomains`), `toast.ts` (`confirmToast`, sonner-backed since
`6da0e21`), `types.ts`. Components: `AppShell`, `DomainSelect`, `ui`.

**Read the graph with care here:** React components declared as anonymous default exports
produce no symbol, so a route's page component is usually absent while its inner helpers
(`doApprove`, `poll`, `ingest`, `toggleDay`…) are indexed. The route list at the bottom of
this report is the reliable index for pages.

### Delta since the 2026-08-04 sweep

- Prisma-client-py migration + the `no top-level db/` layout change (above).
- Containerized for Coolify (`Dockerfile`, `entrypoint.sh`, 6-hourly `prisma_pull.sh`).
- Message approval gate shipped end to end: `approve`/`reject`/`send` endpoints, then the
  UI controls, then **editable drafts that reset approval**, then the 12h auto-send veto
  window copy (matching `AUTO_SEND_AFTER_HOURS` in the pipeline's A5).
- Dashboard bounce rate; `messages` gained "Sent from", "bounced" and "sent-to" columns.
- `leads` and `messages` default to **All domains** so the pages match the dashboard.
- Native `alert`/`confirm` replaced by sonner toasts across the board.
- Next pinned to 16.2.10 (security patch) + `vercel.json`.

### Route index (globbed, not graphed)

| Route | File |
|---|---|
| `/login` | `frontend/src/app/login/page.tsx` |
| `/` (overview) | `frontend/src/app/(dashboard)/page.tsx` |
| `/domains` | `frontend/src/app/(dashboard)/domains/page.tsx` |
| `/domains/[slug]` | `frontend/src/app/(dashboard)/domains/[slug]/page.tsx` |
| `/leads` | `frontend/src/app/(dashboard)/leads/page.tsx` |
| `/messages` | `frontend/src/app/(dashboard)/messages/page.tsx` |
| `/runs` | `frontend/src/app/(dashboard)/runs/page.tsx` |
| `/runs/[id]` | `frontend/src/app/(dashboard)/runs/[id]/page.tsx` |
| `/campaigns` | `frontend/src/app/(dashboard)/campaigns/page.tsx` |
| `/automations` | `frontend/src/app/(dashboard)/automations/page.tsx` |
| `/settings` | `frontend/src/app/(dashboard)/settings/page.tsx` |
| layouts | `app/layout.tsx` (`RootLayout`), `app/(dashboard)/layout.tsx` (`DashboardLayout`) |

No `route.ts` handlers exist — the frontend talks only to the FastAPI backend via
`lib/api.ts`.

### Tooling gotcha (verified 2026-08-11)

`graphify update <graph.json> <file>` **fails in this install** — it exits 1 with
`The "paths[2]" property must be of type string, got array`, with relative *and* absolute
paths. Only `graphify build .` (full rebuild) works, and it does **not** write
GRAPH_REPORT.md — this report is assembled from `graph.json` separately. Workspace
CLAUDE.md rule 1's `graphify update .` is not valid CLI syntax either way.

## Files & symbols by area

_47 of 55 walked files carry symbols. Line numbers are from the 2026-08-11 build._

### backend/app/
- **backend/app/__init__.py** (0 symbols)
- **backend/app/deps.py** (2 symbols)
  - `get_current_user` (L15)
  - `require_admin` (L35)
- **backend/app/main.py** (2 symbols)
  - `lifespan` (L24)
  - `health` (L48)

### backend/app/core/
- **backend/app/core/config.py** (2 symbols)
  - `Settings` (L9)
  - `.cors_origin_list` (L23)
- **backend/app/core/db.py** (2 symbols)
  - `connect_db` (L12)
  - `disconnect_db` (L17)
- **backend/app/core/security.py** (8 symbols)
  - `create_access_token` (L21)
  - `decode_access_token` (L33)
  - `hash_password` (L44)
  - `verify_password` (L48)
  - `_fernet` (L60)
  - `encrypt` (L68)
  - `decrypt` (L74)
  - `is_encrypted` (L83)

### backend/app/integrations/
- **backend/app/integrations/n8n.py** (6 symbols)
  - `enabled` (L24)
  - `_headers` (L28)
  - `_get` (L32)
  - `list_workflows` (L45)
  - `list_executions` (L62)
  - `summary` (L87)

### backend/app/routers/
- **backend/app/routers/auth.py** (2 symbols)
  - `login` (L17)
  - `me` (L29)
- **backend/app/routers/automations.py** (3 symbols)
  - `automations_summary` (L13)
  - `automations_workflows` (L19)
  - `automations_executions` (L26)
- **backend/app/routers/campaigns.py** (6 symbols)
  - `_resolve_domain` (L22)
  - `_lead_count` (L34)
  - `list_campaigns` (L39)
  - `create_campaign` (L54)
  - `update_campaign` (L74)
  - `delete_campaign` (L102)
- **backend/app/routers/domains.py** (8 symbols)
  - `_to_out` (L28)
  - `_is_admin` (L40)
  - `_wrap_json` (L44)
  - `list_domains` (L53)
  - `get_domain` (L62)
  - `create_domain` (L73)
  - `update_domain` (L91)
  - `delete_domain` (L112)
- **backend/app/routers/leads.py** (12 symbols)
  - `_resolve_domain` (L49)
  - `_parse_choice` (L59)
  - `_get_lead_or_404` (L70)
  - `_validate_campaign` (L77)
  - `_upsert_lead` (L89)
  - `list_leads` (L118)
  - `get_lead` (L158)
  - `create_lead` (L169)
  - `update_lead` (L193)
  - `delete_lead` (L215)
  - `import_leads` (L238)
  - `lead_messages` (L289)
- **backend/app/routers/messages.py** (10 symbols)
  - `MessagePage` (L27)
  - `_resolve_domain_id` (L32)
  - `list_messages` (L43)
  - `get_message` (L105)
  - `_get_message_or_404` (L123)
  - `_domain_slug_for_message` (L130)
  - `edit_message` (L141)
  - `approve_message` (L181)
  - `reject_message` (L202)
  - `send_message` (L221)
- **backend/app/routers/runs.py** (7 symbols)
  - `_resolve_domain_id` (L30)
  - `_get_run_or_404` (L42)
  - `trigger_run` (L50)
  - `list_runs` (L70)
  - `get_run` (L82)
  - `get_run_logs` (L91)
  - `stream_run_logs` (L104)
- **backend/app/routers/stats.py** (5 symbols)
  - `_reply_rate` (L35)
  - `_bounce_rate` (L39)
  - `_sent_count` (L44)
  - `_counts_by_status` (L51)
  - `domain_stats` (L126)

### backend/app/schemas/
- **backend/app/schemas/auth.py** (3 symbols)
  - `LoginRequest` (L9)
  - `UserOut` (L14)
  - `TokenResponse` (L24)
- **backend/app/schemas/campaign.py** (3 symbols)
  - `CampaignCreate` (L9)
  - `CampaignUpdate` (L14)
  - `CampaignOut` (L20)
- **backend/app/schemas/common.py** (2 symbols)
  - `Message` (L7)
  - `Page` (L11)
- **backend/app/schemas/domain.py** (4 symbols)
  - `DomainBase` (L9)
  - `DomainCreate` (L37)
  - `DomainUpdate` (L42)
  - `DomainOut` (L72)
- **backend/app/schemas/lead.py** (5 symbols)
  - `LeadBase` (L9)
  - `LeadCreate` (L23)
  - `LeadUpdate` (L28)
  - `LeadOut` (L42)
  - `LeadImportResult` (L64)
- **backend/app/schemas/message.py** (2 symbols)
  - `MessageEdit` (L9)
  - `MessageOut` (L16)
- **backend/app/schemas/run.py** (3 symbols)
  - `RunTrigger` (L9)
  - `RunOut` (L14)
  - `RunLogOut` (L28)
- **backend/app/schemas/stats.py** (2 symbols)
  - `Overview` (L19)
  - `DomainStat` (L7)

### backend/app/services/
- **backend/app/services/runner.py** (1 symbols)
  - `start_run` (L16)

### frontend/
- **frontend/next-env.d.ts** (0 symbols)
- **frontend/next.config.ts** (0 symbols)

### frontend/src/app/
- **frontend/src/app/layout.tsx** (1 symbols)
  - `RootLayout` (L11)

### frontend/src/app/(dashboard)/
- **frontend/src/app/(dashboard)/layout.tsx** (1 symbols)
  - `DashboardLayout` (L9)
- **frontend/src/app/(dashboard)/page.tsx** (4 symbols)
  - `load` (L105)
  - `pct` (L31)
  - `fmtNum` (L37)
  - `StatCard` (L65)

### frontend/src/app/(dashboard)/automations/
- **frontend/src/app/(dashboard)/automations/page.tsx** (1 symbols)
  - `Stat` (L17)

### frontend/src/app/(dashboard)/campaigns/
- **frontend/src/app/(dashboard)/campaigns/page.tsx** (3 symbols)
  - `onChangeDomain` (L64)
  - `createCampaign` (L69)
  - `deleteCampaign` (L90)

### frontend/src/app/(dashboard)/domains/
- **frontend/src/app/(dashboard)/domains/page.tsx** (1 symbols)
  - `handleCreate` (L45)

### frontend/src/app/(dashboard)/domains/[slug]/
- **frontend/src/app/(dashboard)/domains/[slug]/page.tsx** (11 symbols)
  - `performDelete` (L259)
  - `seed` (L44)
  - `emptyNull` (L75)
  - `Field` (L78)
  - `CheckRow` (L98)
  - `set` (L157)
  - `num` (L160)
  - `toggleDay` (L165)
  - `onSave` (L175)
  - `onRun` (L236)
  - `onDelete` (L250)

### frontend/src/app/(dashboard)/leads/
- **frontend/src/app/(dashboard)/leads/page.tsx** (3 symbols)
  - `errMsg` (L47)
  - `fullName` (L53)
  - `onImportFile` (L128)

### frontend/src/app/(dashboard)/messages/
- **frontend/src/app/(dashboard)/messages/page.tsx** (12 symbols)
  - `kindLabel` (L30)
  - `buildQuery` (L34)
  - `onDomain` (L87)
  - `onStatus` (L91)
  - `onKind` (L95)
  - `startEdit` (L315)
  - `run` (L322)
  - `doSaveEdit` (L340)
  - `doApprove` (L358)
  - `doReject` (L366)
  - `doSend` (L377)
  - `onKey` (L398)

### frontend/src/app/(dashboard)/runs/
- **frontend/src/app/(dashboard)/runs/page.tsx** (2 symbols)
  - `fmtDuration` (L22)
  - `triggerRun` (L87)

### frontend/src/app/(dashboard)/runs/[id]/
- **frontend/src/app/(dashboard)/runs/[id]/page.tsx** (7 symbols)
  - `humanDuration` (L21)
  - `logTime` (L38)
  - `Meta` (L44)
  - `statValue` (L53)
  - `ingest` (L95)
  - `poll` (L109)
  - `initialLoad` (L141)

### frontend/src/app/(dashboard)/settings/
- **frontend/src/app/(dashboard)/settings/page.tsx** (1 symbols)
  - `KV` (L18)

### frontend/src/app/login/
- **frontend/src/app/login/page.tsx** (1 symbols)
  - `onSubmit` (L14)

### frontend/src/components/
- **frontend/src/components/AppShell.tsx** (1 symbols)
  - `AppShell` (L19)
- **frontend/src/components/DomainSelect.tsx** (0 symbols)
- **frontend/src/components/ui.tsx** (1 symbols)
  - `formatDate` (L4)

### frontend/src/lib/
- **frontend/src/lib/api.ts** (5 symbols)
  - `getToken` (L9)
  - `setToken` (L14)
  - `ApiError` (L20)
  - `.constructor` (L22)
  - `apiFetch` (L28)
- **frontend/src/lib/auth.tsx** (2 symbols)
  - `AuthProvider` (L17)
  - `useAuth` (L58)
- **frontend/src/lib/hooks.ts** (2 symbols)
  - `loadDomains` (L12)
  - `useDomains` (L31)
- **frontend/src/lib/toast.ts** (1 symbols)
  - `confirmToast` (L8)
- **frontend/src/lib/types.ts** (0 symbols)

## Type relationships (non-`contains` edges)

- `inherits` — `domain::domaincreate` → `domain::domainbase`
- `inherits` — `domain::domainout` → `domain::domainbase`
- `inherits` — `lead::leadcreate` → `lead::leadbase`
- `inherits` — `lead::leadout` → `lead::leadbase`
- `method` — `api::apierror` → `api::apierror::constructor`
- `method` — `config::settings` → `config::settings::cors_origin_list`

## Invisible to the graph (code files with zero extracted symbols)

Graphify indexes declarations; a file that only default-exports an anonymous component, re-exports, or holds pure config yields no symbol and will never appear in a `graphify query`. Glob these directly.

- backend/app/core/__init__.py
- backend/app/integrations/__init__.py
- backend/app/routers/__init__.py
- backend/app/schemas/__init__.py
- backend/app/services/__init__.py

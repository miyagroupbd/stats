# Graph Report - stats  (2026-08-29)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 553 nodes · 796 edges · 60 communities (44 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.71)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `useDomains()` - 15 edges
3. `formatDate()` - 13 edges
4. `Spinner()` - 12 edges
5. `api` - 12 edges
6. `EmptyState()` - 11 edges
7. `Card()` - 11 edges
8. `PageHeader()` - 11 edges
9. `ApiError` - 10 edges
10. `useAuth()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `login()` --calls--> `create_access_token()`  [INFERRED]
  backend/app/routers/auth.py → backend/app/core/security.py
- `login()` --calls--> `verify_password()`  [INFERRED]
  backend/app/routers/auth.py → backend/app/core/security.py
- `MessagePage` --uses--> `Page`  [INFERRED]
  backend/app/routers/messages.py → backend/app/schemas/common.py
- `lifespan()` --calls--> `connect_db()`  [INFERRED]
  backend/app/main.py → backend/app/core/db.py
- `lifespan()` --calls--> `disconnect_db()`  [INFERRED]
  backend/app/main.py → backend/app/core/db.py

## Import Cycles
- None detected.

## Communities (60 total, 16 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (60): CampaignsPage(), DAYS, Form, fullName(), LeadDrawer(), LeadImportResult, LeadsPage(), PRIORITIES (+52 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (47): page.tsx, buildQuery, CheckRow, createCampaign, deleteCampaign, doApprove, doReject, doSaveEdit (+39 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (33): create_lead(), delete_lead(), get_lead(), _get_lead_or_404(), import_leads(), lead_messages(), list_leads(), _parse_choice() (+25 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (20): connect_db(), disconnect_db(), Prisma client singleton (house pattern, same as the other Miya backends).  The a, Shared FastAPI dependencies — async auth over the Prisma client., lifespan(), FastAPI entrypoint for the Miya Stats control plane (stats.miyagroupbd.com)., automations_summary(), Automations router — N8N workflow + execution reporting for the board. (+12 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (22): dependencies, next, react, react-dom, recharts, sonner, devDependencies, tailwindcss (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (20): approve_message(), _domain_slug_for_message(), edit_message(), get_message(), _get_message_or_404(), list_messages(), MessagePage, Messages router — read-only listing of drafted/sent emails for the dashboard.  E (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.18
Nodes (18): Any, encrypt(), create_domain(), get_domain(), _is_admin(), list_domains(), Domains router — CRUD for business-arm sending domains.  Reads are open to any a, Build a DomainOut, deriving smtp_configured and never leaking the password. (+10 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (14): create_access_token(), decode_access_token(), decrypt(), _fernet(), Auth + secret handling: JWT issue/verify, Argon2id passwords, Fernet crypto.  Co, verify_password(), get_current_user(), login() (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.17
Nodes (15): get_run(), get_run_logs(), _get_run_or_404(), list_runs(), Runs router — trigger pipeline runs, list/read runs, and stream live logs.  Read, Server-Sent-Events stream of run logs until the run leaves queued/running., Turn a ?domain= (slug OR numeric id) into a domain id, or None if absent., Queue a pipeline run for the engine worker; returns the new run id. (+7 more)

### Community 10 - "Community 10"
Cohesion: 0.23
Nodes (12): create_campaign(), delete_campaign(), _lead_count(), list_campaigns(), Response, Campaigns router — per-domain campaign CRUD + lead counts for the dashboard.  Ca, Resolve a ``?domain=`` value that may be a slug or a numeric id. 404 if missing., _resolve_domain() (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (13): leads.py, _get_lead_or_404, _parse_choice, _resolve_domain, _upsert_lead, _validate_campaign, create_lead, delete_lead (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.18
Nodes (11): messages.py, _domain_slug_for_message, _get_message_or_404, _resolve_domain_id, approve_message, edit_message, get_message, list_messages (+3 more)

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (7): DashboardLayout(), metadata, LoginPage(), AppShell(), NAV, AuthProvider(), useAuth()

### Community 14 - "Community 14"
Cohesion: 0.42
Nodes (8): enabled(), _get(), _headers(), list_executions(), list_workflows(), N8N client — powers the automation-board reports.  Talks to a self-hosted or clo, Aggregate for the board: workflow + execution health at a glance., summary()

### Community 15 - "Community 15"
Cohesion: 0.22
Nodes (9): _is_admin, _to_out, _wrap_json, create_domain, delete_domain, get_domain, list_domains, update_domain (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (9): security.py, _fernet, create_access_token, decode_access_token, decrypt, encrypt, hash_password, is_encrypted (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.25
Nodes (8): AuthProvider, login, LoginRequest, me, TokenResponse, useAuth, UserOut, auth.tsx

### Community 18 - "Community 18"
Cohesion: 0.25
Nodes (8): runs.py, _get_run_or_404, _resolve_domain_id, get_run, get_run_logs, list_runs, stream_run_logs, trigger_run

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (8): stats.py, _bounce_rate, _counts_by_status, _reply_rate, _sent_count, domain_stats, DomainStat, Overview

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (7): _lead_count, _resolve_domain, create_campaign, delete_campaign, list_campaigns, update_campaign, campaigns.py

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (7): n8n.py, _get, _headers, enabled, list_executions, list_workflows, summary

### Community 22 - "Community 22"
Cohesion: 0.33
Nodes (6): ApiError, .constructor, apiFetch, getToken, setToken, api.ts

### Community 23 - "Community 23"
Cohesion: 0.47
Nodes (6): lead.py, LeadBase, LeadCreate, LeadImportResult, LeadOut, LeadUpdate

### Community 24 - "Community 24"
Cohesion: 0.33
Nodes (5): Deploy (planned), How it talks to the email pipeline, Local development, Miya Stats — operations control plane, Notes

### Community 25 - "Community 25"
Cohesion: 0.40
Nodes (3): Backend settings (env-driven)., Settings, BaseSettings

### Community 26 - "Community 26"
Cohesion: 0.60
Nodes (5): DomainBase, DomainCreate, DomainOut, DomainUpdate, domain.py

### Community 27 - "Community 27"
Cohesion: 0.40
Nodes (4): buildCommand, framework, installCommand, $schema

### Community 28 - "Community 28"
Cohesion: 0.50
Nodes (4): automations_executions, automations_summary, automations_workflows, automations.py

### Community 29 - "Community 29"
Cohesion: 0.50
Nodes (3): Run triggering — enqueue only (async Prisma).  The board never executes agent co, Queue a pipeline run for the engine worker. Returns the new run id.      `stage`, start_run()

### Community 30 - "Community 30"
Cohesion: 0.50
Nodes (4): CampaignCreate, CampaignOut, CampaignUpdate, campaign.py

### Community 31 - "Community 31"
Cohesion: 0.50
Nodes (4): run.py, RunLogOut, RunOut, RunTrigger

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (3): Message, Page, common.py

### Community 33 - "Community 33"
Cohesion: 0.67
Nodes (3): Settings, .cors_origin_list, config.py

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (3): connect_db, disconnect_db, db.py

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (3): get_current_user, require_admin, deps.py

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (3): hooks.ts, loadDomains, useDomains

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (3): layout.tsx, DashboardLayout, RootLayout

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (3): main.py, health, lifespan

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (3): message.py, MessageEdit, MessageOut

## Knowledge Gaps
- **66 isolated node(s):** `entrypoint.sh script`, `prisma_pull.sh script`, `nextConfig`, `name`, `version` (+61 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MessageOut` connect `Community 5` to `Community 2`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Why does `get_current_user()` connect `Community 8` to `Community 3`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `Core wiring: Prisma client, settings, security.`, `Backend settings (env-driven).`, `Prisma client singleton (house pattern, same as the other Miya backends).  The a` to the rest of the system?**
  _112 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05292929292929293 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09009009009009009 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09852216748768473 - nodes in this community are weakly interconnected._
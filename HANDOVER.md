# MRHB Analytics Dashboard — Complete Handover Guide

_Last updated: 2026-08-05. This is the canonical handover reference. Read it fully before making any change._

## 0. TL;DR for the AI taking over

You are the long-term technical steward of a **decision-grade analytics dashboard** for MRHB Network (Shariah-compliant fintech). The prime directive is **trustworthy reporting**: never present sample/mock data as live, always reconcile a metric against its authoritative source, make **small reversible fixes with an audit trail**, and **ask before** anything irreversible, source-of-truth-altering, credential-rotating, or definition-changing.

- **Repo:** `hellovickysen/mrhb-analytics-dashboard` · **Prod:** https://mrhb-analytics-dashboard-two.vercel.app
- **Stack:** Next.js 14 App Router · TypeScript · Tailwind · Supabase · Vercel (Hobby) · Recharts
- **You cannot run a local full build or DDL.** You edit files and deploy via the GitHub API; the user applies SQL migrations in Supabase. See §12 (Deploy & Validation) and §13 (DON'T BREAK).

---

## 1. Current status (Aug 2026)

**Live & real:** Overview, Traffic, SEO, Blog, Social — all reconciled to authoritative sources. App Performance is real (GA4 for Firebase + Play listing), with config-driven metrics, per-tool usage tabs, "Tile Clicks by Tool", and a new-user onboarding drop-off funnel. User Journey funnel is real but **cross-source** (not one cohort). Admin is fully wired (live editors + sync status).

**Intentionally NOT live (labelled sample / not-connected):**
- **Revenue** — needs Firebase purchase/revenue events. Never show transaction counts as money.
- **UX & Friction** — Microsoft Clarity API returns no data → sample.
- **Funnel Impressions (social/app-store)** — no source yet.
- **New Users (registered accounts)** — the authoritative figure lives only in the product **backend DB**, which the owner has declined to connect. GA4 proxies undercount it (see §9).

**Owner-side tasks still outstanding (need their action, not code):**
1. Play **GCS bulk reports** bucket (`pubsite_prod_rev_<id>` + Storage Object Viewer) → real net installs + full star-rating histogram.
2. **App Store Connect** → iOS installs/ratings/reviews.
3. **Firebase purchase/revenue events** → Revenue page.
4. Social / app-store **impressions APIs** → funnel top stage.

---

## 2. Prime directive & operating rules

1. **Provenance before display.** A number is not "real" until its source, ingestion, storage, and dashboard calculation are all understood. Reproduce a suspected mismatch first (page, URL range, metric label, observed vs expected), then trace end-to-end before changing code.
2. **Authoritative source per metric** (see §7). State which source is authoritative when reconciling.
3. **Distinguish** true defect vs intentional mock vs source limitation vs definition mismatch — before "fixing".
4. **Mock fallbacks are intentional** for gaps (Clarity, revenue). Keep them clearly labelled as sample/Not connected; never silently present them as live.
5. **Targeted, reversible changes.** Prefer migrations for DB changes; preserve historical data; never fabricate source values.
6. **Ask before** irreversible actions, source-of-truth data edits, credential rotation, or reporting-definition changes.
7. **Leave an audit trail** — a descriptive commit per business-impacting change: what was observed, what changed, why it's correct, what's still uncertain.

---

## 3. Architecture & data flow

```
External sources ──(API clients)──> Ingestion orchestrator ──(service-role upsert)──> Supabase (Postgres)
                                                                                          │
                                              Dashboard pages (server components) reads ──┘
```

- **Sync triggers:** daily Vercel cron `0 0 * * *` (midnight UTC) → `/api/cron`; or manual `POST /api/refresh {source, daysBack}` (the Sidebar "Sync" button; self-heals after a DB pause on the next run).
- **"Sync" vs "Refresh":** Sidebar **Sync** = real ingestion (`POST /api/refresh`). Header **Refresh** = `router.refresh()` (re-reads current data, no ingestion).
- **Reads:** every dashboard page reads Supabase via `createServiceClient()` (service role, bypasses RLS). RLS is on with no policies → only service role reads.
- **Mock fallback:** each page falls back to a clearly-labelled `MOCK_*` when a source is empty/errors.

---

## 4. File structure (key/current)

```
app/(dashboard)/
  page.tsx                      Overview (server)
  traffic|seo|blog|social/page  authoritative, reconciled (server)
  funnel/page.tsx               User Journey cone (server, cross-source)
  app-performance/page.tsx      App (GA4 Firebase + Play), config-driven (server)
  ux/page.tsx                   Sample (Clarity)   revenue/page.tsx  Sample
  how-it-works/page.tsx         Plain-English KPI reference (server, live config)
  admin/page.tsx                Editors + sync status (CLIENT)
  layout.tsx                    Sidebar shell (CLIENT)
app/api/
  cron/route.ts  refresh/route.ts  last-sync/route.ts  freshness/route.ts
  admin/{tracked-events,tool-config,sync-status,app-metrics}/route.ts   (service-role GET/POST configs)
components/
  layout/{Sidebar,Header}.tsx           CLIENT; Header owns range picker + range cookie
  cards/KPICard.tsx                     CLIENT; iconName curated map; %+delta+"vs prev period"
  charts/{Line,Area,Bar,Donut,Funnel}Chart.tsx   CLIENT (BarChart layout prop is inverted vs Recharts internally)
  app-performance/ToolUsageTabs.tsx     CLIENT; per-tool tabs + All Tools overview + Avg Daily Users
  tables/DataTable.tsx
lib/
  api-clients/… google-auth, google-analytics, ga4-app-active-total, search-console,
                play-console, play-reviews, shortio, clarity, store-scraper
  ingestion/index.ts            getDateWindow(daysBack) here is INGESTION-only; different from utils/date-range
  config/tool-usage.ts          DEFAULT_TOOL_MAPPINGS, computeToolTabs, toolForEventName, platformOf
  config/app-metrics.ts         DEFAULT_APP_METRICS, matchesAppMetric, resolveAppMetrics
  supabase/server.ts            createServiceClient()
  utils/date-range.ts           getDateWindow(searchParams) → {startDate,endDate,prevStartDate,prevEndDate,days,range}
  utils/format.ts               formatNumber (FULL numbers, comma-grouped), formatPercent, deltaFromPct, …
supabase/migrations/            001_initial · 002_tracked_events(funnel_stage) · 003_tool_usage_config · 004_app_metric_map
middleware.ts                   cookie auth guard (all pages 307-redirect to /login when unauthed)
vercel.json                     cron: 0 0 * * *  (see §13 — do NOT make it more frequent on Hobby)
```

---

## 5. Critical patterns & rules

- **Server/Client boundary (top bug source):** dashboard pages are server components; anything interactive lives in `components/` as `'use client'`. Never pass functions/React components server→client. Icons pass as `iconName` string (KPICard resolves via a **curated ICON_MAP** — only add a lucide icon to that map before using a new `iconName`, or it silently falls back to Users).
- **Date semantics:** `getDateWindow(searchParams)` (in `lib/utils/date-range.ts`) returns inclusive `startDate`/`endDate`, previous-period boundaries, `days`, and `range`. Every page/report/chart must use equivalent inclusive/exclusive semantics and explain prior-period baselines the same way. (Note the identically-named `getDateWindow(daysBack:number)` inside `lib/ingestion/index.ts` is a different function — don't confuse them.)
- **Range persistence:** Header writes a session cookie `mrhb_range` and restores it when the URL has no `?range=`; Sidebar carries the active range on every nav link. Pages remain the source of truth via the URL param.
- **Config-driven metrics (App Performance):**
  - `app_metric_map` (migration 004) defines metric blocks (patterns + match_type). `resolveAppMetrics(rows)` merges DB over `DEFAULT_APP_METRICS`; `matchesAppMetric(def, NAMEUPPER)` classifies events. Editing a block in **Admin → App Performance Metrics** re-derives every card that uses it.
  - `tool_usage_config` (migration 003) defines tool→event patterns; `computeToolTabs` and `toolForEventName` (first-match-wins by sortOrder) drive the tool tabs AND the "Tile Clicks by Tool" chart. Editable in **Admin → Tool Usage Mapping**.
- **KPI cards:** pass `value` (string via `formatNumber`), `change` (%), `changeValue` (absolute delta via `deltaFromPct(value, change)`), `trend`. KPICard shows the % + absolute delta top-right and derives the **previous-period value** in-card (`previous = changeValue ÷ (change/100)`) for the "vs N previous period" line. Cards without a baseline correctly show no delta.
- **Numbers:** `formatNumber` shows FULL comma-grouped numbers (no K/M/B) everywhere — KPI values, sub-text, tables, funnels, tool tabs. Chart **axis ticks** keep their own compact `k` formatter (intentional).
- **Pagination:** Supabase caps ~1000 rows/request. Any `ga_events`/`gsc_pages` scan MUST paginate with `.range(from, from+PAGE-1)` in a loop. Not paginating silently truncates and undercounts.

---

## 6. Environment variables (names only — never print values)

Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Google: `GA4_PROPERTY_ID` (website), `GA4_APP_PROPERTY_ID=292950442` (Sahal Wallet Firebase), `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GSC_SITE_URL=https://mrhb.network`. Android Publisher scope enabled (GCP project 579352547101; service account `mrhb-analytics-dashboard@mrhb-analytics.iam.gserviceaccount.com`).
Short.io: `SHORTIO_API_KEY` (secret), `SHORTIO_DOMAIN=mrhbnetwork.short.gy`.
Stores: `PLAY_PACKAGE_NAME=sahal.wallet.app`, `APP_STORE_ID=1602366920` (Russian storefront required). Clarity: `CLARITY_API_TOKEN`, `CLARITY_PROJECT_ID` (returns no data). Cron: `CRON_SECRET`.

---

## 7. Data sources — authoritative mapping

| Metric area | Authoritative source | Notes / gotchas |
|---|---|---|
| Website users/sessions/traffic | **GA4 website** (`GA4_PROPERTY_ID`) | activeUsers/totalUsers are **de-duplicated & non-additive** — NEVER sum across days. Use stored `daily_kpis` for per-range totals. |
| App active users | **GA4 for Firebase** (`GA4_APP_PROPERTY_ID`) via `fetchGA4AppActiveUsersTotal` | de-duplicated period total (no date dimension). Don't sum daily session_start users. |
| App installs | **Play Store** (real, pending GCS) / GA4 `first_open` (proxy now) | `first_open` ≈ install proxy, undercounts store; NOT a verified install count. |
| App events (onboarding, tools, tx) | **GA4 for Firebase** `ga_events` | paginate; match across platforms (SA_/SI_/SW_ screens, EA_/EI_/EW_ actions). |
| SEO impressions/clicks/position | **Search Console** (`gsc_pages`, page dimension) | weighted CTR/position; page dim more complete than anonymized query dim. |
| Social link clicks | **Short.io** (`mrhbnetwork.short.gy`) | distinguish human vs bot/aggregate. |
| Play rating | **Play listing** (`play_ratings`) | avg + total only; per-star histogram is 0 (needs GCS bulk reports). |
| Revenue | **Not configured** | needs Firebase purchase/revenue events. |
| UX/friction | **Clarity** | API returns no data → sample. |
| Registered users / new signups | **Product backend DB (NOT connected — owner declined)** | GA4 proxies undercount; see §9. |

---

## 8. Firebase event taxonomy (from dev-team PDF, current schema)

Schema (post 25-May-2026 update): `EA_F_{identifier}` style. First letter **E**=event / **S**=screen; second letter **A**=Android / **I**=iOS / **W**=web / **E**=extension. Separator between params is a single `_` (older `__` / `SCREEN__ANDROID__…` variants may still appear in historical rows — match with `includes`, uppercased).

- **Screens:** `SA_/SI_/SW_ …` (e.g. `SA_APP_DASHBOARD`, `SA_GET_STARTED`, `SA_SETTINGS_NEW_PASSCODE`).
- **Actions:** `EA_/EI_/EW_ …`. Types: `_F_`=footer, `_P_`=popup, `_T_`=tile click (e.g. `EA_T_APPSCREEN_EMPLIFAI`).
- **Transactions:** `EA_SEND_…` / `EI_SEND_…` families (SENTx, SWAPxLIFI, SWAPxSKIP_GO, SAHAL_STAKEx, SAHAL_GIVEx, MRHB_STOREx, …). Dashes become `x`.
- **Onboarding:** entry = `*_ONBOARDING_LETS_GO` / `*_ONBOARDING_SOCIAL_SIGNUPx{svc}` / `*_ONBOARDING_IMPORT_WALLET`; **create-passcode** = `*_SETTINGS_NEW_PASSCODE` (only NEW users hit it — returning users enter an existing passcode → the cleanest new-user signal); complete = `*_ONBOARDING_GUIDE_COMPLETE`.
- `first_open` = install proxy (NOT a store-verified install).

---

## 9. App Performance deep-dive

- **KPI cards:** Total Installs (latest Play badge snapshot — **never summed**; falls back to `first_open` proxy), Active Users (de-dup GA4 app), Avg Rating (Play; App Store not connected), Onboarding Rate (onboarding-complete users ÷ first_open, approx), Transaction Rate (transacting users ÷ dashboard users).
- **Onboarding drop-off funnel** (cone, new-user-only): Started (`LETS_GO`|`SOCIAL_SIGNUP`|`IMPORT_WALLET`) → Passcode created (`SETTINGS_NEW_PASSCODE`) → Onboarding complete (`ONBOARDING_GUIDE_COMPLETE`). Shows % continue between bands + conversion chips. Counts are **summed-daily ceilings** (labelled). ~30d: 408 → 134 → 99 (33% → 74%, overall 24%).
- **Tool Usage tabs + Tile Clicks by Tool:** grouped by `tool_usage_config`; per-tool Active Users / Avg Daily Users / Events / platform split / range-aware trend; "All Tools" overview first.
- **New Users reconciliation (important):** dev backend reported 355 new users (30d); GA4 `first_open`=259, `SETTINGS_NEW_PASSCODE`=134 — **all undercount** the backend (consent/opt-out, sampling, web/extension signups, funnel drop-off). Authoritative "New Users" = backend DB, which the owner declined to connect. So we present GA4 as **drop-off ratios / proxy**, never as the authoritative signup count.

---

## 10. Pages — real vs mock (current)

| Page | Real | Sample / Not connected |
|---|---|---|
| Overview | Total Website Users, App Installs (proxy), Organic Clicks, Social Human Clicks, Wallet Active Users | Revenue (Not configured) |
| Traffic | all (GA4 website) | — |
| SEO | all (Search Console) | — |
| Blog | views (GA4), search impressions (GSC) | — |
| Social | all (Short.io) | — |
| User Journey | Impressions(web), Clicks, App Installs, Transaction | Revenue, social/app-store impressions (Not connected). Cross-source, not a cohort. |
| App Performance | installs/active/rating/rates, tools, onboarding funnel | full star histogram (0), App Store (Not connected) |
| UX & Friction | — | all (Clarity sample) |
| Revenue | — | all (not configured) |

---

## 11. Migrations

| File | Adds | Status |
|---|---|---|
| 001_initial_schema.sql | base tables | applied |
| 002 tracked_events (+funnel_stage) | funnel event config | applied |
| 003_tool_usage_config.sql | tool→event mapping (13 tools seeded) | **applied** |
| 004_app_metric_map.sql | App Performance metric blocks (6 seeded) | **applied** |

All config APIs are resilient to a missing table (fall back to code defaults), so the app never hard-fails if a migration is pending. **You cannot run DDL** — write the migration file and ask the user to run it in the Supabase SQL editor.

---

## 12. Deploy & validation workflow (how YOU ship)

You have no local full build and no DB/DDL/SSH (sandbox is HTTP/HTTPS only). Workflow:

1. Edit files under `/tmp/mrhb-build/repo/` (fetch any file you don't have via `github__get_file_contents`).
2. **Validate before every push** (a build failure leaves prod on the last-good build and both old/new return 307, so HTTP can't tell them apart):
   - **esbuild** for syntax/JSX: `/tmp/esb/node_modules/.bin/esbuild "<file>" --jsx=automatic --bundle=false --format=esm --loader:.tsx=tsx > /dev/null`
   - **tsc** (strict) on self-contained modules + a stubbed **TS2304 "Cannot find name"** scan for undefined identifiers.
   - **grep** for stale references after deleting/renaming symbols, and confirm every used import exists.
   - Watch for **unused locals** when you remove the last use of a var (remove the declaration too).
3. Compose params with a Node script that reads files from disk (avoid pasting big content); push via `github__push_files` — **the commit-message key is `message`** (not `commit_message`); multiple files per commit supported. Delete with `github__delete_file`.
4. After deploy (~60–90s), verify routes respond (307 = healthy auth redirect; 500 = runtime error). For data checks you can't see behind auth, use a **temporary read-only debug route**, read it, then **delete it** to keep prod clean.

---

## 13. HARD CONSTRAINTS — DON'T BREAK

1. **Vercel Hobby cron ≤ once/day.** `vercel.json` cron must stay `0 0 * * *`. A more frequent schedule makes Vercel **reject every deployment** (this once froze prod ~13h). If more frequent syncs are needed, use an external scheduler hitting `/api/refresh`, not the cron.
2. **Never sum de-duplicated GA4 users** across days (website or app). Use per-range de-dup totals (`daily_kpis`, `fetchGA4AppActiveUsersTotal`).
3. **`play_installs` stores the cumulative Play badge** (e.g. 100,000) snapshotted daily. Use the **latest snapshot only — never SUM** (summing produced millions once).
4. **Paginate** all `ga_events`/`gsc_pages` reads (1000-row cap).
5. **tsconfig target < ES2015, `downlevelIteration` OFF.** Do NOT use `for..of`/spread over `Map`/`Set` — use `Array.from(map.entries()/values()/keys())`. (Arrays are fine.)
6. **Server/client boundary** — see §5. New `iconName`s must be added to KPICard's ICON_MAP.
7. **Keep mock/sample states clearly labelled.** Never relabel Revenue/UX/Clarity/impressions as live.
8. **first_open is a proxy**, not verified installs. Transaction event counts are **not revenue**.
9. **You can't apply DDL** — ship a migration file + ask the user.
10. **Ask before** reporting-definition changes, source-of-truth edits, credential rotation, irreversible actions.

---

## 14. Bugs fixed / decisions (session log, Aug 2026)

- **Cron freeze (~13h):** `vercel.json` had been set to `0 */6 * * *` → exceeded Hobby limit → all deploys rejected. Reverted to `0 0 * * *`.
- **App Performance catastrophic overcount:** page summed `play_installs.installs` (cumulative badge) → millions. Fixed to latest snapshot. Active Users was `session_start` count (sessions, ~3663) not de-dup users (~1073) → switched to `fetchGA4AppActiveUsersTotal`. Onboarding/Transaction used wrong platform prefixes (EW_ vs EA_) reading ~0 → fixed. `ga_events` reads weren't paginated → fixed.
- **Build failure:** referenced `rangeLabel` before defining it → added `RANGE_LABELS`. Lesson → the esbuild+TS2304 pre-push validation in §12.
- **Real last-sync time:** replaced hardcoded "2 minutes ago" with `/api/last-sync` (reads `data_sync_log`).
- **Funnel rework:** 5-stage cross-source cone (Impressions→Clicks→App Installs→Transaction→Revenue), brand colours, honest cross-source labelling. (A "polished cone with connectors" variant was built then reverted on request; the same cone style was applied to the App Performance onboarding funnel and kept.)
- **KPI cards:** added absolute delta + "vs N previous period" (derived in-card); `formatNumber` switched to full comma-grouped numbers.
- **Tool usage:** 13 tools, tabbed with Avg Daily Users; "Feature Usage" regrouped from raw event names to **Tile Clicks by Tool** (fixed duplicate MIRO/EMPLIFAI + unreadable labels).
- **Config-driven metrics + How-it-works page** added; Admin editors wired to real config APIs; migrations 003/004 applied by owner.
- **Renames:** Overview "Total Users" → "Total Website Users".

---

## 15. Roadmap (post-handover)

High: connect Play GCS bulk reports (real installs + star histogram); App Store Connect; Firebase revenue events; decide New-Users source (owner declined backend — GA4 proxy stays labelled). Medium: social/app-store impressions APIs; CSV/PDF export; alerting. Low: Supabase Auth (replace cookie name auth); Next.js 15 upgrade; Recharts v3.

---

## 16. Brand

Blue `#01A6FA` (mrhb-blue), Dark `#29231D` (mrhb-dark), Cream `#FEF8EF` (mrhb-cream), Light-blue `#D0EFFF`, Warm-grey `#BFB4A6`, Warm-tan `#E5B897`. Font **Syne**. Keep the established visual language unless a change is explicitly requested.

---

## 17. Successor AI — recommended system prompt

> You are the long-term technical steward for the **MRHB Analytics Dashboard**, a management analytics product for **MRHB Network**, a Shariah-compliant fintech.
>
> **Mission:** trustworthy, decision-grade reporting. Treat each metric as a contract between an authoritative source, ingestion, Supabase storage, dashboard logic, and a manager's interpretation. Never conceal a data gap with a mock fallback, and never call a number real until its provenance is clear.
>
> **Project:** repo `hellovickysen/mrhb-analytics-dashboard`; prod `mrhb-analytics-dashboard-two.vercel.app`; Next.js 14 App Router + TypeScript + Tailwind + Supabase + Vercel (Hobby) + Recharts. Brand: MRHB (blue `#01A6FA` / tan / dark `#29231D`; Syne font) — keep the visual language unless a change is requested. **Always read HANDOVER.md before any material change.**
>
> **Architecture guardrails:** Dashboard pages are server components; interactive pieces are client components under `components/` — never pass functions/components across that boundary (icons pass as `iconName` strings via KPICard's curated map). Dashboard reads use the service-role client. Date ranges flow from URL search params through `getDateWindow`; every report/comparison/chart must use equivalent inclusive/exclusive semantics and explain prior-period baselines correctly. Mock fallbacks (Clarity UX, unconfigured revenue) are intentional — keep them clearly distinguishable from sourced analytics.
>
> **Data-integrity practice:** reproduce a suspected mismatch first (page, URL range, metric label, observed vs expected). Trace end-to-end — UI calc, DB query, table grain/conflict key, ingestion mapping, external-source semantics — checking timezone, dimension scopes, duplicate upserts, aggregation grain, partial-sync windows, first-open-vs-installs, bot filtering, and comparison windows before changing code. Reconcile against the designated source (GA4 website `GA4_PROPERTY_ID`; Sahal Wallet Firebase `GA4_APP_PROPERTY_ID=292950442`; Search Console `https://mrhb.network`; Short.io `mrhbnetwork.short.gy` human vs bot; Play `sahal.wallet.app`; App Store `1602366920` Russian storefront; Supabase source tables). Classify a discrepancy as defect / intentional mock / source limitation / definition mismatch, and state the blast radius before a production-impacting change. Make targeted, reversible fixes; prefer migrations; preserve history; never fabricate source values.
>
> **Hard constraints (do not break):** Vercel Hobby cron must stay ≤ once/day (`0 0 * * *`) or all deploys are rejected. Never sum de-duplicated GA4 users across days. `play_installs` is a cumulative badge — use the latest snapshot, never SUM. Paginate all `ga_events`/`gsc_pages` reads (1000-row cap). tsconfig has `downlevelIteration` OFF — use `Array.from(...)` over Map/Set, never `for..of`/spread. `first_open` is an install proxy, not verified installs; transaction counts are not revenue. Clarity/Revenue/social-impressions are intentionally sample/Not-connected.
>
> **Firebase events:** `E/S` + platform (`A`/`I`/`W`/`E`) prefix; `_T_` tiles, `_F_` footer, `_P_` popup; transactions in `EA_SEND_`/`EI_SEND_` families; `first_open` is an install proxy; `*_SETTINGS_NEW_PASSCODE` is the cleanest new-user signal (returning users never create a passcode). App Performance metrics/tools are config-driven (`app_metric_map`, `tool_usage_config`) and Admin-editable — renaming an event's pattern re-derives its cards.
>
> **You operate without a local build or DDL access** (sandbox is HTTP/HTTPS only): edit files, validate with esbuild + a TS2304 scan, deploy via the GitHub API (`github__push_files`, message key `message`), verify the deployed route, and ship SQL as migration files for the user to run. Use temporary read-only debug routes for behind-auth data checks and delete them after.
>
> **Operating style:** evidence-led, concise, transparent. Maintain the dashboard as an operational system, not a cosmetic layer. For every nontrivial change leave a short audit trail (observed / changed / why correct / still uncertain) via a descriptive commit or PR. **Ask before** actions that are irreversible, alter source-of-truth data, rotate credentials, or materially change reporting definitions.

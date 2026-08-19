# MRHB Analytics Dashboard — Complete Handover Guide

_Last updated: 2026-08-19. This is the canonical handover reference and supersedes any older handover HTML/PDF or SYSTEM_PROMPT snapshot. If another doc disagrees with this file, THIS file wins — say so rather than following the stale doc. Read it fully before any change._

## 0. TL;DR for the AI taking over

You are the long-term technical steward of a **decision-grade analytics dashboard** for MRHB Network (Shariah-compliant fintech). Prime directive: **trustworthy reporting** — never present sample/mock as live, always reconcile a metric to its authoritative source, make **small reversible fixes with an audit trail**, and **ask before** anything irreversible, source-of-truth-altering, credential-rotating, or definition-changing.

- **Repo:** `hellovickysen/mrhb-analytics-dashboard` · **Prod:** https://mrhb-analytics-dashboard-two.vercel.app · **Branch:** `main`
- **Stack:** Next.js 14 App Router · TypeScript · Tailwind · Supabase · Vercel (**Hobby**) · Recharts
- **Owner:** Varun. Auth is a single cookie-based name login (`middleware.ts` 307-redirects all pages to `/login` when unauthed — that 307 is the *healthy* signal).
- **You cannot run a local full build or apply DDL.** You edit files and deploy via the GitHub API; the owner runs SQL migrations in Supabase. See §12 and §13.
- **You CAN push code yourself.** (A previous session wrongly believed it needed a repo ZIP / a "writable checkout" and stalled — that was false. Edit files in the sandbox, validate, and push via `github__push_files`. See §14 mistake #0.)

---

## 1. Current status (Aug 2026)

**Live & real:** Overview, Traffic, SEO, Blog, Social — reconciled to authoritative sources. App Performance is real (GA4 for Firebase + Play listing) and, as of Aug 2026, its funnel + rate cards were reworked to **GA4 period-wide unique** counting (see §9). User Journey funnel is real but **cross-source** (not one cohort). Admin is fully wired.

**Intentionally NOT live (labelled sample / not-connected):** Revenue (needs Firebase purchase events), UX & Friction (Clarity returns no data), Funnel Impressions (no source), Registered Users / new signups (authoritative figure is the product **backend DB**, which the owner declined to connect — GA4 proxies undercount it, see §9).

**Outstanding owner-side tasks (their action, not code):** Play GCS bulk reports (real installs + star histogram); App Store Connect (iOS); Firebase purchase/revenue events; social/app-store impressions APIs; **dev-team Firebase SEND events for MIRO/eSIM/Coinformance** (see §15).

---

## 2. Prime directive & operating rules

1. **Provenance before display.** A number isn't "real" until source → ingestion → storage → dashboard calc are all understood. Reproduce a suspected mismatch first (page, URL range, metric label, observed vs expected), then trace end-to-end before changing code.
2. **Authoritative source per metric** (§7). State which source is authoritative when reconciling.
3. **Classify** every discrepancy: true defect / intentional mock / source limitation / definition mismatch — before "fixing".
4. **Mock fallbacks are intentional** for gaps; keep them labelled sample/Not-connected; never silently present as live.
5. **Targeted, reversible changes.** Prefer migrations; preserve history; never fabricate source values.
6. **Ask before** irreversible actions, source-of-truth edits, credential rotation, or reporting-definition changes. (Definition changes have been frequent here — always confirm, then report before/after numbers.)
7. **Audit trail** — a descriptive commit per business change: **observed / changed / why correct / still uncertain**.

---

## 3. Architecture & data flow

```
External sources ──(API clients)──> Ingestion orchestrator ──(service-role upsert)──> Supabase (Postgres)
                                                                                          │
                                              Dashboard pages (server components) reads ──┘
```

- **Sync:** daily Vercel cron `0 0 * * *` (midnight UTC) → `/api/cron`; or manual `POST /api/refresh {source, daysBack}` (Sidebar "Sync").
- **"Sync" vs "Refresh":** Sidebar **Sync** = real ingestion (`/api/refresh`). Header **Refresh** = `router.refresh()` (re-reads, no ingestion).
- **Reads:** dashboard pages read Supabase via `createServiceClient()` (service role, bypasses RLS). RLS on, no policies → only service role reads.
- **GA4-direct reads:** some App Performance figures now query GA4 **live** (not `ga_events`) via `lib/api-clients/ga4-app-funnel.ts` and `ga4-app-active-total.ts` — because de-duplicated unique-user counts cannot be recovered from the stored `ga_events` grain (see §9).

---

## 4. File structure (key/current)

```
app/(dashboard)/
  page.tsx                      Overview (server)
  traffic|seo|blog|social/page  authoritative, reconciled (server)
  funnel/page.tsx               User Journey cone (server, cross-source)
  app-performance/page.tsx      App (GA4 Firebase + Play), config-driven (server)  ← most active file
  ux/page.tsx  revenue/page.tsx Sample / Not connected
  how-it-works/page.tsx  admin/page.tsx (CLIENT)  layout.tsx (CLIENT)
app/api/
  cron refresh last-sync freshness admin/{...}      (service-role config GET/POST)
  NOTE: there is NO permanent /api/debug route — it was removed (unauthenticated data leak, §14).
        Temporary debug routes are created and DELETED per-use (§12.4).
components/
  layout/{Sidebar,Header}.tsx   CLIENT; Header owns range picker + mrhb_range cookie
  cards/KPICard.tsx             CLIENT; iconName curated ICON_MAP; %+delta+"vs prev period"
  charts/{Line,Area,Bar,Donut,Funnel}Chart.tsx   CLIENT
  app-performance/ToolUsageTabs.tsx   CLIENT; per-tool engagement tabs
  tables/DataTable.tsx
lib/
  api-clients/ google-auth, google-analytics, ga4-app-active-total,
               ga4-app-funnel.ts  ← funnel + rate-card + transactions helpers (GA4 period-wide unique)
               search-console, play-console, play-reviews, shortio, clarity, store-scraper
  ingestion/index.ts            getDateWindow(daysBack) — INGESTION-only, different fn from utils
  config/tool-usage.ts          DEFAULT_TOOL_MAPPINGS, computeToolTabs, toolForEventName
  config/app-metrics.ts         DEFAULT_APP_METRICS, matchesAppMetric, resolveAppMetrics
  supabase/server.ts            createServiceClient()
  utils/date-range.ts           getDateWindow(searchParams) → {startDate,endDate,prevStartDate,prevEndDate,days,range}
  utils/format.ts               formatNumber (FULL comma numbers), formatPercent, deltaFromPct
  utils/logo.ts                 logo as base64 data URI (do NOT use /logo.png)
supabase/migrations/            001_initial · 002_tracked_events · 003_tool_usage_config · 004_app_metric_map
middleware.ts                   cookie auth guard (all pages 307→/login when unauthed; /api is allowlisted)
vercel.json                     cron: 0 0 * * *  (§13 — never more frequent on Hobby)
```

### `lib/api-clients/ga4-app-funnel.ts` (added Aug 2026 — the heart of the current App Performance logic)
Server-only. All exports query the **Sahal Wallet GA4 app property** and return **period-wide unique users** (a single `runReport` with **no date dimension** + an `eventName` PARTIAL_REGEXP filter → GA4's own de-duplicated Total). Returns `null` on auth/API failure so callers fall back.
- `fetchGA4AppOnboardingFunnel(start,end)` → `{ signupStarted, passcodeCreated, onboardingComplete }` (Android/iOS).
- `fetchGA4AppRateInputs(start,end)` → `{ signupStarted, complete, dashboard, tx }` for the rate cards.
- `fetchGA4AppTransactionsByType(start,end)` → per-active-type unique transactors.
- `APP_TRANSACTION_TYPES` — the transaction taxonomy with `active` flags (§9). Flip a flag to switch a type on.

---

## 5. Critical patterns & rules

- **Server/Client boundary (top bug source):** dashboard pages are server components; interactive pieces are `'use client'` under `components/`. Never pass functions/components server→client. Icons pass as `iconName` string — **add the lucide icon to KPICard's curated ICON_MAP first**, or it silently falls back to `Users`.
- **GA4 period-wide unique (the current counting method):** GA4 `activeUsers` is **de-duplicated & non-additive**. To count "unique users who did X over a range", run one `runReport` with the metric + an `eventName` filter and **NO date dimension** — the single Total is the de-duped unique count and **matches a GA4 Explore "Total" row** (so managers can cross-check). NEVER add a date dimension and sum days (that's a daily-summed ceiling that overcounts), and NEVER sum `ga_events.users` across event-name rows (overcounts users who fire >1 matching event).
- **Date semantics:** `getDateWindow(searchParams)` (`lib/utils/date-range.ts`) → inclusive `startDate`/`endDate`, prev-period boundaries, `days`, `range`. GA4 end dates are **inclusive** — prev-period GA4 windows must end at `dayBefore(startDate)` to avoid overlapping the current period's first day (this was a real bug — see §14). The identically-named `getDateWindow(daysBack)` in `lib/ingestion/index.ts` is a DIFFERENT function.
- **Rolling vs fixed windows:** dashboard ranges are **rolling** (30d = last 30 days from now). To reconcile with a GA4 Explore custom range, use the SAME fixed dates — small differences are almost always window mismatch, not a bug.
- **Config-driven metrics (App Performance):** `app_metric_map` (mig 004) + `resolveAppMetrics`/`matchesAppMetric`; `tool_usage_config` (mig 003) + `computeToolTabs`/`toolForEventName` (first-match-wins by sortOrder). Both Admin-editable; editing a pattern re-derives dependent cards. **Note:** the reworked funnel/rate/transaction figures now come from `ga4-app-funnel.ts` (GA4-direct), not from `app_metric_map` — so changing `app_metric_map`'s `transaction` patterns no longer moves the Transaction Rate card; the transaction taxonomy lives in `APP_TRANSACTION_TYPES`.
- **KPI cards:** `value` (via `formatNumber`), `change` (%), `changeValue` (abs delta via `deltaFromPct`), `trend`. Card derives previous value in-card; no-baseline cards show no delta.
- **Numbers:** `formatNumber` = FULL comma-grouped everywhere; chart **axis ticks** keep their own compact formatter (intentional).
- **Pagination:** Supabase caps ~1000 rows/request. Any `ga_events`/`gsc_pages` scan MUST paginate with `.range(from, from+PAGE-1)`.

---

## 6. Environment variables (names only — never print values)

Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Google: `GA4_PROPERTY_ID` (website), `GA4_APP_PROPERTY_ID=292950442` (Sahal Wallet Firebase), `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (needs `\n` normalization), `GSC_SITE_URL=https://mrhb.network`.
Short.io: `SHORTIO_API_KEY`, `SHORTIO_DOMAIN=mrhbnetwork.short.gy`. Stores: `PLAY_PACKAGE_NAME=sahal.wallet.app`, `APP_STORE_ID=1602366920` (RU storefront). Clarity: `CLARITY_API_TOKEN`, `CLARITY_PROJECT_ID` (no data). Cron: `CRON_SECRET`.

---

## 7. Data sources — authoritative mapping

| Metric area | Authoritative source | Notes / gotchas |
|---|---|---|
| Website users/sessions/traffic | GA4 website (`GA4_PROPERTY_ID`) | de-dup, non-additive — never sum days; use `daily_kpis`. |
| App active users | GA4 for Firebase (`GA4_APP_PROPERTY_ID`) via `fetchGA4AppActiveUsersTotal` | period de-dup total, no date dimension. |
| App installs | Play Store (real, pending GCS) / GA4 `first_open` (proxy) | proxy undercounts store; not verified installs. |
| App events (onboarding/tools/tx) | GA4 for Firebase `ga_events` (stored) or GA4-direct | paginate stored reads; use GA4-direct for unique-user counts. |
| SEO clicks/impressions/position | Search Console `gsc_pages` (page dim) | weighted CTR/position. |
| Social link clicks | Short.io `mrhbnetwork.short.gy` | human vs bot. |
| Play rating | `play_ratings` listing | avg + total; per-star histogram 0 (needs GCS). |
| Revenue | **Not configured** | needs Firebase purchase events with a value param. |
| UX / friction | Clarity | API returns no data → sample. |
| **Registered users / new signups** | **Product backend DB — NOT connected (owner declined)** | GA4 proxies undercount; present as drop-off ratios only. The dev's own backend dashboard shows the authoritative figure (e.g. 327 new users/30d) which will always exceed GA4. |

---

## 8. Firebase event taxonomy (dev-team schema `firebase_events.md`)

Prefix: **E**=event / **S**=screen, then platform **A**=Android / **I**=iOS / **W**=web / **E**=extension. Types: `_F_` footer (`EA_{btnNum}_F_{screen}_{buttonText}`), `_P_` popup, `_T_` tile (`EA_T_{TilesType}_…`). Separator single `_` (post 25-May-2026); older `__` / `SCREEN__ANDROID__…` variants exist in historical rows (match uppercased `includes`).

- **Screens:** `SA_/SI_ …` (e.g. `SA_APP_DASHBOARD`, `SA_GET_STARTED`, `SA_SETTINGS_NEW_PASSCODE`).
- **Transactions (completions):** `E{A,I}_SEND_{TYPE}_{protocol}` per the dev doc (`EA_SEND_SWAP_${protocol}`). This SEND family is THE completion signal we count — see §9. Observed: `EA_SEND_SWAPxLIFI/xSKIP_GO/xCHANGE_NOW`, `EA_SEND_SAHAL_STAKEx`, `EA_SEND_MRHB_STOREx`, `EA_SEND_EMPLIFAIx`, `EA_SEND_SENTx` (plain send), `EA_SEND_SAHAL_GIVEx`. Dashes→`x`.
- **Onboarding:** entry `*_ONBOARDING_LETS_GO` / `*_ONBOARDING_SOCIAL_SIGNUPx{svc}` / `*_ONBOARDING_IMPORT_WALLET`; **create-passcode** `*_SETTINGS_NEW_PASSCODE` (only NEW users create one → cleanest new-user signal); complete `*_ONBOARDING_GUIDE_COMPLETE`.
- **IMPORTANT — doc vs reality:** the dev doc's flow diagrams write onboarding as `EW_ONBOARDING_…` (a shared **webview**), but **live GA4 for the reporting window emits native `EA_/EI_ONBOARDING_…`**. Do not trust an all-time `ga_events` dump (it shows legacy `EW_`); verify against GA4-direct for the actual window. The `^[ES][AI]_` gate correctly captures the native Android/iOS events and excludes web (`EW_`)/extension (`EE_`).
- **`first_open`** = Firebase-standard install proxy — **no platform prefix** (match by exact name `first_open`, not `^[ES][AI]_`). Not a store-verified install.

---

## 9. App Performance deep-dive (CURRENT definitions — reworked Aug 2026)

All the figures below are **GA4 period-wide unique users, Android/iOS only** (event-name prefix `^[ES][AI]_`), via `ga4-app-funnel.ts`, and reconcile 1:1 with a GA4 Explore "Total" (no Date dimension). Each has a ga_events fallback used only if GA4 is unavailable (flagged with an amber banner).

**KPI cards**
- **Total Installs** — latest `play_installs` snapshot (cumulative Play badge — NEVER summed); falls back to `first_open` proxy. Cross-check: Play Console.
- **Active Users** — `fetchGA4AppActiveUsersTotal` (period de-dup, no date sum). Prev-period window ends at `dayBefore(startDate)` (overlap bug fixed). e.g. 1,033 (Jul 14–Aug 13).
- **Avg Rating** — latest `play_ratings`. App Store not connected.
- **Onboarding Rate** — `Onboarding complete ÷ New user signup` (NOT ÷ first_open). = the funnel's overall finish rate. e.g. 76/204 ≈ **37%**.
- **Transaction Rate** — `Transacting users ÷ dashboard-reachers`, where **Transacting users** = de-dup union of ACTIVE transaction types (§ below). e.g. 31/445 ≈ **7%** (4 of 7 types live).

**Onboarding drop-off funnel** (new-user, Android/iOS, period-wide unique):
`New user signup` (`ONBOARDING_LETS_GO|SOCIAL_SIGNUP|IMPORT_WALLET`) → `Passcode created` (`SETTINGS_NEW_PASSCODE`) → `Onboarding complete` (`ONBOARDING_GUIDE_COMPLETE`). Jul 14–Aug 13: **204 → 121 → 76** (59% → 63%, overall 37%). This is **period-wide unique** (owner chose this over daily-summed so it matches GA4 Explore Totals). "Onboarding complete" fires on dashboard arrival = reached the dashboard as a new user.

**Transactions (the "transacting users" redefinition — see the plan doc & §15)**
- `APP_TRANSACTION_TYPES` in `ga4-app-funnel.ts` is the taxonomy. Each = `{key,label,token,active}`, matched as `^E[AI]_SEND_{token}` (completions only, Android/iOS).
- **ACTIVE (live):** Swap (`SWAP`), Sahal Stake (`SAHAL_STAKE`), MRHB Store (`MRHB_STORE`), Emplifai (`EMPLIFAI`) — these already emit SEND events.
- **INACTIVE (pending dev SEND events):** MIRO Stake/Topup/Vote (`MIRO_STAKE|MIRO_TOPUP|MIRO_VOTE`), eSIM (`ESIM`), Coinformance (`COINFORMANCE`). Flip `active:true` once the dev ships them — KPI union + breakdown update automatically.
- **Transaction Rate numerator** = de-dup union of active tokens `^E[AI]_SEND_(SWAP|SAHAL_STAKE|MRHB_STORE|EMPLIFAI)`. **"Transactions by Type"** section shows per-type unique transactors (union ≤ sum of tiles). Swap dominates (Jul 14–Aug 13: 29 users / 144 swap events across routes LI.FI, Skip:Go, ChangeNOW; note the event encodes the swap **route/aggregator**, not the blockchain).
- **Users vs events:** `Active users` = unique people; `Event count` = total transactions. Report both as "X transactions by Y users".

**New Users reconciliation (critical framing):** GA4 undercounts the backend. The dev's backend dashboard is the authoritative registered-user source (all platforms, no tracking-consent loss). GA4 figures here are **behavioral drop-off proxies** (Android/iOS, consented users, completed-event based) — present them as ratios, never as the authoritative signup/transaction count.

**GA4 cross-check recipes** (Explore → Free form, app property, metric `Active users`, dimension `Event name`, NO Date dim, matching date range → read Total):
- New user signup: `^[ES][AI]_.*(ONBOARDING_LETS_GO|ONBOARDING_SOCIAL_SIGNUP|ONBOARDING_IMPORT_WALLET)`
- Passcode created: `^[ES][AI]_.*SETTINGS_NEW_PASSCODE`
- Onboarding complete: `^[ES][AI]_.*ONBOARDING_GUIDE_COMPLETE`
- Transacting users (union): `^E[AI]_SEND_(SWAP|SAHAL_STAKE|MRHB_STORE|EMPLIFAI)`
- Per swap route: `^E[AI]_SEND_SWAP` (add `Event count` metric for total swaps).

---

## 10. Pages — real vs mock (current)

| Page | Real | Sample / Not connected |
|---|---|---|
| Overview | website users, installs (proxy), organic clicks, social human clicks, wallet active | Revenue |
| Traffic / SEO / Social | all | — |
| Blog | views (GA4) + search impressions (GSC) | — |
| User Journey | Impressions(web), Clicks, Installs, Transaction | Revenue, social/app-store impressions; cross-source, not a cohort |
| App Performance | installs/active/rating, onboarding funnel, onboarding & transaction rates, transactions-by-type, tools | full star histogram (0), App Store, MIRO/eSIM/Coinformance transactions (pending events) |
| UX & Friction / Revenue | — | all (sample / not configured) |

---

## 11. Migrations

| File | Adds | Status |
|---|---|---|
| 001_initial_schema.sql | base tables | applied |
| 002_tracked_events (+funnel_stage) | funnel event config | applied |
| 003_tool_usage_config.sql | tool→event mapping (13 tools) | applied |
| 004_app_metric_map.sql | App Performance metric blocks (6) | applied |

Config APIs fall back to code defaults if a table is missing (app never hard-fails). **You cannot run DDL** — ship the migration file and ask the owner to run it in the Supabase SQL editor.

---

## 12. Deploy & validation workflow (how YOU ship)

No local full build; no DB/DDL/SSH (sandbox is HTTP/HTTPS only). **You CAN edit + push directly — no ZIP/checkout needed.**

1. Edit files in the sandbox working copy (fetch anything you don't have via `github__get_file_contents`).
2. **Validate before every push** — a failed build leaves prod on the last-good build and BOTH old/new return 307, so HTTP alone can't tell them apart:
   - **esbuild** per file: `esbuild "<file>" --jsx=automatic --bundle=false --format=esm --loader:.tsx=tsx` (install via `npx esbuild` — needs `registry.npmjs.org` network access; request it if blocked).
   - **tsc strict** on self-contained modules (stub external imports) + a **TS2304 "Cannot find name"** scan. This catches the ES5 gotchas — e.g. **TS1252: a `function` declaration inside a block is illegal under ES5 strict** (use `const fn = () => …`), and implicit-any callback params.
   - **grep** for stale references after any delete/rename; confirm every import exists; remove newly-unused locals.
3. Compose params with a Node script that reads files from disk (don't paste big content); push via `github__push_files` — **commit-message key is `message`** (not `commit_message`); multiple files per commit OK; delete via `github__delete_file`. Binary files can't go through `push_files` (use `create_or_update_file` base64, or a data URI — why the logo is base64).
4. Verify ~60–90s after deploy: **307 = healthy auth redirect, 500 = runtime error.** Confirm the commit/deployment actually landed (the `push_files` result returns the new `main` SHA) — don't infer success from a 307 alone.
5. **Behind-auth data checks:** create a **temporary read-only debug route** under `app/api/debug/<name>/route.ts` (API routes bypass the auth guard), `export const runtime='nodejs'` + `dynamic='force-dynamic'`, read it, then **DELETE it**. Never leave a debug route in prod (see §14 — the old public `/api/debug` was an unauthenticated data leak). Validate debug routes with the same ES5 rules.
6. Never print secret values; env var names only.

---

## 13. HARD CONSTRAINTS — DON'T BREAK (each has already caused an incident)

1. **Vercel Hobby cron must stay `0 0 * * *`** in `vercel.json`. More frequent → Vercel **rejects every deployment** (froze prod ~13h once). Need more frequent syncs → external scheduler hitting `/api/refresh`, never the cron.
2. **Never SUM de-duplicated GA4 users** across days (website or app). Use per-range de-dup totals (`daily_kpis`, `fetchGA4AppActiveUsersTotal`, the period-wide-unique method in §5).
3. **`play_installs` = cumulative Play badge** snapshotted daily → use the **latest snapshot only, never SUM** (summing produced millions).
4. **Paginate** every `ga_events`/`gsc_pages` read (~1000-row cap).
5. **tsconfig target < ES2015, `downlevelIteration` OFF** → no `for..of`/spread over `Map`/`Set` (`Array.from(...)`), and **no `function` declarations inside blocks** (use arrow consts). Arrays are fine.
6. **Server/client boundary** (§5); new `iconName`s go in ICON_MAP first.
7. **Keep sample / "Not connected" states labelled.** Never relabel Revenue/UX/Clarity/impressions as live.
8. **`first_open` is an install proxy**, not verified installs. **Transaction event counts are not revenue.**
9. **You cannot apply DDL** — ship a migration file; ask the owner.
10. **Ask before** irreversible actions, source-of-truth edits, credential rotation, or reporting-definition changes. Report **before/after** numbers on any definition change.

---

## 14. Bugs & mistakes log (read this — it's how you avoid repeating them)

**#0 — False "can't push" blocker (process mistake).** A prior session insisted it needed a repo ZIP / writable Git checkout and stalled for many turns without shipping the (already-approved) fix. **Wrong.** The GitHub integration's `push_files` is sufficient: edit in the sandbox, validate, push. Don't ask the owner to package the repo.

**Aug 2026 App Performance rework (all shipped):**
- **Onboarding funnel double-count:** "Started signup" summed per-event `ga_events.users` across paths/days → a user doing Let's Go + Import Wallet counted twice (e.g. 330 vs true ~204). Root cause: `ga_events` has no user id, so the union can't be recovered from it. Fix: query GA4 directly, period-wide unique, Android/iOS (`fetchGA4AppOnboardingFunnel`). Verified Jul 25 = 23 matched the owner's GA4 Explore exactly.
- **Daily-summed vs period-wide:** first shipped daily-summed (~208–213) then switched to **period-wide unique (204)** per owner, so it ties to a GA4 Explore Total. Lesson: confirm which de-dup window management cross-checks against.
- **Stale `ga_events` vs live GA4:** an all-time `ga_events` dump showed only legacy `EW_ONBOARDING_…`, suggesting the Android/iOS filter matched nothing. GA4-direct for the window showed native `EA_/EI_ONBOARDING_…`. Lesson: verify against GA4-direct for the actual window, not an all-time stored dump.
- **Active Users prev-period overlap:** prev GA4 window ended inclusively at `startDate`, overlapping the current period's first day. Fixed to `dayBefore(startDate)`.
- **Onboarding Rate denominator:** was `÷ first_open` (installs); changed to `÷ New user signup` so it equals the funnel's overall finish (≈37%).
- **Transaction Rate inflation:** old pattern `(_SEND_|SWAP|SAHAL_RAMP)` also matched **ramp screen visits** + send-money + every `SEND_` → 76% (txUsers 1179 vs true 140). Redefined to completed SEND transactions in named tools → ~7% on the 4 live types (rises as MIRO/eSIM/Coinformance come online). Lesson: match completion events, not screens/taps; de-dup period-wide.
- **Security: removed public `/api/debug`** — an unauthenticated route that dumped the entire event catalog (API routes bypass the auth guard). Deleted. Only use temporary, deleted-after debug routes.
- **ES5 TS1252 caught pre-push:** a nested `async function` inside the GET handler of a debug route was illegal under ES5 strict — the validation caught it before it could fail the build. Use arrow consts.

**Earlier (Aug 5 and before):** cron freeze (`0 */6 * * *` exceeded Hobby → all deploys rejected → reverted); `play_installs` summed → millions (→ latest snapshot); Active Users used `session_start` sessions not de-dup users (→ `fetchGA4AppActiveUsersTotal`); un-paginated `ga_events` truncated; `rangeLabel` referenced before definition broke a build (→ the esbuild+TS2304 pre-push validation); hardcoded "2 minutes ago" → `/api/last-sync`; Feature Usage regrouped into "Tile Clicks by Tool".

---

## 15. Roadmap / pending items (post-handover)

**Blocked on the dev team (Firebase events) — spec already sent (see the "Transacting Users KPI" plan doc):**
- Add `E{A,I}_SEND_{TYPE}_{protocol}` completion events for **MIRO** (`MIRO_STAKE`/`MIRO_TOPUP`/`MIRO_VOTE`), **eSIM** (`ESIM`), **Coinformance** (`COINFORMANCE`) — currently no SEND events (Coinformance has no events at all). Fire once, **on success (not on tap)**, Android + iOS.
- **Confirm** the 4 live SEND events (Swap/Sahal Stake/MRHB Store/Emplifai) fire on **success**, not on button tap. (Open question with dev as of handover: "when is a swap counted as successful?" — our answer: whenever `EA_SEND_SWAP_{protocol}` fires; we asked them to align that to on-chain/provider success.)
- Optional: include the **blockchain/chain** in swap events (`E{A,I}_SEND_SWAP_{route}_{chain}`) for per-chain breakdown (currently only per-route: LI.FI, Skip:Go, ChangeNOW).
- When delivered: flip `active:true` in `APP_TRANSACTION_TYPES`, deploy, verify via temp GA4 route, report numbers.

**Blocked on owner-side access:** Play GCS bulk reports (real net installs + star histogram); App Store Connect (iOS); Firebase purchase/revenue events (Revenue page); social/app-store impressions APIs; decision on connecting the backend DB for authoritative registered users.

**Nice-to-have:** custom fixed-date range picker (so tiles tie exactly to a GA4 custom range with no rolling-window offset); per-type interactive transaction tabs with daily trend; CSV/PDF export; alerting; Supabase Auth (replace cookie name login); Next.js 15 / Recharts v3 upgrades.

---

## 16. Brand

Blue `#01A6FA` (mrhb-blue), Dark `#29231D` (mrhb-dark), Cream `#FEF8EF` (mrhb-cream), Light-blue `#D0EFFF`, Warm-grey `#BFB4A6`, Warm-tan `#E5B897`. Font **Syne**. Keep the visual language unless a change is explicitly requested.

---

## 17. Knowledge & skills (what's stored outside this repo)

- **Agent memories** capture the hard constraints (§13), the ship-workflow (§12), and the false-blocker lesson (§14 #0). Keep them in sync with this file — this file wins on any conflict.
- **The "Transacting Users KPI — Redefinition Plan" doc** holds the full transaction taxonomy, the exact dev event spec, and decisions (D1–D7). Read it before touching transactions.
- No custom API skills are required for this project — all data access is via the Google/Supabase/Short.io API clients already in `lib/api-clients/` with env-var credentials. Use temporary debug routes (§12.5) for live GA4 checks.

---

## 18. Successor AI — recommended system prompt

See `SYSTEM_PROMPT.md` (kept in sync with this file). In short: you are the MRHB Analytics Dashboard steward; mission is trustworthy decision-grade reporting; always read HANDOVER.md first; respect the §13 hard constraints; count unique users the GA4 period-wide way (§5); ship via the validated GitHub-push workflow (§12); and **ask before** definition changes, reporting before/after numbers.

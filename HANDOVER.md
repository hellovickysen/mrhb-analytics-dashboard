# MRHB Analytics Dashboard — Complete Handover Guide

## For AI Agents / Developers Taking Over This Project

This document contains everything needed to understand, maintain, and extend the MRHB Analytics Dashboard. Read it fully before making any changes.

---

## 1. Project Overview

**What:** A unified management dashboard for MRHB Network (Shariah-compliant fintech) that tracks website traffic, app installs, user journeys, SEO, social campaigns, and in-app transactions in one place — like a custom Mixpanel.

**Who:** Built for the MRHB management team. Currently one authorized user: "varun" (cookie-based name auth).

**Where:**
- **Repo:** https://github.com/hellovickysen/mrhb-analytics-dashboard
- **Live URL:** https://mrhb-analytics-dashboard-two.vercel.app
- **Supabase:** Project `mrhb-analytics` (19 PostgreSQL tables)

**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase + Vercel + Recharts

**Size:** 44 source files, ~10,500 lines of TypeScript/TSX, 695-line SQL migration

---

## 2. Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              Vercel (Hosting)            │
                    │                                         │
                    │  ┌─────────────────────────────────┐    │
                    │  │     Next.js 14 App Router        │    │
                    │  │                                   │    │
                    │  │  9 Dashboard Pages (Server Comps) │    │
                    │  │  + Login Page (Client Comp)       │    │
                    │  │  + Admin Page (Client Comp)       │    │
                    │  │                                   │    │
                    │  │  /api/cron   (daily midnight UTC) │    │
                    │  │  /api/refresh (manual sync POST)  │    │
                    │  │  /api/debug  (event inspection)   │    │
                    │  └──────────────┬────────────────────┘    │
                    │                 │ reads/writes            │
                    └─────────────────┼────────────────────────┘
                                      │
                    ┌─────────────────▼────────────────────────┐
                    │           Supabase (PostgreSQL)           │
                    │                                           │
                    │  19 tables: ga_traffic, ga_events,        │
                    │  ga_pages, ga_geo, gsc_queries,           │
                    │  gsc_pages, play_installs, play_ratings,  │
                    │  play_store_listing, shortio_links,       │
                    │  shortio_clicks, clarity_sessions,        │
                    │  clarity_friction, funnel_stages,          │
                    │  transactions, revenue, daily_kpis,       │
                    │  tracked_events, data_sync_log            │
                    └──────────────────────────────────────────┘
                                      ▲
                    ┌─────────────────┘ (API clients fetch & upsert)
                    │
        ┌───────────┼───────────┬───────────┬──────────┬──────────┐
        │           │           │           │          │          │
   GA4 Website  GA4 App    Search     Short.io    Play Store  App Store
   (mrhb.net)  (Firebase/  Console               Scraper     Lookup
               Sahal       (GSC)     (Stats API)  (HTML)      (iTunes)
               Wallet)
```

### Data Flow
1. **Sync triggers:** Daily cron at midnight UTC OR manual POST to `/api/refresh`
2. **API clients** (`lib/api-clients/`) fetch from external sources
3. **Ingestion orchestrator** (`lib/ingestion/index.ts`) upserts data into Supabase
4. **Dashboard pages** (`app/(dashboard)/`) read from Supabase on every page load
5. **Mock fallback:** Every page falls back to hardcoded mock data if Supabase returns empty

---

## 3. File Structure

```
mrhb-analytics/
├── app/
│   ├── layout.tsx                    # Root layout, metadata, favicon
│   ├── globals.css                   # Tailwind + Syne font
│   ├── login/page.tsx                # Login page ('use client')
│   ├── (dashboard)/
│   │   ├── layout.tsx                # Sidebar + mobile hamburger ('use client')
│   │   ├── page.tsx                  # Overview (Server Component)
│   │   ├── traffic/page.tsx          # Traffic & Acquisition
│   │   ├── funnel/page.tsx           # User Journey & Funnel
│   │   ├── ux/page.tsx               # UX & Friction (Clarity)
│   │   ├── social/page.tsx           # Social & Campaigns (Short.io)
│   │   ├── app-performance/page.tsx  # App Performance (Firebase)
│   │   ├── seo/page.tsx              # SEO (Search Console)
│   │   ├── blog/page.tsx             # Blog Analytics
│   │   ├── revenue/page.tsx          # Revenue & Transactions
│   │   └── admin/page.tsx            # Admin Panel ('use client')
│   └── api/
│       ├── cron/route.ts             # Daily sync (Vercel cron)
│       ├── refresh/route.ts          # Manual sync POST endpoint
│       └── debug/route.ts            # Event inspection endpoint
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx               # Navigation + user profile + sync
│   │   └── Header.tsx                # Title + date range picker (5 options)
│   ├── cards/
│   │   ├── KPICard.tsx               # KPI card with tooltip + trend
│   │   └── StatCard.tsx              # Simple stat display
│   ├── charts/
│   │   ├── LineChart.tsx             # Recharts line chart
│   │   ├── AreaChart.tsx             # Recharts area chart (dual series)
│   │   ├── BarChart.tsx              # Recharts bar chart
│   │   ├── DonutChart.tsx            # Recharts donut/pie chart
│   │   └── FunnelChart.tsx           # Custom CSS funnel (not Recharts)
│   ├── tables/
│   │   └── DataTable.tsx             # Sortable data table
│   └── ui/
│       └── Tabs.tsx                  # Tab switcher
├── lib/
│   ├── api-clients/
│   │   ├── google-auth.ts            # Shared JWT auth for Google APIs
│   │   ├── google-analytics.ts       # GA4 Data API v1 (website + app)
│   │   ├── search-console.ts         # Search Console API
│   │   ├── play-console.ts           # Play Developer API (optional)
│   │   ├── shortio.ts                # Short.io REST + Stats API
│   │   ├── clarity.ts                # Microsoft Clarity (limited)
│   │   └── store-scraper.ts          # Play Store + App Store scraper
│   ├── ingestion/
│   │   ├── index.ts                  # Orchestrator (runs all sources)
│   │   └── supabase-admin.ts         # Service-role upsert helper
│   ├── supabase/
│   │   ├── client.ts                 # Browser Supabase client
│   │   └── server.ts                 # Server client + service client
│   ├── types/
│   │   └── index.ts                  # All TypeScript types
│   └── utils/
│       ├── format.ts                 # Number/date/percent formatters
│       ├── date-range.ts             # Date window calculator
│       └── logo.ts                   # MRHB logo as base64 data URI
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql    # 19 tables, 695 lines
├── middleware.ts                      # Auth guard (cookie check)
├── next.config.js                    # missingSuspenseWithCSRBailout: false
├── tailwind.config.ts                # MRHB brand colors
├── vercel.json                       # Daily cron schedule
└── .env.example                      # All env var names
```

---

## 4. Critical Patterns & Rules

### Server/Client Component Boundary (MOST COMMON BUG SOURCE)
- Dashboard pages are **Server Components** (NO `'use client'`)
- Components in `components/` are **Client Components** (`'use client'`)
- **NEVER pass functions or React components as props** from server to client
- Icons use the `iconName` string pattern — KPICard resolves icons internally via ICON_MAP
- The `experimental.missingSuspenseWithCSRBailout: false` in next.config.js is required because Header uses `useSearchParams()`

### Date Range
- Header buttons update URL search params (`?range=today|yesterday|7d|30d|90d`)
- Pages read `searchParams.range` and pass to `getDateWindow()` from `lib/utils/date-range.ts`
- All Supabase queries use `.gte('date', startDate)` from the date window
- Previous period comparison: same length window before startDate

### Supabase Access
- Dashboard pages use `createServiceClient()` (service role key, bypasses RLS)
- RLS is enabled on all tables with no policies — only service role can read/write
- Ingestion uses `lib/ingestion/supabase-admin.ts` (also service role)
- All upserts use `onConflict` with table-specific conflict columns

### Mock Data Fallback
- Every page has a `MOCK_*` constant with realistic placeholder data
- If Supabase returns empty/error, mock data renders seamlessly
- This ensures the UI always works even before data is synced

---

## 5. Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Google (shared service account for GA4 + GSC)
GA4_PROPERTY_ID=xxx                    # mrhb.network website
GA4_APP_PROPERTY_ID=292950442          # Sahal Wallet Firebase app
GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx@xxx.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN..."
GSC_SITE_URL=https://mrhb.network

# Short.io
SHORTIO_API_KEY=sk_xNwQjcMRHC4EX97u   # SECRET key (not public)
SHORTIO_DOMAIN=mrhbnetwork.short.gy

# App Store tracking (no API key needed)
PLAY_PACKAGE_NAME=sahal.wallet.app
APP_STORE_ID=1602366920

# Microsoft Clarity (limited, mostly returns 0)
CLARITY_API_TOKEN=xxx
CLARITY_PROJECT_ID=xxx

# Cron auth
CRON_SECRET=xxx
```

---

## 6. Firebase Event Schema (CRITICAL KNOWLEDGE)

### Naming Convention
```
Prefix: {action_letter}{platform_letter}_{identifier}
Action: E=event, S=screen view
Platform: A=Android, I=iOS, W=web, E=extension

Examples:
  EA_SEND_SENTx        = Android send transaction
  EI_SEND_SWAPxLIFI    = iOS swap via LiFi
  SA_APP_DASHBOARD     = Android screen: app dashboard
  SI_GET_STARTED       = iOS screen: get started
  EW_ONBOARDING_*      = Web/cross-platform onboarding events
```

### CTA Click Events
```
Footer: EA_{ButtonNum}_F_{ScreenPrefix}_{Heading}_{ButtonText}
Popup:  EA_{ButtonNum}_P_{ScreenPrefix}_{Heading}_{ButtonText}
Tiles:  EA_T_{TilesType}_{Heading}_{ButtonText}
  TilesType: AppScreen | PersonalizeWallet | MIROStaking | MRHBStore
```

### Transaction Events (confirmed by dev team)
```
Send:        EA_SEND_SENTx / EI_SEND_SENTx
Swap LiFi:   EA_SEND_SWAPxLIFI / EI_SEND_SWAPxLIFI
Swap SkipGo: EA_SEND_SWAPxSKIP_GO / EI_SEND_SWAPxSKIP_GO
Swap ChgNow: EA_SEND_SWAPxCHANGE_NOW / EI_SEND_SWAPxCHANGE_NOW
Stake:       EA_SEND_SAHAL_STAKEx / EI_SEND_SAHAL_STAKEx
Give:        EA_SEND_SAHAL_GIVEx / EI_SEND_SAHAL_GIVEx
Store:       EA_SEND_MRHB_STOREx / EI_SEND_MRHB_STOREx
Screener:    EA_SEND_HALAL_SCREENERx
Emplifai:    EA_SEND_EMPLIFAIx / EI_SEND_EMPLIFAIx

Note: Dashes become 'x' in event names. Total 90d: 526 transactions.
```

### Onboarding Events
```
EW_ONBOARDING_LETS_GO          (47)  — tapped "Let's Go"
EW_ONBOARDING_GUIDE_SKIP       (26)  — skipped guide
EW_ONBOARDING_GUIDE_START      (12)  — tapped "Learn More"
EW_ONBOARDING_GUIDE_COMPLETE   (55)  — finished full onboarding
EW_ONBOARDING_SOCIAL_SIGNUPx*  (3)   — social signup (Google/Twitter/Apple)
EW_ONBOARDING_IMPORT_WALLET    (1)   — imported wallet
```

### Referral Events
```
EA_REF_SHARED_{code}  — user shared their referral code
EA_REF_BY_{code}      — user was referred by someone
```

### Key System Events
```
first_open:    1,113  — Firebase auto-event, first app launch after install
session_start: 13,155 — all sessions
first_visit:   1,334  — first website visit
app_remove:    969    — app uninstalls
app_update:    665    — app updates
```

---

## 7. Funnel Stage Mapping

| Stage | Data Source | Query |
|-------|-----------|-------|
| 1. Social Discovery | shortio_clicks | WHERE link_id='domain_total', SUM total_clicks |
| 2. Website Visit | ga_traffic | WHERE channel IN ('Social','Referral','Organic Social'), SUM sessions |
| 3. App Install | ga_events | WHERE event_name='first_open', SUM event_count |
| 4. Onboarding Started | ga_events | WHERE event_name LIKE 'EW_ONBOARDING_LETS_GO%' OR 'EW_ONBOARDING_SOCIAL_SIGNUP%' OR 'EW_ONBOARDING_IMPORT_%' OR 'EW_ONBOARDING_GUIDE_SKIP%' |
| 5. Wallet Created | ga_events | WHERE event_name='SA_APP_DASHBOARD', SUM event_count |
| 6. Onboarding Complete | ga_events | WHERE event_name='EW_ONBOARDING_GUIDE_COMPLETE' |
| 7. Transactions | ga_events | WHERE event_name LIKE 'EA_SEND_%' OR 'EI_SEND_%' OR 'EW_SEND_%' |
| 8. Retained (7d) | ga_events | WHERE event_name='session_start' AND date >= 7 days ago |

**Important:** The funnel uses `capToFunnelShape()` to ensure monotonic decreasing values. Later stages are capped to the previous stage's value.

---

## 8. Data Sources Status

| Source | Rows (90d) | Status | Notes |
|--------|-----------|--------|-------|
| GA4 Website (mrhb.network) | 217 traffic + 248 events + 1,034 geo | REAL | Full website analytics |
| GA4 App (Sahal Wallet Firebase) | 23,812 events | REAL | In-app events, transactions, screen views |
| Google Search Console | 2,219 queries + 2,551 pages | REAL | SEO rankings and clicks |
| Short.io | 1 link + 145 clicks | REAL | Social campaign tracking, human vs bot |
| Play Store scraper | 1 install + 1 rating | REAL | 100K+ installs, 4.3 rating, no API key needed |
| App Store lookup | Fetched on demand | REAL | 4.58 rating, 19 ratings, iTunes API |
| Play Console | 1 install + 1 rating | REAL | Dev team granted view-only access |
| Microsoft Clarity | 0 rows | MOCK | API limited, falls back to mock data |

**Total: ~30,228 rows in Supabase**

---

## 9. Pages — Real vs Mock Data

| Page | Real Data Sources | Mock Sections |
|------|------------------|---------------|
| Overview | GA4 traffic/geo, GSC clicks, Short.io human clicks, Firebase first_open | Scroll depth (Clarity), Revenue |
| Traffic | GA4 traffic + geo | None — fully real |
| SEO | GSC queries + pages | None — fully real |
| Blog | GA4 pages filtered to /blogs/, GSC blog queries | Traffic by source (approximated) |
| Funnel | Short.io, GA4 traffic, Firebase events (all 8 stages) | None — fully real |
| UX & Friction | None | All mock (Clarity 0 rows) |
| Social | Short.io clicks, referrers, countries, OS | None — fully real |
| App Performance | Firebase events, store scraper | Crash rate, reviews (mock) |
| Revenue | None | All mock (no revenue events configured) |
| Admin | Static config UI | N/A |

---

## 10. MRHB Brand

```
Colors:
  Blue (primary):  #01A6FA  → Tailwind: mrhb-blue
  Dark (text):     #29231D  → Tailwind: mrhb-dark
  Cream (bg):      #FEF8EF  → Tailwind: mrhb-cream
  Light Blue:      #D0EFFF  → Tailwind: mrhb-blue-light
  Warm Grey:       #BFB4A6  → Tailwind: mrhb-warm-grey
  Warm Tan:        #E5B897  → Tailwind: mrhb-warm-tan
  White:           #FFFFFF  → Tailwind: mrhb-white

Font: Syne (Google Fonts) — SemiBold for headings, Regular for body
Logo: Embedded as base64 data URI in lib/utils/logo.ts (gold octagonal badge)
```

---

## 11. Known Issues & Tech Debt

1. **Clarity API returns 0 data** — the export API is limited. UX page is fully mock.
2. **Revenue page is mock** — needs Firebase purchase events with `value` param configured in the app.
3. **ga_pages table has 0 rows** — GA4 website property may not report pagePath/pageTitle dimensions.
4. **Short.io FK constraint was manually dropped** — `ALTER TABLE shortio_clicks DROP CONSTRAINT shortio_clicks_link_id_fkey` was run to allow aggregate click rows.
5. **PLAY_PACKAGE_NAME** — was `com.mrhb.sahalwallet` (404s), corrected to `sahal.wallet.app`.
6. **App Store lookup requires country=ru** — the app is listed in the Russian store, other country codes return 0 results.
7. **Logo embedded as data URI** — GitHub API couldn't upload binary PNG correctly, so logo is base64-encoded in `lib/utils/logo.ts`.
8. **Date picker 100% change issue** — when data only exists for the current period (not the previous comparison period), change % shows 100%.

---

## 12. How to Sync Data

### Manual sync (all sources):
```powershell
Invoke-RestMethod -Uri "https://mrhb-analytics-dashboard-two.vercel.app/api/refresh" -Method POST -ContentType "application/json" -Body '{"source": "all", "daysBack": 90}'
```

### Sync specific source:
```powershell
# Options: ga4, gsc, play, shortio, clarity
Invoke-RestMethod -Uri "https://mrhb-analytics-dashboard-two.vercel.app/api/refresh" -Method POST -ContentType "application/json" -Body '{"source": "ga4", "daysBack": 30}'
```

### Debug event names:
```
GET https://mrhb-analytics-dashboard-two.vercel.app/api/debug
```

### Auto sync:
Vercel cron runs daily at midnight UTC (configured in vercel.json).

---

## 13. Remaining Roadmap

### High Priority
- [ ] Wire Revenue page to Firebase transaction events (EA_SEND_* with event_value)
- [ ] Add dark mode toggle
- [ ] Upgrade Next.js to 15+ (current 14.2.21 has security advisory)
- [ ] Upgrade Recharts to v3 (v2 is deprecated)

### Medium Priority
- [ ] Add X/Twitter analytics page (if API access obtained)
- [ ] Implement Clarity CSV upload as alternative to limited API
- [ ] Add email/Slack alerts for metric threshold breaches
- [ ] Add export to CSV/PDF for each dashboard page
- [ ] Wire Admin page event config to actually save to tracked_events table

### Low Priority
- [ ] Replace name-based auth with Supabase Auth (email + password)
- [ ] Add team member management (multiple users)
- [ ] Add custom date range picker (calendar UI)
- [ ] Optimize Supabase queries with materialized views for heavy aggregations
- [ ] Add loading skeletons for page transitions

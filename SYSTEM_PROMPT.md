# System Prompt — MRHB Analytics Dashboard

You are an AI developer working on the MRHB Analytics Dashboard. Before doing anything, read HANDOVER.md in the repo root for full project context.

## Project Identity
- **Repo:** github.com/hellovickysen/mrhb-analytics-dashboard
- **Live:** mrhb-analytics-dashboard-two.vercel.app
- **Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase + Vercel + Recharts
- **Brand:** MRHB Network — Shariah-compliant fintech. Colors: Blue #01A6FA, Dark #29231D, Cream #FEF8EF. Font: Syne.

## Critical Rules
1. Dashboard pages are SERVER COMPONENTS — never add 'use client'. Components in components/ are client components.
2. Never pass functions or React components as props from server to client. Use iconName strings (resolved via ICON_MAP in KPICard).
3. next.config.js has `experimental.missingSuspenseWithCSRBailout: false` — required for useSearchParams in Header.
4. All Supabase reads use `createServiceClient()` (service role key, bypasses RLS). Never use `createClient()` for dashboard data.
5. Every page has mock data fallback — if Supabase returns empty, mock renders seamlessly.
6. Date range comes from URL search params (?range=today|yesterday|7d|30d|90d), parsed by `getDateWindow()` from lib/utils/date-range.ts.
7. Logo is embedded as base64 data URI in lib/utils/logo.ts — don't use /logo.png static file (broken).
8. Binary files cannot be pushed via GitHub push_files API — use create_or_update_file with base64 encoding, or embed as data URIs.

## Data Sources
- GA4 Website (mrhb.network): env GA4_PROPERTY_ID
- GA4 App (Sahal Wallet Firebase): env GA4_APP_PROPERTY_ID=292950442
- Google Search Console: env GSC_SITE_URL=https://mrhb.network
- Short.io: domain mrhbnetwork.short.gy, domainId 1547438, stats API at statistics.short.io (not api.short.io)
- Play Store scraper: package sahal.wallet.app (not com.mrhb.sahalwallet)
- App Store lookup: ID 1602366920, country=ru required
- Clarity: API limited, returns 0 data. UX page is mock.

## Firebase Events (MUST KNOW)
Prefix: E=event S=screen, A=Android I=iOS W=web. Transaction events: EA_SEND_SENTx, EA_SEND_SWAPxLIFI, EA_SEND_SAHAL_STAKEx, EA_SEND_MRHB_STOREx (dashes become x). Onboarding: EW_ONBOARDING_LETS_GO, EW_ONBOARDING_GUIDE_COMPLETE. Install proxy: first_open. Tiles: EA_T_AppScreen_{feature}. Referrals: EA_REF_SHARED_{code}, EA_REF_BY_{code}.

## Sync
- Auto: Vercel cron daily midnight UTC
- Manual: POST /api/refresh with body {"source": "all"|"ga4"|"gsc"|"play"|"shortio"|"clarity", "daysBack": 30}
- Debug events: GET /api/debug

## What's Real vs Mock
REAL: Overview (partial), Traffic (full), SEO (full), Blog (partial), Funnel (full), Social (full), App Performance (partial). MOCK: UX/Friction (Clarity), Revenue (no events configured), Scroll depth, Crash rate.

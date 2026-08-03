import { createServiceClient } from '@/lib/supabase/server'
import { DEFAULT_APP_METRICS, resolveAppMetrics, type AppMetricDef } from '@/lib/config/app-metrics'
import { DEFAULT_TOOL_MAPPINGS, type ToolMapping } from '@/lib/config/tool-usage'
import { Database, Smartphone, Info } from 'lucide-react'

// Server component: a plain-English reference for how every dashboard card is
// calculated. App Performance blocks + tool mappings are pulled LIVE from
// config so this page always matches what the dashboard actually computes.

export const dynamic = 'force-dynamic'

interface DocRow {
  card: string
  calc: string
}

async function loadConfig(): Promise<{ metrics: AppMetricDef[]; tools: ToolMapping[] }> {
  const fallback = {
    metrics: Array.from(resolveAppMetrics(null).values()).sort((a, b) => a.sortOrder - b.sortOrder),
    tools: DEFAULT_TOOL_MAPPINGS,
  }
  try {
    const supabase = createServiceClient()
    const [m, t] = await Promise.all([
      supabase.from('app_metric_map').select('key, label, patterns, match_type, description, used_by, sort_order, is_active').order('sort_order', { ascending: true }),
      supabase.from('tool_usage_config').select('tool, patterns, sort_order, is_active').order('sort_order', { ascending: true }),
    ])
    const metrics = !m.error && (m.data?.length ?? 0) > 0
      ? Array.from(resolveAppMetrics(m.data as any).values()).sort((a, b) => a.sortOrder - b.sortOrder)
      : fallback.metrics
    const tools = !t.error && (t.data?.length ?? 0) > 0
      ? (t.data as any[]).map((r) => ({
          tool: String(r.tool),
          patterns: String(r.patterns ?? '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean),
          sortOrder: Number(r.sort_order) || 0,
          isActive: r.is_active !== false,
        }))
      : fallback.tools
    return { metrics, tools }
  } catch {
    return fallback
  }
}

function DocSection({ title, subtitle, rows }: { title: string; subtitle?: string; rows: DocRow[] }) {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl bg-mrhb-white shadow-sm ring-1 ring-mrhb-warm-grey/10">
      <div className="border-b border-mrhb-warm-grey/10 px-5 py-4">
        <h2 className="text-base font-semibold text-mrhb-dark">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-mrhb-dark/50">{subtitle}</p>}
      </div>
      <ul className="divide-y divide-mrhb-warm-grey/10">
        {rows.map((r) => (
          <li key={r.card} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:gap-4">
            <span className="w-full flex-shrink-0 text-sm font-semibold text-mrhb-dark sm:w-52">{r.card}</span>
            <span className="text-sm leading-relaxed text-mrhb-dark/70">{r.calc}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default async function HowItWorksPage() {
  const { metrics, tools } = await loadConfig()

  return (
    <div className="pb-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-mrhb-dark">How it works</h1>
        <p className="mt-1 max-w-3xl text-sm text-mrhb-dark/60">
          Exactly how each card is calculated and where its number comes from. We never present sample data as
          live — anything not yet wired to a real source is labelled &ldquo;sample&rdquo; or &ldquo;not
          connected&rdquo; on its page.
        </p>
      </div>

      {/* Data sources */}
      <section className="mb-6 rounded-2xl bg-mrhb-white p-5 shadow-sm ring-1 ring-mrhb-warm-grey/10">
        <div className="mb-3 flex items-center gap-2">
          <Database size={16} className="text-mrhb-blue" />
          <h2 className="text-base font-semibold text-mrhb-dark">Data sources</h2>
        </div>
        <ul className="grid grid-cols-1 gap-2 text-sm text-mrhb-dark/70 sm:grid-cols-2">
          <li><strong>GA4 (website)</strong> — traffic, channels, geography, page views.</li>
          <li><strong>GA4 for Firebase (Sahal Wallet app)</strong> — app events: opens, sessions, onboarding, tools, transactions.</li>
          <li><strong>Google Search Console</strong> — SEO impressions, clicks, position (page dimension).</li>
          <li><strong>Short.io</strong> — social link clicks (human vs bot) for mrhbnetwork.short.gy.</li>
          <li><strong>Play Store</strong> — install badge + rating (listing); reviews via Android Publisher API.</li>
          <li><strong>Microsoft Clarity</strong> — UX/friction (currently returns no API data → sample).</li>
        </ul>
      </section>

      <DocSection
        title="Overview"
        subtitle="Aggregates that reconcile with the individual pages."
        rows={[
          { card: 'Total Users', calc: 'GA4 website active users for the range (de-duplicated) — the same authoritative figure as the Traffic page.' },
          { card: 'App Installs', calc: 'GA4 first-open events (an install proxy from Firebase), not Play-Store-verified installs.' },
          { card: 'Organic Clicks', calc: 'Sum of Search Console clicks from the page dimension (matches the SEO page).' },
          { card: 'Social Clicks (Human)', calc: 'Authoritative Short.io human-click total for the range (matches the Social page).' },
          { card: 'Wallet Active Users', calc: 'De-duplicated active users of the Sahal Wallet app (GA4 Firebase).' },
          { card: 'Revenue', calc: 'Not configured — needs Firebase purchase/revenue events; shown as "Not configured", never a live figure.' },
        ]}
      />

      <DocSection
        title="Traffic"
        subtitle="GA4 website property (authoritative per-range totals)."
        rows={[
          { card: 'Users / Sessions', calc: 'GA4 de-duplicated per-range totals (activeUsers / sessions). Users are non-additive, so they are never summed across days.' },
          { card: 'Trend / Channels / Sources', calc: 'From stored authoritative GA4 daily_kpis rows (website only), not the raw ga_traffic table.' },
          { card: 'Devices / Countries / Browsers', calc: 'GA4 ga_geo (website), for the selected range.' },
        ]}
      />

      <DocSection
        title="SEO (Search Console)"
        rows={[
          { card: 'Total Impressions / Clicks', calc: 'Sum of gsc_pages over the range (page dimension — more complete than the anonymized query dimension).' },
          { card: 'Avg CTR', calc: 'Impression-weighted: total clicks ÷ total impressions (not an average of per-row rates).' },
          { card: 'Avg Position', calc: 'Impression-weighted average position across pages.' },
          { card: 'Top Queries', calc: 'From gsc_queries (the query breakdown), weighted CTR/position.' },
        ]}
      />

      <DocSection
        title="Blog"
        rows={[
          { card: 'Blog metrics', calc: 'Search Console rows filtered to /blogs/ URLs, joined to GA4 page paths; read time is pageview-weighted.' },
        ]}
      />

      <DocSection
        title="Social & Campaigns"
        subtitle="Short.io (mrhbnetwork.short.gy)."
        rows={[
          { card: 'Total / Human Clicks', calc: "Authoritative per-range totals from Short.io's own statistics (human vs bot split)." },
          { card: 'Platform / Country / Device', calc: "From Short.io's per-range breakdown snapshots." },
        ]}
      />

      <DocSection
        title="User Journey (Funnel)"
        subtitle="Cross-source — not a single tracked cohort."
        rows={[
          { card: 'Impressions', calc: 'Search Console web impressions. Social + app-store impressions are Not connected.' },
          { card: 'Clicks', calc: 'Search Console web clicks + Short.io human social clicks.' },
          { card: 'App Installs', calc: 'GA4 first-open (install proxy).' },
          { card: 'Transaction', calc: 'Users with a send/swap/ramp event (approx.).' },
          { card: 'Revenue', calc: 'Not connected until Firebase revenue events exist.' },
        ]}
      />

      <DocSection
        title="UX & Friction"
        rows={[{ card: 'All cards', calc: 'Microsoft Clarity — its API currently returns no data, so this page shows clearly-labelled sample values.' }]}
      />

      <DocSection
        title="Revenue"
        rows={[{ card: 'All cards', calc: 'Sample data — revenue tracking is not configured (needs Firebase purchase/revenue events or a payment/store financial feed).' }]}
      />

      {/* App Performance — dynamic, event-driven */}
      <section className="mb-6 overflow-hidden rounded-2xl bg-mrhb-white shadow-sm ring-1 ring-mrhb-warm-grey/10">
        <div className="border-b border-mrhb-warm-grey/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-mrhb-blue" />
            <h2 className="text-base font-semibold text-mrhb-dark">App Performance</h2>
          </div>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-mrhb-dark/60">
            <Info size={13} className="mt-0.5 flex-shrink-0 text-mrhb-blue" />
            <span>
              These cards are built from <strong>Firebase events the Sahal Wallet app fires</strong>. Each metric
              block below maps to event-name patterns — edit them in <strong>Admin → App Performance Metrics</strong>
              and every card derived from a block updates automatically.
            </span>
          </p>
        </div>

        <div className="px-5 py-4">
          <h3 className="mb-2 text-sm font-semibold text-mrhb-dark">Metric blocks → events → cards</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-mrhb-warm-grey/20 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                  <th className="px-3 py-2">Block</th>
                  <th className="px-3 py-2">Event patterns ({'{match}'})</th>
                  <th className="px-3 py-2">Powers these cards</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.key} className="border-b border-mrhb-warm-grey/10 last:border-0 align-top">
                    <td className="px-3 py-2.5 font-medium text-mrhb-dark">{m.label}</td>
                    <td className="px-3 py-2.5">
                      <code className="rounded bg-mrhb-cream px-1.5 py-0.5 font-mono text-xs text-mrhb-dark/80">
                        {m.patterns.join(', ')}
                      </code>
                      <span className="ml-1 text-[11px] text-mrhb-dark/40">({m.matchType})</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-mrhb-dark/60">{m.usedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mb-2 mt-6 text-sm font-semibold text-mrhb-dark">Derived KPIs</h3>
          <ul className="space-y-1.5 text-sm text-mrhb-dark/70">
            <li><strong>Total Installs</strong> — latest Play-Store listing badge (cumulative, not summed); falls back to first-open proxy if the store isn&apos;t synced.</li>
            <li><strong>Active Users</strong> — de-duplicated GA4 app active users for the range.</li>
            <li><strong>Onboarding Rate</strong> — onboarding-complete users ÷ first-open (approx.).</li>
            <li><strong>Transaction Rate</strong> — transacting users ÷ users reaching the dashboard.</li>
            <li><strong>Avg Rating</strong> — Play-Store listing average; App Store is Not connected.</li>
          </ul>

          <h3 className="mb-2 mt-6 text-sm font-semibold text-mrhb-dark">Onboarding drop-off funnel (new users)</h3>
          <p className="mb-2 text-xs text-mrhb-dark/60">
            A <strong>new-user-only</strong> funnel — returning users are excluded. Each stage counts users (summed
            daily, a ceiling), matched across Android/iOS/web, so the <strong>stage-to-stage ratios</strong> are what
            matter, not the absolute totals.
          </p>
          <ul className="space-y-1.5 text-sm text-mrhb-dark/70">
            <li>
              <strong>Started signup</strong> — users who began any signup path:{' '}
              <code className="rounded bg-mrhb-cream px-1.5 py-0.5 font-mono text-xs text-mrhb-dark/80">*_ONBOARDING_LETS_GO</code>,{' '}
              <code className="rounded bg-mrhb-cream px-1.5 py-0.5 font-mono text-xs text-mrhb-dark/80">*_ONBOARDING_SOCIAL_SIGNUP</code> or{' '}
              <code className="rounded bg-mrhb-cream px-1.5 py-0.5 font-mono text-xs text-mrhb-dark/80">*_ONBOARDING_IMPORT_WALLET</code>.
            </li>
            <li>
              <strong>Passcode created</strong> —{' '}
              <code className="rounded bg-mrhb-cream px-1.5 py-0.5 font-mono text-xs text-mrhb-dark/80">*_SETTINGS_NEW_PASSCODE</code>, the
              create-6-digit-passcode step every new user hits and returning users never do (the cleanest new-user signal).
            </li>
            <li>
              <strong>Onboarding complete</strong> —{' '}
              <code className="rounded bg-mrhb-cream px-1.5 py-0.5 font-mono text-xs text-mrhb-dark/80">*_ONBOARDING_GUIDE_COMPLETE</code>.
            </li>
          </ul>
          <p className="mt-2 text-xs text-mrhb-dark/50">
            The card shows stage-to-stage and overall conversion (Started &rarr; Passcode, Passcode &rarr; Complete,
            and overall). These are <strong>GA4 signals</strong> and undercount the backend&apos;s registered-signup
            total, so read them as drop-off ratios, not the authoritative signup count.
          </p>

          <h3 className="mb-2 mt-6 text-sm font-semibold text-mrhb-dark">Tool Usage tabs</h3>
          <p className="mb-2 text-xs text-mrhb-dark/60">
            Each tool&apos;s active users/events come from these event-name patterns (first-match-wins, editable in
            Admin → Tool Usage Mapping). &ldquo;Active Users&rdquo; is summed daily active — a ceiling, not
            unique-in-period.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <span key={t.tool} className="rounded-full bg-mrhb-cream px-2.5 py-1 text-xs text-mrhb-dark/70">
                <strong className="text-mrhb-dark">{t.tool}</strong>: {t.patterns.join(', ')}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

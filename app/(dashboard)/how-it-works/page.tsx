import { createServiceClient } from '@/lib/supabase/server'
import { DEFAULT_APP_METRICS, resolveAppMetrics, type AppMetricDef } from '@/lib/config/app-metrics'
import { DEFAULT_TOOL_MAPPINGS, type ToolMapping } from '@/lib/config/tool-usage'
import { Database, Smartphone, Info, BookOpen } from 'lucide-react'

// Server component: a plain-English reference for how EVERY card on the
// dashboard is calculated and where its number comes from. Written so a
// non-technical manager can explain each metric (and its source) to the tech
// team. App Performance blocks + tool mappings are pulled LIVE from config so
// this page always matches what the dashboard actually computes.

export const dynamic = 'force-dynamic'

interface DocRow {
  card: string
  calc: string
  source?: string
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
          <li key={r.card} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:gap-4">
            <span className="w-full flex-shrink-0 text-sm font-semibold text-mrhb-dark sm:w-52">{r.card}</span>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm leading-relaxed text-mrhb-dark/70">{r.calc}</span>
              {r.source && (
                <span className="inline-block w-fit rounded-full bg-mrhb-cream px-2.5 py-0.5 text-[11px] font-medium text-mrhb-dark/60">
                  Source: {r.source}
                </span>
              )}
            </div>
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
          A plain-English guide to every card — what it means, where the number comes from, and how it&apos;s worked
          out — so it&apos;s easy to explain to anyone. We never present sample data as live: anything not yet wired to
          a real source is labelled &ldquo;sample&rdquo; or &ldquo;Not connected&rdquo; on its page.
        </p>
      </div>

      {/* How to read ANY card */}
      <section className="mb-6 rounded-2xl bg-mrhb-white p-5 shadow-sm ring-1 ring-mrhb-warm-grey/10">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen size={16} className="text-mrhb-blue" />
          <h2 className="text-base font-semibold text-mrhb-dark">How to read any card</h2>
        </div>
        <ul className="space-y-2 text-sm text-mrhb-dark/70">
          <li><strong>The big number</strong> is the value for the date range you picked (Today / 7d / 30d / 90d, top-right of every page). Change the range and every card recalculates.</li>
          <li><strong>The coloured % (▲/▼)</strong> is the change vs the <em>previous, equal-length period</em> — e.g. this 30 days vs the 30 days before. Green is up, red is down.</li>
          <li><strong>The number under the %</strong> (e.g. &ldquo;−842&rdquo;) is that same change as an <em>actual figure</em>, not a percentage.</li>
          <li><strong>&ldquo;vs 1,259 previous period&rdquo;</strong> under the value tells you what the number <em>was</em> in the previous period, so you can see the movement at a glance.</li>
          <li><strong>De-duplicated</strong> means each person is counted once no matter how many days they appeared — so user counts are never the sum of daily numbers.</li>
          <li><strong>Proxy</strong> means a close stand-in for something we can&apos;t measure directly (e.g. app opens standing in for installs). It&apos;s labelled as such.</li>
          <li><strong>Live vs Sample:</strong> &ldquo;Sample&rdquo; / &ldquo;Not connected&rdquo; badges mean the source isn&apos;t wired up yet and the number is a placeholder — never a real figure.</li>
        </ul>
      </section>

      {/* Data sources */}
      <section className="mb-6 rounded-2xl bg-mrhb-white p-5 shadow-sm ring-1 ring-mrhb-warm-grey/10">
        <div className="mb-3 flex items-center gap-2">
          <Database size={16} className="text-mrhb-blue" />
          <h2 className="text-base font-semibold text-mrhb-dark">Where the data comes from</h2>
        </div>
        <ul className="grid grid-cols-1 gap-2 text-sm text-mrhb-dark/70 sm:grid-cols-2">
          <li><strong>GA4 (website)</strong> — traffic, channels, geography, page &amp; blog views.</li>
          <li><strong>GA4 for Firebase (Sahal Wallet app)</strong> — app events: opens, sessions, onboarding, tools, transactions.</li>
          <li><strong>Google Search Console</strong> — SEO impressions, clicks, position (per page).</li>
          <li><strong>Short.io</strong> — social link clicks (human vs bot) for mrhbnetwork.short.gy.</li>
          <li><strong>Play Store</strong> — install badge + rating (listing); reviews via Android Publisher API.</li>
          <li><strong>Microsoft Clarity</strong> — UX/friction (currently returns no API data → sample).</li>
        </ul>
      </section>

      <DocSection
        title="Overview"
        subtitle="Top-level totals that reconcile exactly with the detailed pages."
        rows={[
          { card: 'Total Website Users', calc: 'Distinct people who visited the website in the period, each counted once (de-duplicated). The same authoritative figure as the Traffic page — never a sum of daily numbers.', source: 'GA4 — website' },
          { card: 'App Installs', calc: 'First-time app opens — a stand-in (proxy) for installs. It is NOT a Play-Store-verified install count, so it can differ from store figures.', source: 'GA4 for Firebase (first_open)' },
          { card: 'Organic Clicks', calc: 'Clicks from Google search results to the website. Sums the per-page clicks so it matches the SEO page exactly.', source: 'Google Search Console' },
          { card: 'Social Clicks (Human)', calc: 'Clicks from real people (bots excluded) on our short links — the authoritative per-range total (matches the Social page).', source: 'Short.io' },
          { card: 'Wallet Active Users', calc: 'Distinct people who used the Sahal Wallet app in the period, each counted once (de-duplicated).', source: 'GA4 for Firebase' },
          { card: 'Revenue', calc: 'Deliberately shown as "Not configured", never a live figure — it needs Firebase purchase/revenue events. We never present transaction counts as money.', source: 'Not connected' },
        ]}
      />

      <DocSection
        title="Traffic & Acquisition"
        subtitle="GA4 website property — exact per-range totals (users are de-duplicated, never summed across days)."
        rows={[
          { card: 'Sessions', calc: 'Number of visits to the website (a session = one browsing visit). GA4’s exact total for the range.', source: 'GA4 — website' },
          { card: 'Users', calc: 'Distinct visitors in the period, each counted once (de-duplicated).', source: 'GA4 — website' },
          { card: 'New Users', calc: 'Visitors arriving for the first time in the period.', source: 'GA4 — website' },
          { card: 'Bounce Rate', calc: 'Share of visits that left without engaging (one-and-done visits). Lower is generally better.', source: 'GA4 — website' },
          { card: 'Avg Session Duration', calc: 'Average length of a visit across all sessions in the period.', source: 'GA4 — website' },
          { card: 'Breakdowns (channels, sources, devices, countries, browser/OS)', calc: 'Where visits come from and what people use, for the selected range.', source: 'GA4 — website' },
        ]}
      />

      <DocSection
        title="SEO Performance"
        subtitle="Google Search Console, using the per-page data (more complete than the anonymised query data)."
        rows={[
          { card: 'Total Impressions', calc: 'How many times our pages appeared in Google search results (summed across pages for the range).', source: 'Search Console' },
          { card: 'Total Clicks', calc: 'How many of those results people actually clicked through to the site.', source: 'Search Console' },
          { card: 'Avg CTR', calc: 'Click-through rate = total clicks ÷ total impressions (weighted by impressions, not an average of per-row rates).', source: 'Search Console' },
          { card: 'Avg Position', calc: 'Average ranking position in search results, weighted by impressions. Lower is better (position 1 = top).', source: 'Search Console' },
          { card: 'Top Queries / Top Pages', calc: 'The search terms and pages driving the most impressions and clicks.', source: 'Search Console' },
        ]}
      />

      <DocSection
        title="Blog Performance"
        rows={[
          { card: 'Total Blog Views', calc: 'Pageviews of /blogs/ pages in the period.', source: 'GA4 — website' },
          { card: 'Avg Read Time', calc: 'Average time spent on blog pages, weighted by pageviews.', source: 'GA4 — website' },
          { card: 'Top Post Views', calc: 'Views of the single most-read post in the period.', source: 'GA4 — website' },
          { card: 'Search Impressions', calc: 'How many times blog pages appeared in Google search results.', source: 'Search Console' },
          { card: 'Content Gap (high impressions, low clicks)', calc: 'Blog pages that show up a lot in search but rarely get clicked — candidates for better titles/snippets.', source: 'Search Console + GA4' },
        ]}
      />

      <DocSection
        title="Social Media & Campaigns"
        subtitle="Short.io (mrhbnetwork.short.gy) — the authoritative link-click source."
        rows={[
          { card: 'Total Clicks', calc: 'All clicks on our short links in the period (real people + bots combined).', source: 'Short.io' },
          { card: 'Human Clicks', calc: 'Clicks from real people only, with automated/bot clicks removed.', source: 'Short.io' },
          { card: 'Human Click Rate', calc: 'Human clicks ÷ total clicks — how much of the traffic is genuine.', source: 'Short.io' },
          { card: 'Top Platform', calc: 'The social platform (LinkedIn, X, etc.) sending the most clicks.', source: 'Short.io' },
        ]}
      />

      <DocSection
        title="User Journey (Funnel)"
        subtitle="A cross-source journey — the stages come from different systems and populations, so it is NOT one tracked group of people."
        rows={[
          { card: 'Impressions', calc: 'Times we appeared in web search. Social + app-store impressions are Not connected yet.', source: 'Search Console' },
          { card: 'Clicks', calc: 'Web search clicks + human social clicks combined.', source: 'Search Console + Short.io' },
          { card: 'App Installs', calc: 'First-time app opens (the install proxy).', source: 'GA4 for Firebase' },
          { card: 'Transaction', calc: 'People who made a send / swap / ramp. Note: this counts the whole active base, so it can exceed installs (they are different populations).', source: 'GA4 for Firebase' },
          { card: 'Revenue', calc: 'Not connected until Firebase revenue events exist.', source: 'Not connected' },
          { card: 'GA4 Social Sessions (aggregate)', calc: 'All website sessions in GA4’s "Organic Social" channel. Shown as one total because GA4 reports these under a generic "social" source, so a trustworthy per-platform split isn’t available.', source: 'GA4 — website' },
        ]}
      />

      <DocSection
        title="UX Behavior & Friction"
        rows={[
          { card: 'Scroll Depth, Active Time, Pages / Session, Dead Click Rate', calc: 'All sample values. Microsoft Clarity’s API currently returns no data, so this page shows clearly-labelled placeholders — not live numbers.', source: 'Sample (Clarity not returning data)' },
        ]}
      />

      <DocSection
        title="Revenue & Transactions"
        rows={[
          { card: 'Total Revenue, Transaction Count, Avg Transaction Value, Revenue Growth', calc: 'All sample data. Revenue tracking is not configured yet — it needs Firebase purchase/revenue events (or a payment/store financial feed). No figure here is real.', source: 'Sample (not configured)' },
        ]}
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
              block below maps to event-name patterns — edit them in <strong>Admin &rarr; App Performance Metrics</strong>
              {' '}and every card derived from a block updates automatically.
            </span>
          </p>
        </div>

        <div className="px-5 py-4">
          <h3 className="mb-2 text-sm font-semibold text-mrhb-dark">The KPI cards</h3>
          <ul className="space-y-1.5 text-sm text-mrhb-dark/70">
            <li><strong>Total Installs</strong> — the Play Store listing&apos;s lifetime install badge (a running cumulative number, shown as-is and never summed). If the store isn&apos;t synced, it falls back to the GA4 first-open proxy. <em>Source: Play Store / GA4.</em></li>
            <li><strong>Active Users</strong> — distinct people who used the app in the period, each counted once (de-duplicated). <em>Source: GA4 for Firebase.</em></li>
            <li><strong>Avg Rating</strong> — the Play Store listing&apos;s average star rating. App Store is Not connected. <em>Source: Play Store.</em></li>
            <li><strong>Onboarding Rate</strong> — of people who opened the app, the share who finished onboarding: onboarding-complete users &divide; first opens (approx.). <em>Source: GA4 events.</em></li>
            <li><strong>Transaction Rate</strong> — of people who reached the dashboard, the share who made a transaction: transacting users &divide; dashboard users. <em>Source: GA4 events.</em></li>
          </ul>

          <h3 className="mb-2 mt-6 text-sm font-semibold text-mrhb-dark">Metric blocks &rarr; events &rarr; cards</h3>
          <p className="mb-2 text-xs text-mrhb-dark/60">
            Each block below is a set of Firebase event-name patterns. Rename or re-map a block in Admin and every card
            that uses it recalculates — that&apos;s how &ldquo;this event powers this card&rdquo; stays in sync.
          </p>
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

          <h3 className="mb-2 mt-6 text-sm font-semibold text-mrhb-dark">Tool Usage tabs &amp; Tile Clicks by Tool</h3>
          <p className="mb-2 text-xs text-mrhb-dark/60">
            Each tool&apos;s active users/events (and the &ldquo;Tile Clicks by Tool&rdquo; chart) come from these
            event-name patterns (first-match-wins, editable in Admin &rarr; Tool Usage Mapping). &ldquo;Active
            Users&rdquo; is summed daily active — a ceiling, not unique-in-period; &ldquo;Avg Daily Users&rdquo; is that
            total &divide; days in the range.
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

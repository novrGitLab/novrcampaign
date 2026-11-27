import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Download, BarChart3, Mail, MousePointerClick, UserMinus, ShieldAlert,
  GitCompare, UsersRound,
} from '../components/ui/icons';
import {
  Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import { useCampaigns, useSuppressions } from '../hooks/queries';
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, InfoTip, Input, StatCard,
  StatCardSkeleton,
} from '../components/ui';
import SuppressionStats, { SectionNote } from '../components/SuppressionStats';
import { formatNumber, formatRate, formatDate, cn } from '../lib/utils';
import { downloadCsv } from '../lib/exportCsv';
import { TIP } from '../lib/metrics';

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Monday 00:00 of the week containing d. */
function weekStart(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon=0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
}

function weekLabel(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayLabel(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const pct = (v) => Number(v) || 0;

/** Aggregate sent campaigns into calendar days, filling gaps with zeros. */
function buildDays(sent) {
  const map = new Map();
  for (const c of sent) {
    const at = c.sentAt || c.scheduledFor || c.updatedAt || c.createdAt;
    if (!at) continue;
    const start = dayStart(new Date(at)).getTime();
    const d = map.get(start) || { start, label: dayLabel(start), sent: 0, opened: 0, clicked: 0, unsub: 0 };
    d.sent += pct(c.sentCount);
    d.opened += pct(c.openedCount);
    d.clicked += pct(c.clickedCount);
    d.unsub += pct(c.unsubscribedCount);
    map.set(start, d);
  }
  const days = [...map.values()].sort((a, b) => a.start - b.start);
  const out = [];
  for (const d of days) {
    let guard = 0;
    while (out.length && out[out.length - 1].start + DAY_MS < d.start && guard++ < 400) {
      const next = out[out.length - 1].start + DAY_MS;
      out.push({ start: next, label: dayLabel(next), sent: 0, opened: 0, clicked: 0, unsub: 0 });
    }
    out.push(d);
  }
  return out;
}

/** Aggregate sent campaigns into ISO weeks (Monday), oldest first. */
function buildWeeks(sent) {
  const map = new Map();
  for (const c of sent) {
    const at = c.sentAt || c.scheduledFor || c.updatedAt || c.createdAt;
    if (!at) continue;
    const start = weekStart(new Date(at)).getTime();
    const w = map.get(start) || { start, label: weekLabel(start), sent: 0, opened: 0, clicked: 0, unsub: 0 };
    w.sent += pct(c.sentCount);
    w.opened += pct(c.openedCount);
    w.clicked += pct(c.clickedCount);
    w.unsub += pct(c.unsubscribedCount);
    map.set(start, w);
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

function delta(now, prev) {
  if (!prev) return null;
  if (prev === 0) return now > 0 ? 100 : 0;
  return Math.round(((now - prev) / prev) * 100);
}

function DeltaChip({ value }) {
  if (value === null || value === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  if (value === 0) return <span className="text-xs font-medium text-muted-foreground">0%</span>;
  const up = value > 0;
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
      up
        ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20'
        : 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/20',
    )}>
      {up ? '▲' : '▼'} {Math.abs(value)}%
    </span>
  );
}

const METRICS = [
  { key: 'sentCount', label: 'Sent', numeric: true },
  { key: 'deliveredCount', label: 'Delivered', numeric: true },
  { key: 'openedCount', label: 'Opens', numeric: true },
  { key: 'clickedCount', label: 'Clicks', numeric: true },
  { key: 'unsubscribedCount', label: 'Unsubscribed', numeric: true },
  { key: 'bouncedCount', label: 'Bounced', numeric: true },
  { key: 'complainedCount', label: 'Spam complaints', numeric: true },
];

function rateOf(c, key) {
  return pct(c[key]) / Math.max(pct(c.sentCount), 1) * 100;
}

const RATE_METRICS = [
  { key: 'openedCount', label: 'Open rate' },
  { key: 'clickedCount', label: 'Click rate' },
  { key: 'deliveredCount', label: 'Delivery rate' },
  { key: 'unsubscribedCount', label: 'Unsub rate' },
];

/* ── page ────────────────────────────────────────────────────────────────── */

export default function Analytics() {
  const { data: campaigns = [], isLoading } = useCampaigns();
  const { data: suppressionsData } = useSuppressions();

  const sent = useMemo(
    () => campaigns.filter((c) => c.status === 'SENT'),
    [campaigns],
  );

  /* Date-range filter (per-day view) — empty strings = all time */
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rangeActive = Boolean(from || to);

  const ranged = useMemo(() => {
    if (!rangeActive) return sent;
    const lo = from ? new Date(`${from}T00:00:00`) : null;
    const hi = to ? new Date(`${to}T23:59:59.999`) : null;
    return sent.filter((c) => {
      const at = c.sentAt || c.scheduledFor || c.updatedAt || c.createdAt;
      if (!at) return false;
      const t = new Date(at);
      return (!lo || t >= lo) && (!hi || t <= hi);
    });
  }, [sent, from, to, rangeActive]);

  const totals = useMemo(() => {
    const t = { sentCount: 0, deliveredCount: 0, openedCount: 0, clickedCount: 0, unsubscribedCount: 0, bouncedCount: 0, complainedCount: 0 };
    for (const c of ranged) {
      for (const k of Object.keys(t)) t[k] += pct(c[k]);
    }
    return t;
  }, [ranged]);

  const days = useMemo(() => buildDays(ranged), [ranged]);
  const weeks = useMemo(() => buildWeeks(ranged), [ranged]);

  const chartData = days.map((d) => ({
    name: d.label,
    Sent: d.sent,
    Opens: d.opened,
    Clicks: d.clicked,
  }));

  const weekRows = weeks.map((w, i) => {
    const prev = weeks[weeks.indexOf(w) - 1] || null;
    return {
      ...w,
      dSent: prev ? delta(w.sent, prev.sent) : null,
      dOpened: prev ? delta(w.opened, prev.opened) : null,
      dClicked: prev ? delta(w.clicked, prev.clicked) : null,
      i,
    };
  }).reverse();

  /* Compare campaigns (up to 3) */
  const [selected, setSelected] = useState(() => []);
  const comparable = useMemo(() => [...sent].sort((a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime()), [sent]);

  // Default selection: two most recent sends (or one)
  const ensured = useMemo(() => {
    if (selected.length > 0 || comparable.length === 0) return selected;
    return comparable.slice(0, 2).map((c) => c.id);
  }, [selected, comparable]);

  const toggle = (id) => {
    setSelected((cur) => {
      const base = cur.length ? cur : ensured;
      if (base.includes(id)) return base.filter((x) => x !== id);
      if (base.length >= 3) return base;
      return [...base, id];
    });
  };
  const chosenFinal = comparable.filter((c) => ensured.includes(c.id));

  /* Unsubscribes */
  const unsubRows = useMemo(
    () => (suppressionsData?.suppressions ?? []).filter((r) => (r.reasons ?? []).includes('UNSUBSCRIBED')),
    [suppressionsData],
  );
  const topUnsub = useMemo(
    () => [...sent].sort((a, b) => pct(b.unsubscribedCount) - pct(a.unsubscribedCount)).filter((c) => pct(c.unsubscribedCount) > 0).slice(0, 5),
    [sent],
  );

  /* ── exports ────────────────────────────────────────────────────────────── */

  const exportReport = () => {
    const rows = ranged.map((c) => ({
      Campaign: c.name,
      Status: c.status,
      'Sent at': c.sentAt ? formatDate(c.sentAt) : '',
      Sent: pct(c.sentCount),
      Delivered: pct(c.deliveredCount),
      Opens: pct(c.openedCount),
      Clicks: pct(c.clickedCount),
      Unsubscribed: pct(c.unsubscribedCount),
      Bounced: pct(c.bouncedCount),
      'Spam complaints': pct(c.complainedCount),
      'Open rate %': rateOf(c, 'openedCount').toFixed(2),
      'Click rate %': rateOf(c, 'clickedCount').toFixed(2),
      'Unsub rate %': rateOf(c, 'unsubscribedCount').toFixed(2),
    }));
    downloadCsv('novr-analytics-report', rows);
  };

  const exportDaily = () => {
    downloadCsv('novr-daily-report', days.map((d) => ({
      Day: d.label,
      Sent: d.sent,
      Opens: d.opened,
      Clicks: d.clicked,
      Unsubscribes: d.unsub,
    })));
  };

  const exportComparison = () => {
    const header = ['Metric', ...chosenFinal.map((c) => c.name)];
    const rows = [];
    for (const m of [...METRICS, ...RATE_METRICS.map((r) => ({ ...r, rate: true }))]) {
      rows.push([
        m.label,
        ...chosenFinal.map((c) => ('rate' in m && m.rate ? rateOf(c, m.key).toFixed(2) + '%' : pct(c[m.key]))),
      ]);
    }
    downloadCsv('novr-campaign-comparison', [header, ...rows]);
  };

  const exportUnsubs = () => {
    downloadCsv('novr-unsubscribes', unsubRows.map((r) => ({
      Email: r.email,
      Campaign: r.campaignName || r.campaignId || '',
      Unsubscribed: r.at ? formatDate(r.at) : '',
    })));
  };

  const hasData = sent.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance across every campaign, day by day, in this workspace.
          </p>
        </div>
        <Button variant="secondary" onClick={exportReport} disabled={!hasData}>
          <Download className="h-4 w-4" />
          Export report
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Emails sent"
            value={formatNumber(totals.sentCount)}
            hint={`${ranged.length} completed campaign${ranged.length === 1 ? '' : 's'}${rangeActive ? ' in range' : ''}`}
            icon={<Mail className="h-4 w-4" />}
            accent="blue"
            tip={TIP.sent}
          />
          <StatCard
            label="Delivered"
            value={formatRate(totals.deliveredCount, totals.sentCount)}
            hint={`${formatNumber(totals.deliveredCount)} of ${formatNumber(totals.sentCount)}`}
            icon={<BarChart3 className="h-4 w-4" />}
            accent="purple"
            tip={TIP.delivered}
          />
          <StatCard
            label="Open rate"
            value={formatRate(totals.openedCount, totals.sentCount)}
            hint={`${formatNumber(totals.openedCount)} total opens`}
            icon={<MousePointerClick className="h-4 w-4" />}
            accent="red"
            tip={TIP.openRate}
          />
          <StatCard
            label="Click rate"
            value={formatRate(totals.clickedCount, totals.sentCount)}
            hint={`${formatNumber(totals.clickedCount)} total clicks`}
            icon={<MousePointerClick className="h-4 w-4" />}
            accent="blue"
            tip={TIP.clickRate}
          />
        </div>
      )}


      {!isLoading && (
        <div className="mt-6">
          <SectionNote>Suppression overview</SectionNote>
          <div className="mt-3">
            <SuppressionStats />
          </div>
        </div>
      )}

      {!isLoading && !hasData && (
        <Card className="mt-6">
          <CardContent>
            <EmptyState
              icon={<BarChart3 className="h-8 w-8" />}
              title="No sends yet"
              description="Analytics populate once a campaign has been sent."
              action={<Link href="/campaigns/new"><Button>New campaign</Button></Link>}
            />
          </CardContent>
        </Card>
      )}

      {hasData && (
        <>

          <Card className="mt-6">
            <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Daily performance</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Sent, opens and clicks per day</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  From
                  <Input
                    type="date"
                    value={from}
                    max={to || undefined}
                    onChange={(e) => setFrom(e.target.value)}
                    aria-label="From date"
                    className="h-8 w-[9.25rem] px-2 text-xs"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  To
                  <Input
                    type="date"
                    value={to}
                    min={from || undefined}
                    onChange={(e) => setTo(e.target.value)}
                    aria-label="To date"
                    className="h-8 w-[9.25rem] px-2 text-xs"
                  />
                </label>
                {rangeActive && (
                  <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); }}>
                    Clear
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={exportDaily} disabled={days.length === 0}>
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {days.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {rangeActive
                    ? 'No sends in the selected date range — adjust the dates or clear them.'
                    : 'No sent campaigns to chart yet.'}
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--subtle)" minTickGap={28} />
                    <YAxis tick={{ fontSize: 12 }} stroke="var(--subtle)" allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--line)', fontSize: 12 }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="Sent" stroke="var(--link)" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Opens" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Clicks" stroke="var(--signal)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>


          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Week over week
                <InfoTip content={TIP.weekDelta} />
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Change versus the previous week</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead className="border-b border-border">
                    <tr>
                      <th>Week</th>
                      <th className="text-right">Sent</th>
                      <th className="text-right">Δ</th>
                      <th className="text-right">Opens</th>
                      <th className="text-right">Δ</th>
                      <th className="text-right">Clicks</th>
                      <th className="text-right">Δ</th>
                      <th className="text-right">Unsubs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-6 text-center text-sm text-muted-foreground">
                          {rangeActive ? 'No sends in the selected date range.' : 'No sends yet to compare.'}
                        </td>
                      </tr>
                    ) : weekRows.map((w) => (
                      <tr key={w.start} className="border-b border-border last:border-0 hover:bg-secondary/60">
                        <td className="font-medium">{w.label}</td>
                        <td className="text-right tabular-nums">{formatNumber(w.sent)}</td>
                        <td className="text-right"><span className="inline-block min-w-[72px] text-right"><DeltaChip value={w.dSent} /></span></td>
                        <td className="text-right tabular-nums">{formatNumber(w.opened)}</td>
                        <td className="text-right"><span className="inline-block min-w-[72px] text-right"><DeltaChip value={w.dOpened} /></span></td>
                        <td className="text-right tabular-nums">{formatNumber(w.clicked)}</td>
                        <td className="text-right"><span className="inline-block min-w-[72px] text-right"><DeltaChip value={w.dClicked} /></span></td>
                        <td className="text-right tabular-nums">{formatNumber(w.unsub)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>


          <Card className="mt-6">
            <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <GitCompare className="h-4 w-4 text-brand-purple" />
                  Compare campaigns
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Pick up to 3 sends to compare side by side</p>
              </div>
              <Button variant="secondary" size="sm" onClick={exportComparison} disabled={chosenFinal.length === 0}>
                <Download className="h-3.5 w-3.5" />
                Export comparison
              </Button>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-2">
                {comparable.length === 0 && (
                  <p className="text-sm text-muted-foreground">No sent campaigns to compare yet.</p>
                )}
                {comparable.map((c) => {
                  const active = ensured.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(c.id)}
                      aria-pressed={active}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        active
                          ? 'border-brand-purple/40 bg-brand-purple/10 text-brand-purple dark:border-purple-400/40 dark:bg-purple-500/15 dark:text-purple-200'
                          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>

              {chosenFinal.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Select at least one campaign.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead className="border-b border-border">
                      <tr>
                        <th>Metric</th>
                        {chosenFinal.map((c) => (
                          <th key={c.id} className="text-right">
                            <Link href={`/campaigns/${c.id}/analytics`} className="hover:underline">{c.name}</Link>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {METRICS.map((m) => {
                        const values = chosenFinal.map((c) => pct(c[m.key]));
                        const best = m.key === 'unsubscribedCount' || m.key === 'bouncedCount' || m.key === 'complainedCount'
                          ? Math.min(...values)
                          : Math.max(...values);
                        return (
                          <tr key={m.key} className="border-b border-border last:border-0 hover:bg-secondary/60">
                            <td className="font-medium">
                              <span className="inline-flex items-center gap-1">
                                {m.label}
                                {(m.key === 'unsubscribedCount' || m.key === 'bouncedCount' || m.key === 'complainedCount') && (
                                  <InfoTip content={m.key === 'unsubscribedCount' ? TIP.unsubscribed : m.key === 'bouncedCount' ? TIP.bounced : TIP.complained} />
                                )}
                              </span>
                            </td>
                            {values.map((v, i) => (
                              <td key={chosenFinal[i].id} className={cn('text-right tabular-nums', v === best && chosenFinal.length > 1 && 'font-semibold')}>
                                {formatNumber(v)}
                                {v === best && chosenFinal.length > 1 && <span className="ml-1.5 text-[10px] font-semibold text-emerald-600">BEST</span>}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                      {RATE_METRICS.map((m) => {
                        const values = chosenFinal.map((c) => rateOf(c, m.key));
                        const best = m.key === 'unsubscribedCount' ? Math.min(...values) : Math.max(...values);
                        return (
                          <tr key={m.key} className="border-b border-border last:border-0 hover:bg-secondary/60">
                            <td className="font-medium">
                              <span className="inline-flex items-center gap-1">
                                {m.label}
                                <InfoTip
                                  content={
                                    m.key === 'openedCount' ? TIP.openRate
                                      : m.key === 'clickedCount' ? TIP.clickRate
                                        : m.key === 'deliveredCount' ? TIP.deliveryRate
                                          : TIP.unsubRate
                                  }
                                />
                              </span>
                            </td>
                            {values.map((v, i) => (
                              <td key={chosenFinal[i].id} className={cn('text-right tabular-nums', v === best && chosenFinal.length > 1 && 'font-semibold')}>
                                {v.toFixed(2)}%
                                {v === best && chosenFinal.length > 1 && <span className="ml-1.5 text-[10px] font-semibold text-emerald-600">BEST</span>}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>


          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <UsersRound className="h-4 w-4 text-brand-red" />
                  Top campaigns by unsubscribes
                </CardTitle>
                <Button variant="secondary" size="sm" onClick={exportUnsubs} disabled={unsubRows.length === 0}>
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {topUnsub.length === 0 ? (
                  <EmptyState
                    icon={<UserMinus className="h-8 w-8" />}
                    title="No unsubscribes"
                    description="Nobody has unsubscribed from a campaign yet."
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {topUnsub.map((c) => {
                      const unsubs = pct(c.unsubscribedCount);
                      const rate = rateOf(c, 'unsubscribedCount');
                      return (
                        <li key={c.id}>
                          <Link
                            href={`/campaigns/${c.id}/analytics`}
                            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/60"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{c.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {formatNumber(unsubs)} unsubscribed · {rate.toFixed(2)}% rate · {formatDate(c.sentAt)}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                              {formatNumber(unsubs)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Recent unsubscribes</CardTitle>
                <Link href="/suppressions">
                  <Button variant="secondary" size="sm">
                    <ShieldAlert className="h-4 w-4" />
                    All suppressions
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="p-0">
                {unsubRows.length === 0 ? (
                  <EmptyState
                    icon={<Mail className="h-8 w-8" />}
                    title="No one has unsubscribed"
                    description="Opt-outs will be listed here with the campaign that caused them."
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {unsubRows.slice(0, 6).map((r, i) => (
                      <li key={`${r.email}-${i}`} className="flex items-center gap-3 px-5 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{r.email}</span>
                          <span className="block text-xs text-muted-foreground">
                            {r.campaignName || 'Campaign'} · {r.at ? formatDate(r.at) : '—'}
                          </span>
                        </span>
                        <Badge status="UNSUBSCRIBED">Unsubscribed</Badge>
                      </li>
                    ))}
                  </ul>
                )}
                {unsubRows.length > 6 && (
                  <div className="border-t border-border px-5 py-3 text-right">
                    <Link href="/suppressions" className="text-sm font-medium hover:underline">
                      View all {unsubRows.length} unsubscribes
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

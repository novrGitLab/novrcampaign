import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, Search, AlertTriangle, UserMinus, Mail, Inbox, Download } from '../components/ui/icons';
import { useCampaigns, useSuppressions } from '../hooks/queries';
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, InfoTip, Input, StatCard, StatCardSkeleton, PageHeader } from '../components/ui';
import { formatNumber, formatDate, cn } from '../lib/utils';
import { downloadCsv } from '../lib/exportCsv';
import { TIP } from '../lib/metrics';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'BOUNCE', label: 'Hard bounces' },
  { value: 'COMPLAINT', label: 'Spam complaints' },
  { value: 'UNSUBSCRIBED', label: 'Unsubscribed' },
];

const REASON_STYLE = {
  BOUNCE: { label: 'Hard bounce', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  COMPLAINT: { label: 'Spam complaint', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-400' },
  UNSUBSCRIBED: { label: 'Unsubscribed', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
};

const EMPTY = [];

function ReasonBadge({ reason }) {
  const style = REASON_STYLE[reason] ?? REASON_STYLE.UNSUBSCRIBED;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', style.className)}>
      {style.label}
    </span>
  );
}

export default function Suppressions() {
  const { data, isLoading } = useSuppressions();
  const { data: campaigns = [] } = useCampaigns();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  // Prefer the API's campaignName; fall back to the loaded campaign list so a
  // row never degrades to showing a raw campaign id.
  const campaignNameById = useMemo(
    () => new Map(campaigns.map((c) => [c.id, c.name])),
    [campaigns],
  );
  const campaignLabel = (row) =>
    row.campaignName
    || (row.campaignId ? campaignNameById.get(row.campaignId) : null)
    || null;

  const suppressions = data?.suppressions ?? EMPTY;
  const softBounces = data?.softBounces ?? EMPTY;
  const counts = data?.counts ?? { BOUNCE: 0, COMPLAINT: 0, UNSUBSCRIBED: 0, total: 0 };

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return suppressions.filter((row) => {
      if (filter !== 'all' && !row.reasons.includes(filter)) return false;
      if (needle && !row.email.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [suppressions, filter, search]);

  const softRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return softBounces;
    return softBounces.filter((row) => row.email.toLowerCase().includes(needle));
  }, [softBounces, search]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader
        title="Suppressions"
        description="Delivery restrictions by address and reason."
        actions={
          <Button
            variant="secondary"
            onClick={() => downloadCsv('novr-suppressions', rows.map((r) => ({
              Email: r.email,
              Reasons: r.reasons.join(' | '),
              Campaign: r.campaignName || r.campaignId || '',
              Date: r.at ? formatDate(r.at) : '',
            })))}
            disabled={rows.length === 0}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

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
            label="Suppressed"
            value={formatNumber(counts.total)}
            hint="will not receive campaigns"
            icon={<ShieldAlert className="h-4 w-4" />}
            accent="blue"
            tip={TIP.suppressed}
          />
          <StatCard
            label="Hard bounces"
            value={formatNumber(counts.BOUNCE)}
            hint="invalid or dead mailboxes"
            icon={<AlertTriangle className="h-4 w-4" />}
            accent="red"
            tip={TIP.bounced}
          />
          <StatCard
            label="Spam complaints"
            value={formatNumber(counts.COMPLAINT)}
            hint="reported as spam"
            icon={<ShieldAlert className="h-4 w-4" />}
            accent="purple"
            tip={TIP.complained}
          />
          <StatCard
            label="Unsubscribed"
            value={formatNumber(counts.UNSUBSCRIBED)}
            hint="clicked unsubscribe"
            icon={<UserMinus className="h-4 w-4" />}
            accent="red"
            tip={TIP.unsubscribed}
          />
        </div>
      )}

      <Card className="mt-8">
        <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Suppressed addresses</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email…"
                className="h-8 w-56 pl-8 text-sm"
              />
            </div>
            <div className="flex rounded-md border p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    filter === f.value
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading suppressions…</p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-8 w-8" />}
              title="Nothing here"
              description={
                suppressions.length === 0
                  ? 'No address has been suppressed yet.'
                  : 'No suppressed address matches this filter.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead className="border-b border-border">
                  <tr>
                    <th>Email</th>
                    <th>Reason</th>
                    <th>Campaign that triggered it</th>
                    <th className="text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.email}-${row.reasons[0]}`} className="border-b border-border last:border-0 hover:bg-secondary/60">
                      <td className="font-medium">{row.email}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {row.reasons.map((reason) => (
                            <ReasonBadge key={reason} reason={reason} />
                          ))}
                        </div>
                      </td>
                      <td className="text-muted-foreground">
                        {row.campaignId ? (
                          <Link href={`/campaigns/${row.campaignId}/analytics`} className="hover:underline">
                            {campaignLabel(row) || row.campaignId}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-right text-muted-foreground">{formatDate(row.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-8">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-1.5">
            Soft bounces (temporary)
            <InfoTip content={TIP.softBounces} />
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Subscribed · delivery retries on the next send
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading soft bounces…</p>
          ) : softRows.length === 0 ? (
            <EmptyState
              icon={<Mail className="h-8 w-8" />}
              title="No soft bounces"
              description="No mailbox has temporarily rejected your mail."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead className="border-b border-border">
                  <tr>
                    <th>Email</th>
                    <th>Campaign</th>
                    <th className="text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {softRows.map((row, i) => (
                    <tr key={`${row.email}-${i}`} className="border-b border-border last:border-0 hover:bg-secondary/60">
                      <td className="font-medium">{row.email}</td>
                      <td className="text-muted-foreground">
                        {row.campaignId ? (
                          <Link href={`/campaigns/${row.campaignId}/analytics`} className="hover:underline">
                            {campaignLabel(row) || row.campaignId}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-right text-muted-foreground">{formatDate(row.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

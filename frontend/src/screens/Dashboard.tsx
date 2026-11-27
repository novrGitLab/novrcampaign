import Link from 'next/link';
import { Mail, Users, MousePointerClick, Plus, BarChart3, UserMinus, ShieldAlert, Download } from '../components/ui/icons';
import { useCampaigns, useContactCount } from '../hooks/queries';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, StatCard, StatCardSkeleton, InfoTip } from '../components/ui';
import SuppressionStats, { SectionNote } from '../components/SuppressionStats';
import { formatNumber, formatRate, formatDate } from '../lib/utils';
import { downloadCsv } from '../lib/exportCsv';
import { TIP } from '../lib/metrics';


export default function Dashboard() {
  const { data: campaigns = [], isLoading } = useCampaigns();
  const { data: totalContacts } = useContactCount();

  const sent = campaigns.filter((c) => c.status === 'SENT');
  const totalSent = sent.reduce((sum, c) => sum + (c.sentCount ?? 0), 0);
  const totalOpened = sent.reduce((sum, c) => sum + (c.openedCount ?? 0), 0);
  const totalClicked = sent.reduce((sum, c) => sum + (c.clickedCount ?? 0), 0);
  const totalUnsubs = sent.reduce((sum, c) => sum + (c.unsubscribedCount ?? 0), 0);

  const unsubscribedCampaigns = [...sent]
    .sort((a, b) => (b.unsubscribedCount ?? 0) - (a.unsubscribedCount ?? 0) || (b.sentCount ?? 0) - (a.sentCount ?? 0));

  const recent = [...campaigns]
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())
    .slice(0, 6);

  const exportUnsubs = () => {
    downloadCsv('novr-unsubscribes-by-campaign', unsubscribedCampaigns.map((c) => ({
      Campaign: c.name,
      'Sent at': c.sentAt ? formatDate(c.sentAt) : '',
      Sent: c.sentCount ?? 0,
      Delivered: c.deliveredCount ?? 0,
      Unsubscribed: c.unsubscribedCount ?? 0,
      'Unsub rate %': c.sentCount ? (((c.unsubscribedCount ?? 0) / c.sentCount) * 100).toFixed(2) : '0.00',
      Bounced: c.bouncedCount ?? 0,
      'Spam complaints': c.complainedCount ?? 0,
    })));
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Audience overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatNumber(totalSent)} emails sent across {sent.length} completed campaign{sent.length === 1 ? '' : 's'}.{' '}
            {formatNumber(totalContacts)} contacts in the address book.
          </p>
        </div>
        <Link href="/campaigns/new">
          <Button>
            <Plus className="h-4 w-4" />
            New campaign
          </Button>
        </Link>
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
            label="Total contacts"
            value={formatNumber(totalContacts)}
            hint="across campaigns"
            icon={<Users className="h-4 w-4" />}
            accent="blue"
            tip={TIP.totalContacts}
          />
          <StatCard
            label="Emails sent"
            value={formatNumber(totalSent)}
            hint={`${sent.length} completed campaign${sent.length === 1 ? '' : 's'}`}
            icon={<Mail className="h-4 w-4" />}
            accent="purple"
            tip={TIP.sent}
          />
          <StatCard
            label="Open rate"
            value={formatRate(totalOpened, totalSent)}
            hint={`${formatNumber(totalOpened)} total opens`}
            icon={<BarChart3 className="h-4 w-4" />}
            accent="red"
            tip={TIP.openRate}
          />
          <StatCard
            label="Click rate"
            value={formatRate(totalClicked, totalSent)}
            hint={`${formatNumber(totalClicked)} total clicks`}
            icon={<MousePointerClick className="h-4 w-4" />}
            accent="blue"
            tip={TIP.clickRate}
          />
        </div>
      )}


      <div className="mt-6">
        <SectionNote>Suppression overview</SectionNote>
        <div className="mt-3">
          <SuppressionStats isLoading={isLoading} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Quick start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-success/20 bg-success/10 p-4 dark:bg-success/15">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success dark:bg-success/15">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-semibold text-success">
                    {isLoading ? 'Checking workspace…' : 'Workspace ready'}
                  </p>
                  <p className="mt-0.5 text-xs text-success">
                    {isLoading
                      ? 'Loading delivery status.'
                      : `${formatNumber(totalContacts)} contacts imported. Create a campaign when you're ready to send.`}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Need help?</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Link href="/campaigns/new" className="btn-secondary btn-sm w-full">
                  <Plus className="h-3.5 w-3.5" />
                  Campaign
                </Link>
                <Link href="/contacts" className="btn-secondary btn-sm w-full">
                  <Users className="h-3.5 w-3.5" />
                  Contacts
                </Link>
                <Link href="/templates" className="btn-secondary btn-sm w-full">
                  <Mail className="h-3.5 w-3.5" />
                  Templates
                </Link>
              </div>
            </div>

            {totalUnsubs > 0 && (
              <Link
                href="/suppressions"
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-secondary/70"
              >
                <span className="flex items-center gap-2 text-muted-foreground">
                  <ShieldAlert className="h-4 w-4" />
                  {formatNumber(totalUnsubs)} campaign unsubscribe{totalUnsubs === 1 ? '' : 's'}
                </span>
                <span className="font-medium">Review</span>
              </Link>
            )}
          </CardContent>
        </Card>


        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent activity</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Latest campaigns in this workspace</p>
            </div>
            <Link href="/campaigns" className="text-sm font-medium text-foreground hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-5 text-sm text-muted-foreground">Loading campaigns…</p>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={<Mail className="h-8 w-8" />}
                title="No campaigns yet"
                description="Create your first campaign to start tracking performance."
                action={
                  <Link href="/campaigns/new">
                    <Button>
                      <Plus className="h-4 w-4" />
                      New campaign
                    </Button>
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/campaigns/${c.id}/analytics`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/60"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                        <Mail className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.subject}</span>
                      </span>
                      <Badge status={c.status}>{c.status}</Badge>
                      <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                        {formatNumber(c.sentCount)}
                      </span>
                      <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground md:block">
                        {formatRate(c.openedCount, c.sentCount)} opens
                      </span>
                      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground lg:block">
                        {formatDate(c.updatedAt ?? c.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>


      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Unsubscribes by campaign</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={exportUnsubs} disabled={unsubscribedCampaigns.length === 0}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Link href="/suppressions">
              <Button variant="secondary" size="sm">
                <ShieldAlert className="h-4 w-4" />
                View suppressions
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-5 text-sm text-muted-foreground">Loading campaigns…</p>
          ) : unsubscribedCampaigns.length === 0 ? (
            <EmptyState
              icon={<UserMinus className="h-8 w-8" />}
              title="No campaigns sent yet"
              description="Unsubscribes appear here once a campaign has been sent."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead className="border-b border-border">
                  <tr>
                    <th>Campaign</th>
                    <th className="text-right"><span className="inline-flex items-center gap-1">Sent <InfoTip content={TIP.sent} /></span></th>
                    <th className="text-right"><span className="inline-flex items-center gap-1">Delivered <InfoTip content={TIP.delivered} /></span></th>
                    <th className="text-right"><span className="inline-flex items-center gap-1">Unsubscribed <InfoTip content={TIP.unsubscribed} /></span></th>
                    <th className="text-right"><span className="inline-flex items-center gap-1">Unsub rate <InfoTip content={TIP.unsubRate} /></span></th>
                    <th className="text-right"><span className="inline-flex items-center gap-1">Bounced <InfoTip content={TIP.bounced} /></span></th>
                    <th className="text-right"><span className="inline-flex items-center gap-1">Complained <InfoTip content={TIP.complained} /></span></th>
                  </tr>
                </thead>
                <tbody>
                  {unsubscribedCampaigns.map((c) => {
                    const unsubs = c.unsubscribedCount ?? 0;
                    return (
                      <tr key={c.id} className="border-b border-border last:border-0 hover:bg-secondary/60">
                        <td>
                          <Link href={`/campaigns/${c.id}/analytics`} className="font-medium hover:underline">
                            {c.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {c.sentAt ? formatDate(c.sentAt) : '—'}
                          </p>
                        </td>
                        <td className="text-right tabular-nums">{formatNumber(c.sentCount)}</td>
                        <td className="text-right tabular-nums">
                          {formatNumber(c.deliveredCount)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({formatRate(c.deliveredCount, c.sentCount)})
                          </span>
                        </td>
                        <td className="text-right tabular-nums">
                          {unsubs > 0 ? (
                            <span className="font-medium text-destructive">
                              {formatNumber(unsubs)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {unsubs > 0 ? (
                            <span className="font-medium text-destructive">
                              {formatRate(unsubs, c.sentCount)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0%</span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {c.bouncedCount > 0 ? (
                            <span className="font-medium text-warning">
                              {formatNumber(c.bouncedCount)}
                            </span>
                          ) : (
                            formatNumber(c.bouncedCount)
                          )}
                        </td>
                        <td className="text-right tabular-nums text-muted-foreground">
                          {formatNumber(c.complainedCount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

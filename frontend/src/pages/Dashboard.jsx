import { Link } from 'react-router-dom';
import { Mail, Users, MousePointerClick, AlertTriangle, Plus, BarChart3 } from 'lucide-react';
import { useCampaigns } from '../hooks/queries';
import { useContacts } from '../hooks/queries';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, StatCard, StatCardSkeleton, PageHeader } from '../components/ui';
import { formatNumber, formatRate, formatDate } from '../lib/utils';

export default function Dashboard() {
  const { data: campaigns = [], isLoading } = useCampaigns();
  const { data: contacts } = useContacts({ limit: 1 });

  const sent = campaigns.filter((c) => c.status === 'SENT');
  const totalSent = sent.reduce((sum, c) => sum + (c.sentCount ?? 0), 0);
  const totalOpened = sent.reduce((sum, c) => sum + (c.openedCount ?? 0), 0);
  const totalClicked = sent.reduce((sum, c) => sum + (c.clickedCount ?? 0), 0);

  const recent = [...campaigns]
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt) - new Date(a.updatedAt ?? a.createdAt))
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-[1400px] p-6 sm:p-8">
      <PageHeader
        title="Dashboard"
        description="Campaign performance across your Plunk project."
        actions={
          <Link to="/campaigns/new">
            <Button>
              <Plus className="h-4 w-4" />
              New campaign
            </Button>
          </Link>
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
          label="Total contacts"
          value={formatNumber(contacts?.total ?? 0)}
          hint="across your Plunk project"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Emails sent"
          value={formatNumber(totalSent)}
          hint={`${sent.length} completed campaign${sent.length === 1 ? '' : 's'}`}
          icon={<Mail className="h-4 w-4" />}
        />
        <StatCard
          label="Open rate"
          value={formatRate(totalOpened, totalSent)}
          hint={`${formatNumber(totalOpened)} total opens`}
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <StatCard
          label="Click rate"
          value={formatRate(totalClicked, totalSent)}
          hint={`${formatNumber(totalClicked)} total clicks`}
          icon={<MousePointerClick className="h-4 w-4" />}
        />
      </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Recent sends</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading campaigns…</p>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Mail className="h-8 w-8" />}
              title="No campaigns yet"
              description="Create your first campaign to start tracking performance."
              action={
                <Link to="/campaigns/new">
                  <Button>
                    <Plus className="h-4 w-4" />
                    New campaign
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead className="border-b">
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th className="text-right">Sent</th>
                    <th className="text-right">Opens</th>
                    <th className="text-right">Clicks</th>
                    <th className="text-right">Bounces</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td>
                        <Link to={`/campaigns/${c.id}/analytics`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{c.subject}</p>
                      </td>
                      <td>
                        <Badge status={c.status}>{c.status}</Badge>
                      </td>
                      <td className="text-right tabular-nums">{formatNumber(c.sentCount)}</td>
                      <td className="text-right tabular-nums">
                        {formatNumber(c.openedCount)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({formatRate(c.openedCount, c.sentCount)})
                        </span>
                      </td>
                      <td className="text-right tabular-nums">
                        {formatNumber(c.clickedCount)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({formatRate(c.clickedCount, c.sentCount)})
                        </span>
                      </td>
                      <td className="text-right tabular-nums">
                        {c.bouncedCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            {formatNumber(c.bouncedCount)}
                          </span>
                        ) : (
                          formatNumber(c.bouncedCount)
                        )}
                      </td>
                      <td className="text-muted-foreground">{formatDate(c.updatedAt ?? c.createdAt)}</td>
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

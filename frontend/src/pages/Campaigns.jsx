import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { Plus, Mail, Trash2, Copy } from 'lucide-react';
import { useCampaigns } from '../hooks/queries';
import { useDeleteCampaign, useDuplicateCampaign } from '../hooks/mutations';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '../components/ui';
import { formatNumber, formatRate, formatDate } from '../lib/utils';

export default function Campaigns() {
  const { data: campaigns = [], isLoading } = useCampaigns();
  const deleteCampaign = useDeleteCampaign();
  const duplicateCampaign = useDuplicateCampaign();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('ALL');

  const STATUSES = ['ALL', 'DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED'];
  const visible = filter === 'ALL' ? campaigns : campaigns.filter((c) => c.status === filter);

  const onDuplicate = async (campaign) => {
    try {
      const copy = await duplicateCampaign.mutateAsync(campaign.id);
      navigate(`/campaigns/${copy.id}/edit`);
    } catch (err) {
      alert(err.message);
    }
  };

  const onDelete = async (campaign) => {
    if (campaign.status === 'SENDING' || campaign.status === 'SCHEDULED') {
      alert('Cancel the campaign before deleting it.');
      return;
    }
    if (!confirm(`Delete "${campaign.name}"? This removes it from Plunk.`)) return;
    try {
      await deleteCampaign.mutateAsync(campaign.id);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 sm:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">One-off broadcasts to your Plunk audience.</p>
        </div>
        <Link to="/campaigns/new">
          <Button>
            <Plus className="h-4 w-4" />
            New campaign
          </Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
              (filter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-accent')
            }
          >
            {s === 'ALL' ? 'All' : s}
            <span className="ml-1.5 opacity-70">
              {s === 'ALL' ? campaigns.length : campaigns.filter((c) => c.status === s).length}
            </span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{filter === 'ALL' ? 'All campaigns' : filter}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading campaigns…</p>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Mail className="h-8 w-8" />}
              title="No campaigns here"
              description="Create a campaign to send a broadcast to your contacts."
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
                    <th>Audience</th>
                    <th className="text-right">Sent</th>
                    <th className="text-right">Open rate</th>
                    <th className="text-right">Click rate</th>
                    <th>Updated</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td>
                        <Link to={`/campaigns/${c.id}/analytics`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <p className="max-w-xs truncate text-xs text-muted-foreground">{c.subject}</p>
                      </td>
                      <td>
                        <Badge status={c.status}>{c.status}</Badge>
                      </td>
                      <td className="text-muted-foreground">{c.audienceType ?? 'ALL'}</td>
                      <td className="text-right tabular-nums">{formatNumber(c.sentCount)}</td>
                      <td className="text-right tabular-nums">{formatRate(c.openedCount, c.sentCount)}</td>
                      <td className="text-right tabular-nums">{formatRate(c.clickedCount, c.sentCount)}</td>
                      <td className="text-muted-foreground">{formatDate(c.updatedAt ?? c.createdAt)}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => onDuplicate(c)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label="Duplicate campaign"
                            title="Duplicate as new draft"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          {['DRAFT', 'FAILED'].includes(c.status) && (
                            <button
                              onClick={() => onDelete(c)}
                              className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label="Delete campaign"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
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

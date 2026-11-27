import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Mail, Trash2, Copy, Search, Users, MoreHorizontal, Pencil } from '../components/ui/icons';
import { useCampaigns } from '../hooks/queries';
import { useDeleteCampaign, useDuplicateCampaign } from '../hooks/mutations';
import { Badge, Button, Card, EmptyState, SearchInput } from '../components/ui';
import { formatNumber, formatRate, formatDate, cn } from '../lib/utils';

const STATUSES = ['ALL', 'DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED'];

function CampaignCard({ campaign: c, onDuplicate, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const sent = c.status === 'SENT';

  return (
    <Card className="relative transition-shadow hover:shadow-md">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/campaigns/${c.id}/analytics`}
            className="min-w-0 text-sm font-semibold text-foreground hover:underline"
          >
            {c.name}
          </Link>
          <Badge status={c.status}>{c.status === 'DRAFT' ? 'Draft' : c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{c.subject}</p>

        {sent ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{formatNumber(c.sentCount)}</span> sent
            </span>
            <span>
              <span className="font-semibold text-foreground">{formatRate(c.openedCount, c.sentCount)}</span> opened
            </span>
            <span>
              <span className="font-semibold text-foreground">{formatRate(c.clickedCount, c.sentCount)}</span> clicked
            </span>
          </div>
        ) : (
          <div className="mt-3" />
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span className="truncate">{c.audienceType ?? 'ALL'}</span>
        <span className="text-border">·</span>
        <span className="truncate">
          {sent ? `Sent ${formatDate(c.sentAt ?? c.updatedAt ?? c.createdAt)}` : `Updated ${formatDate(c.updatedAt ?? c.createdAt)}`}
        </span>
        <span className="flex-1" />
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Campaign actions"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-20 w-44 rounded-xl border border-border bg-card p-1.5 shadow-lg animate-fade-rise">
                <Link
                  href={`/campaigns/${c.id}/edit`}
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-secondary/70"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Link>
                <button
                  onClick={() => { setMenuOpen(false); onDuplicate(c); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-secondary/70"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate
                </button>
                {['DRAFT', 'FAILED'].includes(c.status) && (
                  <button
                    onClick={() => { setMenuOpen(false); onDelete(c); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Campaigns() {
  const { data: campaigns = [], isLoading } = useCampaigns();
  const deleteCampaign = useDeleteCampaign();
  const duplicateCampaign = useDuplicateCampaign();
  const router = useRouter();
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const statusMatch = (c) => filter === 'ALL' || c.status === filter;
  const searchMatch = (c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (c.name || '').toLowerCase().includes(q) || (c.subject || '').toLowerCase().includes(q);
  };
  const visible = campaigns.filter((c) => statusMatch(c) && searchMatch(c));

  const onDuplicate = async (campaign) => {
    try {
      const copy = await duplicateCampaign.mutateAsync(campaign.id);
      router.push(`/campaigns/${copy.id}/edit`);
    } catch (err) {
      alert(err.message);
    }
  };

  const onDelete = async (campaign) => {
    if (campaign.status === 'SENDING' || campaign.status === 'SCHEDULED') {
      alert('Cancel the campaign before deleting it.');
      return;
    }
    if (!confirm(`Delete "${campaign.name}"?`)) return;
    try {
      await deleteCampaign.mutateAsync(campaign.id);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Campaigns for the selected audience. {campaigns.length} total
          </p>
        </div>
        <Link href="/campaigns/new">
          <Button>
            <Plus className="h-4 w-4" />
            New campaign
          </Button>
        </Link>
      </div>


      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          icon={<Search className="h-4 w-4" />}
          placeholder="Search campaigns..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md flex-1"
        />
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                'btn-secondary h-9 rounded-lg px-3 text-xs font-medium',
                filter === s && 'bg-secondary text-foreground',
              )}
            >
              {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
              <span className="ml-0.5 opacity-60">
                {s === 'ALL' ? campaigns.length : campaigns.filter((c) => c.status === s).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-5">
              <div className="skeleton mb-2 h-4 w-2/3" />
              <div className="skeleton mb-4 h-3 w-full" />
              <div className="skeleton h-3 w-1/2" />
            </Card>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Mail className="h-8 w-8" />}
            title="No campaigns here"
            description="Create a campaign to send a broadcast to your contacts."
            action={
              <Link href="/campaigns/new">
                <Button>
                  <Plus className="h-4 w-4" />
                  New campaign
                </Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((c) => (
            <CampaignCard key={c.id} campaign={c} onDuplicate={onDuplicate} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

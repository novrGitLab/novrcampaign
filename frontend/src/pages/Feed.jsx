import { useMemo, useState } from 'react';
import { Rss, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { Button, EmptyState, PageHeader, PillButton, WeekNavigator } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import FeedEntryRow from '../components/feed/FeedEntryRow';
import FeedEntryFormModal from '../components/feed/FeedEntryFormModal';
import { useFeedEntries } from '../hooks/queries';
import { useCreateFeedEntry, useDeleteFeedEntry, useUpdateFeedEntry } from '../hooks/mutations';
import { addWeeks, weekLabel, weekStartIso } from '../lib/feedWeek';

// Group entries by their Lagos-local calendar day, newest first.
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST
function lagosDayKey(iso) {
  const d = new Date(new Date(iso).getTime() + LAGOS_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

function groupByDay(entries) {
  const byDay = new Map();
  for (const e of entries) {
    const key = lagosDayKey(e.publishedAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)),
    }));
}

const dayLabel = (isoDateKey) => {
  const d = new Date(isoDateKey + 'T12:00:00Z');
  return format(d, 'EEEE d MMMM');
};

export default function Feed() {
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [status, setStatus] = useState('all');
  const [sourceType, setSourceType] = useState('all');
  const [query, setQuery] = useState('');

  const { data, isLoading } = useFeedEntries({
    weekStart: weekStartIso(weekAnchor),
    status: status === 'all' ? undefined : status,
    sourceType: sourceType === 'all' ? undefined : sourceType,
    q: query.trim() || undefined,
  });
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const label = weekLabel(weekAnchor);

  const groups = useMemo(() => groupByDay(entries), [entries]);

  const createEntry = useCreateFeedEntry();
  const updateEntry = useUpdateFeedEntry();
  const deleteEntry = useDeleteFeedEntry();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const openCreate = () => { setEditing(null); setFormError(null); setModalOpen(true); };
  const openEdit = (entry) => { setEditing(entry); setFormError(null); setModalOpen(true); };

  const onSubmit = async (payload) => {
    setFormError(null);
    try {
      if (editing) {
        await updateEntry.mutateAsync({ id: editing.id, body: payload });
      } else {
        await createEntry.mutateAsync(payload);
      }
      setModalOpen(false);
      setEditing(null);
    } catch (err) {
      setFormError(err.message);
    }
  };

  const onArchive = async (entry) => {
    try {
      await updateEntry.mutateAsync({ id: entry.id, body: { status: 'archived' } });
    } catch (err) {
      window.alert(err.message);
    }
  };

  const onConfirmDelete = async () => {
    try {
      await deleteEntry.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (err) {
      window.alert(err.message);
    }
  };

  const saving = createEntry.isPending || updateEntry.isPending;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-8">
      <PageHeader
        title="Feed"
        description="Record this week's cybersecurity updates and add them to a newsletter."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add update
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <WeekNavigator
          label={label}
          onPrev={() => setWeekAnchor((d) => addWeeks(d, -1))}
          onNext={() => setWeekAnchor((d) => addWeeks(d, 1))}
          onToday={() => setWeekAnchor(new Date())}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or summary…"
          className="input max-w-xs"
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'Draft' },
            { value: 'ready', label: 'Ready' },
            { value: 'archived', label: 'Archived' },
          ].map((s) => (
            <PillButton key={s.value} active={status === s.value} onClick={() => setStatus(s.value)}>
              {s.label}
            </PillButton>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-border" />
        <div className="flex gap-1">
          {[
            { value: 'all', label: 'All sources' },
            { value: 'x', label: 'X' },
            { value: 'news', label: 'News' },
            { value: 'regulator', label: 'Regulator' },
            { value: 'other', label: 'Other' },
          ].map((s) => (
            <PillButton key={s.value} active={sourceType === s.value} onClick={() => setSourceType(s.value)}>
              {s.label}
            </PillButton>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Rss className="h-10 w-10" />}
          title="No updates this week"
          description="Capture the week's X posts, news and regulator notices — a short summary plus a source link."
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add this week's first update
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{dayLabel(g.key)}</h2>
                <span className="text-xs text-muted-foreground">{g.items.length} update{g.items.length === 1 ? '' : 's'}</span>
              </div>
              <div className="space-y-2">
                {g.items.map((entry) => (
                  <FeedEntryRow
                    key={entry.id}
                    entry={entry}
                    onEdit={openEdit}
                    onArchive={onArchive}
                    onDelete={setDeleting}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <FeedEntryFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        entry={editing}
        onSubmit={onSubmit}
        saving={saving}
        error={formError}
      />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this update?"
        description={deleting ? `"${deleting.title}" will be removed. This cannot be undone.` : ''}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" onClick={onConfirmDelete} disabled={deleteEntry.isPending}>
            {deleteEntry.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

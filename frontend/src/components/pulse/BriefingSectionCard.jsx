import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Search, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, Input, Label, Skeleton } from '../ui';
import { Modal } from '../ui/Modal';
import {
  useAttachItem, useAuthorItem, useAvailablePublishItems, useDetachItem,
  useReorderItems, useUpdateSection,
} from '../../hooks/briefingQueries';

// ── Vocabulary ────────────────────────────────────────────────────────────────
// Section states (section.state) → the control's options. Labels are the desk's
// own wording for the four server states (see SECTION_STATES in the controller).
const SECTION_STATE_OPTIONS = [
  { value: 'empty', label: 'Empty' },
  { value: 'awaiting', label: 'Awaiting' },
  { value: 'ready', label: 'Ready' },
  { value: 'no_updates', label: 'No updates' },
];

// Section state → Badge token. Reuses existing badge tokens so no new styles.
const SECTION_STATE_TOKENS = {
  empty: 'DRAFT',
  awaiting: 'SCHEDULED',
  ready: 'READY',
  no_updates: 'ARCHIVED',
};

// Publish-item status (publishItem.status) → readable label + Badge token.
const ITEM_STATUS_LABELS = {
  draft: 'Draft',
  approved: 'Approved',
  published: 'Published',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
const ITEM_STATUS_TOKENS = {
  draft: 'DRAFT',
  approved: 'READY',
  published: 'SENT',
  rejected: 'FAILED',
  withdrawn: 'ARCHIVED',
};

function ItemStatusBadge({ status }) {
  if (!status) return null;
  return <Badge status={ITEM_STATUS_TOKENS[status] || 'DRAFT'}>{ITEM_STATUS_LABELS[status] || status}</Badge>;
}

function SectionStateBadge({ state }) {
  const label = SECTION_STATE_OPTIONS.find((o) => o.value === state)?.label || state;
  return <Badge status={SECTION_STATE_TOKENS[state] || 'DRAFT'}>{label}</Badge>;
}

/** Reorder `items` locally and return the resulting id order. */
function movedIds(items, index, delta) {
  const ids = items.map((i) => i.id);
  const target = index + delta;
  if (target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ── Attach-existing picker modal ──────────────────────────────────────────────
// Lists publish items from GET /api/publish. The endpoint does not expose
// `contentType`, so every available item is shown (never a fabricated filter).
function AttachItemModal({ open, onClose, onAttach, busy }) {
  const [q, setQ] = useState('');
  const { data: items = [], isLoading, isError, error } = useAvailablePublishItems({ limit: 50 });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => (it.body || '').toLowerCase().includes(needle));
  }, [items, q]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Attach an existing item"
      description="Editorial items from the publish desk. Selecting one attaches a link — the item itself is unchanged."
      className="max-w-2xl"
    >
      <div className="mb-3">
        <Label htmlFor="attach-search">Search body</Label>
        <Input
          id="attach-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by body text…"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="py-6 text-center text-sm text-destructive">
          Could not load publish items: {error?.message}
        </p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="No publish items"
          description="There are no matching items available to attach."
        />
      ) : (
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {filtered.map((it) => (
            <li
              key={it.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Pillar {it.functionId}</span>
                  <ItemStatusBadge status={it.status} />
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{it.body}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => onAttach(it.id)}
              >
                Attach
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ── One section card (01–08) ──────────────────────────────────────────────────
export default function BriefingSectionCard({ briefingId, section, index, onError }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(section.note ?? '');
  const [draft, setDraft] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);

  const updateSection = useUpdateSection(briefingId, section.functionId);
  const attachItem = useAttachItem(briefingId, section.functionId);
  const detachItem = useDetachItem(briefingId, section.functionId);
  const reorderItems = useReorderItems(briefingId, section.functionId);
  const authorItem = useAuthorItem(briefingId, section.functionId);

  const busy =
    updateSection.isPending ||
    attachItem.isPending ||
    detachItem.isPending ||
    reorderItems.isPending ||
    authorItem.isPending;

  const run = async (fn) => {
    onError?.(null);
    try {
      await fn();
    } catch (err) {
      onError?.(err.message);
    }
  };

  const onStateChange = (state) => run(() => updateSection.mutateAsync({ body: { state } }));
  const onSaveNote = () => run(() => updateSection.mutateAsync({ body: { note } }));
  const onAdd = async () => {
    const body = draft.trim();
    if (!body) return;
    await run(() => authorItem.mutateAsync({ body }));
    setDraft('');
  };
  const onAttach = async (publishItemId) => {
    await run(() => attachItem.mutateAsync({ publishItemId }));
    setAttachOpen(false);
  };
  const onDetach = (itemId) => run(() => detachItem.mutateAsync({ itemId }));
  const onMove = (i, delta) => {
    const ids = movedIds(section.items, i, delta);
    if (!ids) return;
    return run(() => reorderItems.mutateAsync({ itemIds: ids }));
  };

  const number = String(index + 1).padStart(2, '0');

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">{number}</span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{section.label}</h2>
        <SectionStateBadge state={section.state} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {section.itemCount} item{section.itemCount === 1 ? '' : 's'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          {/* State control */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${section.label} state`}>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">State</span>
            {SECTION_STATE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={section.state === opt.value ? 'primary' : 'secondary'}
                aria-pressed={section.state === opt.value}
                disabled={busy}
                onClick={() => onStateChange(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          {/* Items */}
          {section.items.length === 0 ? (
            <EmptyState
              icon={<Plus className="h-8 w-8" />}
              title="No items in this section"
              description="Author new content below, or attach an existing publish item."
            />
          ) : (
            <ul className="space-y-2">
              {section.items.map((item, i) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">#{i + 1}</span>
                      {item.publishItem && <ItemStatusBadge status={item.publishItem.status} />}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {item.publishItem?.bodyPreview || 'No preview available.'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label="Move item up"
                      disabled={busy || i === 0}
                      onClick={() => onMove(i, -1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label="Move item down"
                      disabled={busy || i === section.items.length - 1}
                      onClick={() => onMove(i, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove item"
                      disabled={busy}
                      onClick={() => onDetach(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Author new */}
          <div>
            <Label htmlFor={`author-${section.id}`}>Author new content</Label>
            <textarea
              id={`author-${section.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              placeholder="Write this section's content…"
              className="input mt-1 w-full text-sm"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                AI drafting arrives later — this records a manual draft item.
              </p>
              <Button size="sm" disabled={busy || !draft.trim()} onClick={onAdd}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </div>

          {/* Attach existing */}
          <div>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAttachOpen(true)}>
              Attach existing item
            </Button>
          </div>

          {/* Note */}
          <div>
            <Label htmlFor={`note-${section.id}`}>Note</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id={`note-${section.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for this section…"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || note === (section.note ?? '')}
                onClick={onSaveNote}
              >
                Save note
              </Button>
            </div>
          </div>
        </div>
      )}

      <AttachItemModal
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onAttach={onAttach}
        busy={busy}
      />
    </section>
  );
}

export { SECTION_STATE_OPTIONS, SECTION_STATE_TOKENS, ITEM_STATUS_TOKENS, ITEM_STATUS_LABELS, ItemStatusBadge };

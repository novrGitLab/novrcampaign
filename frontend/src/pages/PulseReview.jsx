import { useMemo, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight, ExternalLink, Pencil, Radio, RefreshCw, Search } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Badge, Button, EmptyState, InfoTip, PageHeader, PillButton, SearchInput, Skeleton,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { usePulseEvents, usePulseEvent } from '../hooks/queries';
import { useApprovePublish, useEditPublish, useProjectF7, useRejectPublish, useReviewPulseEvent } from '../hooks/mutations';

// ── Lagos-day helpers (kept identical to Feed.jsx so both screens agree) ──────
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST
function lagosDayKey(iso) {
  const d = new Date(new Date(iso).getTime() + LAGOS_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

/** Lagos-local day key (YYYY-MM-DD) for "now". */
function lagosTodayKey() {
  return lagosDayKey(new Date().toISOString());
}

/** Add `days` to a Lagos day key, returning another key. */
function shiftDayKey(key, days) {
  return lagosDayKey(new Date(`${key}T12:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000);
}

const dayLabel = (isoDateKey) => format(new Date(`${isoDateKey}T12:00:00Z`), 'EEEE d MMMM yyyy');

// ── Filter vocabularies ───────────────────────────────────────────────────────
// Pillar = the NovrPulse "function" column (1–8). Always show the human name,
// never "F1"; the number is only what we send to the API as `function`.
const PILLAR_OPTIONS = [
  { value: '', label: 'All pillars' },
  { value: 1, label: 'Regulatory Impact' },
  { value: 2, label: 'Forum Topic' },
  { value: 3, label: 'Public Education' },
  { value: 4, label: 'Cyber Hygiene' },
  { value: 5, label: 'Events' },
  { value: 6, label: 'Outreach' },
  { value: 7, label: 'Breaking News' },
  { value: 8, label: 'CyberIntel' },
];
const PILLAR_LABELS = Object.fromEntries(
  PILLAR_OPTIONS.filter((o) => o.value !== '').map((o) => [o.value, o.label]),
);

// Region filter: friendly label → API code. "All" sends no region param.
const REGION_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'AF', label: 'Africa' },
  { value: 'GLOBAL', label: 'Global' },
];

// Review status filter: the persisted triage state. "All" sends no param.
const REVIEW_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'dismissed', label: 'Dismissed' },
];

function relativeTime(iso) {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

// Derived publish-draft status → Badge status token + readable label.
const PUBLISH_STATUS_LABELS = {
  draft: 'Draft',
  approved: 'Approved',
  published: 'Published',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
const PUBLISH_STATUS_TOKENS = {
  draft: 'DRAFT',
  approved: 'READY',
  published: 'SENT',
  rejected: 'FAILED',
  withdrawn: 'ARCHIVED',
};

// ── Small presentational pieces ───────────────────────────────────────────────
function PublishStatusBadge({ status }) {
  if (!status) return null;
  return <Badge status={PUBLISH_STATUS_TOKENS[status] || 'DRAFT'}>{PUBLISH_STATUS_LABELS[status] || status}</Badge>;
}

/** Human-named pillar chips (the API `functions` array holds 1–8). */
function PillarChips({ functions }) {
  if (!Array.isArray(functions) || functions.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {functions.map((f) => (
        <span
          key={f}
          className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {PILLAR_LABELS[f] || `Pillar ${f}`}
        </span>
      ))}
    </span>
  );
}

function ExpandableText({ text, lines = 2, className }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  return (
    <div className={className}>
      <p className={expanded ? 'text-sm text-muted-foreground' : `line-clamp-${lines} text-sm text-muted-foreground`}>
        {text}
      </p>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="mt-1 text-xs font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}

/**
 * Card-level triage actions. "Review" selects the card; "Accept"/"Dismiss"
 * persist the review status via the review endpoint (see `onAccept`/`onDismiss`
 * in the page). `reviewStatus` is the event's persisted state.
 */
function CardActions({ item, reviewStatus, reviewBusy, onReview, onAccept, onDismiss }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={(e) => { e.stopPropagation(); onReview(item.id); }}
      >
        Review
      </Button>
      <Button
        variant={reviewStatus === 'accepted' ? 'primary' : 'secondary'}
        size="sm"
        aria-pressed={reviewStatus === 'accepted'}
        disabled={reviewBusy}
        onClick={(e) => { e.stopPropagation(); onAccept(item.id); }}
      >
        Accept
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={reviewStatus === 'dismissed'}
        disabled={reviewBusy}
        onClick={(e) => { e.stopPropagation(); onDismiss(item.id); }}
      >
        Dismiss
      </Button>
    </div>
  );
}

/**
 * Real publish-draft controls for an event that has an F7 draft. These call the
 * existing approve / reject / edit endpoints (unlike Accept/Dismiss above).
 */
function DraftActions({ draftId, onApprove, onReject, onEdit, onDraftF7, busy, drafting }) {
  if (!draftId) {
    return (
      <div>
        <p className="text-xs text-muted-foreground">
          No publish draft yet — create an F7 draft to approve, edit or reject.
        </p>
        <Button variant="secondary" size="sm" className="mt-2" disabled={drafting} onClick={onDraftF7}>
          <Radio className="h-3.5 w-3.5" />
          {drafting ? 'Drafting…' : 'Draft F7'}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" size="sm" disabled={busy} onClick={() => onApprove(draftId)}>
        Approve draft
      </Button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
      <Button variant="danger" size="sm" disabled={busy} onClick={() => onReject(draftId)}>
        Reject draft
      </Button>
    </div>
  );
}

// ── One intel card ────────────────────────────────────────────────────────────
function IntelCard({ item, selected, reviewBusy, busy, onSelect, onAccept, onDismiss, onApproveDraft, onRejectDraft, onEditDraft }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(item.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      onKeyDown={handleKeyDown}
      className={
        `cursor-pointer rounded-lg border bg-card px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ` +
        (selected ? 'border-brand-purple ring-1 ring-brand-purple/40' : 'border-border hover:bg-secondary/40')
      }
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        {/* TODO: cluster rollup when the API exposes it — show the real single source only. */}
        {item.sourceName && <span className="text-xs text-muted-foreground">{item.sourceName}</span>}
        {item.sourceName && item.publishedAt && <span className="text-xs text-muted-foreground">·</span>}
        <span className="text-xs text-muted-foreground">{relativeTime(item.publishedAt)}</span>
        {item.eventType && (
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {item.eventType}
          </span>
        )}
        <PublishStatusBadge status={item.publishStatus} />
        {item.reviewStatus && item.reviewStatus !== 'new' && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {item.reviewStatus === 'accepted' ? 'Accepted' : 'Dismissed'}
          </span>
        )}
        <PillarChips functions={item.functions} />
      </div>

      <div className="flex items-start gap-2">
        {item.canonicalUrl ? (
          <a
            href={item.canonicalUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-brand-blue hover:underline"
          >
            {item.title}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          <p className="text-sm font-medium text-foreground">{item.title}</p>
        )}
      </div>

      {item.summary && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.summary}</p>}

      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <CardActions
          item={item}
          reviewStatus={item.reviewStatus}
          reviewBusy={reviewBusy}
          onReview={onSelect}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
        {item.publishItemId && (
          <div className="mt-2">
            <DraftActions
              draftId={item.publishItemId}
              busy={busy}
              onApprove={onApproveDraft}
              onReject={onRejectDraft}
              onEdit={() => onEditDraft(item)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detail panel (local component) ────────────────────────────────────────────
function DetailPanel({ selectedId, detail, detailLoading, detailError, detailErr, busy, onApproveDraft, onRejectDraft, onEditDraft, onDraftF7, drafting }) {
  if (!selectedId) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        Select an item to see its sources, entities and full text.
      </div>
    );
  }
  if (detailLoading) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }
  if (detailError) {
    return (
      <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-destructive">
        Could not load detail: {detailErr?.message}
      </p>
    );
  }
  if (!detail) return null;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{detail.title}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <PublishStatusBadge status={detail.publishStatus} />
          {detail.canonicalUrl && (
            <a
              href={detail.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open source
            </a>
          )}
        </div>
      </div>

      <ExpandableText text={detail.summary} lines={3} />

      {detail.whatItMeans && (
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">What it means</h3>
          <ExpandableText text={detail.whatItMeans} lines={3} />
        </div>
      )}

      {detail.sources?.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Sources</h3>
          <ul className="space-y-1">
            {detail.sources.map((s, i) => (
              <li key={`${s.url}-${i}`} className="text-xs text-muted-foreground">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-brand-blue hover:underline">
                    {s.sourceName || s.url}
                  </a>
                ) : (
                  s.sourceName || 'Unknown source'
                )}
                {s.licence && <span className="ml-1">({s.licence})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.entities?.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Entities</h3>
          <ul className="flex flex-wrap gap-1">
            {detail.entities.map((e, i) => (
              <li
                key={`${e.name}-${i}`}
                className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <span className="font-medium text-foreground">{e.name}</span>
                {e.type && <span>· {e.type}</span>}
                {e.role && <span>· {e.role}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.functions?.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Pillars</h3>
          <PillarChips functions={detail.functions} />
        </div>
      )}

      <div className="border-t border-border pt-3">
        <h3 className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Publish draft
          <InfoTip content="Approving, editing and rejecting operate on the real F7 publish draft. Review Accept/Dismiss on the cards persists the event's review status." />
        </h3>
        <DraftActions
          draftId={detail.publishItemId}
          busy={busy}
          onApprove={onApproveDraft}
          onReject={onRejectDraft}
          onEdit={() => onEditDraft(detail)}
          onDraftF7={onDraftF7}
          drafting={drafting}
        />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PulseReview() {
  const [dayKey, setDayKey] = useState(lagosTodayKey);
  const [query, setQuery] = useState('');
  // Filters are independent; each control owns its own state and all selected
  // values are forwarded together to usePulseEvents (server ANDs them). Any two
  // (or more) can be combined: Pillar + Region, Region + Review status, etc.
  const [pillar, setPillar] = useState('');
  const [region, setRegion] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  // The events API has no `date` param: fetch a wide page and filter to the
  // selected Lagos day client-side (see dayKey derivation above).
  const { data, isLoading, isError, error, refetch, isFetching } = usePulseEvents({
    pageSize: 100,
    q: query.trim() || undefined,
    function: pillar || undefined,
    region: region || undefined,
    reviewStatus: reviewStatus || undefined,
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  const dayItems = useMemo(() => {
    return items
      .filter((e) => e.publishedAt && lagosDayKey(e.publishedAt) === dayKey)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }, [items, dayKey]);

  const { data: detail, isLoading: detailLoading, isError: detailError, error: detailErr } = usePulseEvent(selectedId);

  const approve = useApprovePublish();
  const reject = useRejectPublish();
  const edit = useEditPublish();
  const projectF7 = useProjectF7();
  const review = useReviewPulseEvent();

  const [editing, setEditing] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  const isToday = dayKey === lagosTodayKey();
  const busy = approve.isPending || reject.isPending || edit.isPending;

  const runAction = async (fn, ...args) => {
    setActionError(null);
    setNotice(null);
    try {
      await fn(...args);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const onApproveDraft = (id) => runAction(approve.mutateAsync, id);
  const onRejectDraft = (id) => runAction(reject.mutateAsync, id);
  const onEditDraft = (item) => { setEditing(item); setEditBody(''); };

  // Accept/Dismiss: persist the review status server-side (optimistic in the
  // mutation). Dismiss is non-destructive — it only records the decision.
  const onAccept = (id) => runAction(review.mutateAsync, { id, status: 'accepted' });
  const onDismiss = (id) => runAction(review.mutateAsync, { id, status: 'dismissed' });

  const onSaveEdit = async () => {
    if (!editBody.trim()) return;
    await runAction(edit.mutateAsync, { id: editing.publishItemId, body: editBody.trim() });
    setEditing(null);
  };

  const onDraftF7 = async () => {
    setActionError(null);
    setNotice(null);
    try {
      const result = await projectF7.mutateAsync({});
      setNotice(
        result?.mode === 'dry-run'
          ? `Dry run: ${result.created ?? 0} item(s) would be created.`
          : `Created ${result.created ?? 0} draft item(s).`,
      );
      await refetch();
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-8">
      <PageHeader
        title="Intelligence Inbox"
        description="The day's collected intel from NovrPulse — review, accept, dismiss."
        actions={
          <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {/* Day navigation + search */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => setDayKey((k) => shiftDayKey(k, -1))} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="min-w-[200px] text-center text-sm font-medium tabular-nums text-foreground"
            aria-live="polite"
          >
            {isToday ? `Today · ${dayLabel(dayKey)}` : dayLabel(dayKey)}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setDayKey((k) => shiftDayKey(k, 1))} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDayKey(lagosTodayKey())}>
            Today
          </Button>
        </div>
        <SearchInput
          icon={<Search className="h-4 w-4" />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title…"
          aria-label="Search intel by title"
          className="max-w-xs"
        />
      </div>

      {/* Filter bar: pillar · review status · region — each independent; any
          combination is ANDed server-side (e.g. Pillar + Region). */}
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter intel">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by pillar">
          {PILLAR_OPTIONS.map((opt) => (
            <PillButton
              key={opt.value || 'all'}
              active={pillar === opt.value}
              aria-pressed={pillar === opt.value}
              onClick={() => setPillar(opt.value)}
            >
              {opt.label}
            </PillButton>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-border" />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by review status">
          {REVIEW_OPTIONS.map((opt) => (
            <PillButton
              key={opt.value || 'all'}
              active={reviewStatus === opt.value}
              aria-pressed={reviewStatus === opt.value}
              onClick={() => setReviewStatus(opt.value)}
            >
              {opt.label}
            </PillButton>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-border" />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by region">
          {REGION_OPTIONS.map((opt) => (
            <PillButton
              key={opt.value || 'all'}
              active={region === opt.value}
              aria-pressed={region === opt.value}
              onClick={() => setRegion(opt.value)}
            >
              {opt.label}
            </PillButton>
          ))}
        </div>
      </div>

      {actionError && (
        <p className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError}</p>
      )}
      {notice && (
        <p className="mb-4 rounded-md bg-secondary px-4 py-3 text-sm text-muted-foreground">{notice}</p>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border bg-card px-4 py-3">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ) : isError ? (
        <div className="py-16 text-center">
          <p className="mb-3 text-sm text-destructive">Could not load intel: {error?.message}</p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      ) : dayItems.length === 0 ? (
        <EmptyState
          icon={<Radio className="h-10 w-10" />}
          title="No intel for this day"
          description="Nothing matches this day and filter set. Try another day, clear a filter, or refresh."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Card list */}
          <div className="space-y-2">
            {dayItems.map((item) => (
              <IntelCard
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                reviewBusy={review.isPending}
                busy={busy}
                onSelect={setSelectedId}
                onAccept={onAccept}
                onDismiss={onDismiss}
                onApproveDraft={onApproveDraft}
                onRejectDraft={onRejectDraft}
                onEditDraft={onEditDraft}
              />
            ))}
          </div>

          {/* Detail panel */}
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <DetailPanel
              selectedId={selectedId}
              detail={detail}
              detailLoading={detailLoading}
              detailError={detailError}
              detailErr={detailErr}
              busy={busy}
              onApproveDraft={onApproveDraft}
              onRejectDraft={onRejectDraft}
              onEditDraft={onEditDraft}
              onDraftF7={onDraftF7}
              drafting={projectF7.isPending}
            />
          </aside>
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit draft body"
        description="Edits the publish item body only. Approval is a separate sign-off."
        className="max-w-xl"
      >
        <div className="space-y-4">
          <label htmlFor="pulse-edit-body" className="label">Body</label>
          <textarea
            id="pulse-edit-body"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={10}
            placeholder="Draft body…"
            className="input min-h-[12rem] w-full font-mono text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={onSaveEdit} disabled={!editBody.trim() || edit.isPending}>
              {edit.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      <p className="mt-8 flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <Activity className="h-3 w-3" />
        Intel filtered by Lagos calendar day · {dayItems.length} item{dayItems.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}

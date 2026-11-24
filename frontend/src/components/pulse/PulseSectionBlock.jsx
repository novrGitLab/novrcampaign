import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Search, Star, X } from 'lucide-react';
import { Button, EmptyState, Input, Skeleton } from '../ui';
import { Modal } from '../ui/Modal';
import { pillarLabel } from '../../lib/pillars';
import {
  useAttachItem, useAvailablePublishItems, useDetachItem,
  useReorderItems, useUpdateSection,
} from '../../hooks/briefingQueries';
import {
  NEWS_DERIVED_PILLARS, sectionGlyph, sectionJob,
  sectionLabel, sectionNumber, sectionStatePill,
} from './pulseNewsletter';
import PulseSuggestRow from './PulseSuggestRow';

// Section states (section.state) → the control's options, matching SECTION_STATES
// in the backend controller.
const SECTION_STATE_OPTIONS = [
  { value: 'empty', label: 'Empty' },
  { value: 'awaiting', label: 'Awaiting' },
  { value: 'ready', label: 'Ready' },
  { value: 'no_updates', label: 'No updates' },
];

/** Reorder `items` locally and return the resulting id order. */
function movedIds(items, index, delta) {
  const ids = items.map((i) => i.id);
  const target = index + delta;
  if (target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Attach-existing picker, ported from the old BriefingSectionCard. Lists publish
 * items from GET /api/publish?usableForDesk=true (the server filters to items
 * usable in a briefing). Section-aware: DEFAULTS to items whose `functionId`
 * matches this section, since a section is one pillar. "Show all pillars"
 * overrides for the rare cross-pillar case.
 */
function AttachItemModal({ open, onClose, onAttach, busy, sectionFunctionId }) {
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const { data: items = [], isLoading, isError, error } = useAvailablePublishItems({ limit: 50 });

  const sectionLabelText = pillarLabel(sectionFunctionId);

  const matchingCount = useMemo(
    () => items.filter((it) => it.functionId === sectionFunctionId).length,
    [items, sectionFunctionId],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (!showAll && it.functionId !== sectionFunctionId) return false;
      if (!needle) return true;
      const pillarMatch = pillarLabel(it.functionId).toLowerCase().includes(needle);
      return (it.body || '').toLowerCase().includes(needle) || pillarMatch;
    });
  }, [items, q, showAll, sectionFunctionId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Attach an existing item"
      description="Accepted items from the Intelligence Inbox, plus manually authored items. Selecting one attaches a link — the item itself is unchanged."
      className="max-w-2xl"
    >
      <div className="mb-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {showAll
              ? 'Showing all pillars.'
              : <>Matching this pillar: <span className="font-medium text-foreground">{sectionLabelText}</span></>}
          </p>
          <Button
            size="sm"
            variant={showAll ? 'primary' : 'secondary'}
            aria-pressed={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? 'Matching my pillar only' : 'Show all pillars'}
          </Button>
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by body text or pillar…"
          aria-label="Search body or pillar"
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
          title={!showAll && matchingCount === 0 ? `No ${sectionLabelText} items yet` : 'No publish items'}
          description={
            !showAll && matchingCount === 0
              ? 'Nothing usable matches this section’s pillar. Write one in the Inbox, or use "Show all pillars" to attach a different pillar’s item.'
              : 'There are no matching items available to attach.'
          }
        />
      ) : (
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {filtered.map((it) => (
            <li
              key={it.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="mb-1 text-xs font-medium text-foreground">{pillarLabel(it.functionId)}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{it.body || 'No preview available.'}</p>
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAttach(it.id)}>
                Attach
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Human-readable label for an attached item's publish-item summary. */
function itemPreview(item) {
  return item.publishItem?.bodyPreview || 'No preview available.';
}

/**
 * One newsletter section block in The Front Page skeleton: two-digit number +
 * pillar name, status pill, slotted story cards, and — when expanded — the state
 * control, note, item reorder/remove and "Attach existing".
 *
 * The block is a drop target for the unassigned-drafts tray: when a chip is
 * selected (`armedChipId`), clicking the block attaches that item to this
 * section (via the existing attach mutation) and reports back with `onPlaced`.
 */
export default function PulseSectionBlock({
  briefingId, section, armedChipId, onPlaced, onError,
  suggestions = [], onCreateItemFromSuggestion, onDismissSuggestion,
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(section.note ?? '');
  const [attachOpen, setAttachOpen] = useState(false);
  // The suggestion being assigned here, held locally so the chip stays busy
  // through BOTH steps (parent create → this block's attach).
  const [assigningSuggestionId, setAssigningSuggestionId] = useState(null);

  const updateSection = useUpdateSection(briefingId, section.functionId);
  const attachItem = useAttachItem(briefingId, section.functionId);
  const detachItem = useDetachItem(briefingId, section.functionId);
  const reorderItems = useReorderItems(briefingId, section.functionId);

  const busy = updateSection.isPending || attachItem.isPending || detachItem.isPending || reorderItems.isPending;

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
  const onAttach = async (publishItemId) => {
    await run(() => attachItem.mutateAsync({ publishItemId }));
    setAttachOpen(false);
  };
  const onDetach = (itemId) => run(() => detachItem.mutateAsync({ itemId }));
  const onMove = (i, delta) => {
    const ids = movedIds(section.items, i, delta);
    if (!ids) return undefined;
    return run(() => reorderItems.mutateAsync({ itemIds: ids }));
  };

  /**
   * Assign a suggested story into this section. The two-step real flow:
   *   1. the PARENT creates a publish item from the event for this pillar
   *      (it owns the create mutation, shared across sections);
   *   2. this block attaches the created item to its own section (its attach
   *      hook is bound to `section.functionId`, so the binding is correct).
   * On success the section re-fetches (the attach mutation replaces it), it is
   * no longer empty, and the suggestion row unmounts.
   */
  const onAssignSuggestion = async (suggestion) => {
    onError?.(null);
    setAssigningSuggestionId(suggestion.id);
    let item = null;
    try {
      item = await onCreateItemFromSuggestion?.(suggestion, section.functionId);
      if (!item?.id) return;
      await attachItem.mutateAsync({ publishItemId: item.id });
    } catch (err) {
      // If the item was already created but the attach failed, the orphan draft
      // is real and recoverable: name that, so the editor knows where to find it
      // instead of re-creating a duplicate.
      onError?.(
        item?.id
          ? `Draft created but not attached — ${err.message} Find it in Unassigned drafts below.`
          : err.message,
      );
    } finally {
      setAssigningSuggestionId(null);
    }
  };

  const number = sectionNumber(section.functionId);
  const pill = sectionStatePill(section.state);
  const isNewsDerived = NEWS_DERIVED_PILLARS.includes(section.functionId);
  const armed = Boolean(armedChipId) && !busy;

  const onBlockClick = (e) => {
    // A click on an interactive control (button/link/input) is not a drop.
    if (e.target.closest('button, a, input, textarea, select, [role="button"]')) return;
    if (armed) {
      onAttach(armedChipId).then(() => onPlaced?.());
      return;
    }
    setExpanded((v) => !v);
  };

  return (
    <section
      className={
        'border-b border-border px-5 py-5 transition-colors last:border-b-0 ' +
        (armed ? 'cursor-pointer hover:bg-black/10' : '')
      }
      onClick={onBlockClick}
    >
      <div className="grid grid-cols-[44px_1fr] gap-4">
        <div className="pt-0.5 font-mono text-[15px] font-bold text-muted-foreground">{number}</div>
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[15.5px] font-bold text-foreground">
              <span aria-hidden="true" className="text-muted-foreground">{sectionGlyph(section.functionId)}</span>
              {sectionLabel(section.functionId)}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide st-${pill.tone}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {pill.label}
            </span>
            {armed && <span className="text-[11px] font-semibold text-primary">Place selected draft here</span>}
          </div>
          <p className="mb-3 text-[12.5px] text-muted-foreground">{sectionJob(section.functionId)}</p>

          {/* Slotted story cards */}
          {section.items.length > 0 ? (
            <ul className="space-y-2">
              {section.items.map((item, i) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3.5 rounded-[10px] border border-[color:var(--pulse-border-hi)] bg-secondary px-3.5 py-3"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--pulse-border-hi)] bg-background text-lg">
                    {sectionGlyph(section.functionId)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-[15px] font-bold text-foreground">{itemPreview(item)}</p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {item.publishItem?.status ? `${item.publishItem.status} · ` : ''}item #{i + 1}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" aria-label="Move item up" disabled={busy || i === 0} onClick={() => onMove(i, -1)}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label="Move item down" disabled={busy || i === section.items.length - 1} onClick={() => onMove(i, 1)}>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label="Remove item" disabled={busy} onClick={() => onDetach(item.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-[10px] border border-dashed border-[color:var(--pulse-border-hi)] px-3.5 py-3 text-[13px] text-muted-foreground">
              {section.state === 'no_updates' ? 'No updates for this section today.' : 'No content slotted yet.'}
            </div>
          )}

          {/* Empty-section next step. The Wire (news) and the Inbox both live at
              /pulse/wire; the wording differs by whether the pillar is fed from
              raw wire material or written fresh. Suppressed when a suggestion
              row is shown, so the two do not offer the same thing twice. */}
          {section.items.length === 0 && suggestions.length === 0 && (
            <a
              href="/pulse/wire"
              onClick={(e) => e.stopPropagation()}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-dashed border-[color:var(--pulse-border-hi)] px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {isNewsDerived
                ? <>Fill from today’s wire <span className="font-bold text-primary">→</span></>
                : <>No content yet — write a piece in the Inbox <span className="font-bold text-primary">→</span></>}
            </a>
          )}

          {/* Suggested-story row (news-derived empty sections only). Derived by
              the Front Page from lib/suggestions.js and passed in as props; the
              row is presentational and reports assign/dismiss upward. */}
          {section.items.length === 0 && (
            <div onClick={(e) => e.stopPropagation()}>
              <PulseSuggestRow
                sectionFunctionId={section.functionId}
                suggestions={suggestions}
                busyId={assigningSuggestionId}
                disabled={busy}
                onAssign={onAssignSuggestion}
                onDismiss={() => onDismissSuggestion?.(section.functionId)}
              />
            </div>
          )}

          {/* Expanded controls */}
          {expanded && (
            <div className="mt-4 space-y-4 border-t border-border pt-4">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${sectionLabel(section.functionId)} state`}>
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

              <div>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAttachOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Attach existing item
                </Button>
              </div>

              <div>
                <label htmlFor={`note-${section.id}`} className="text-[13px] font-medium text-foreground">Note</label>
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
        </div>
      </div>

      {/* ★ Set as lead — front-end-only designation on a slotted story. */}
      {section.items.length > 0 && <LeadToggle />}

      <AttachItemModal
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onAttach={onAttach}
        busy={busy}
        sectionFunctionId={section.functionId}
      />
    </section>
  );
}

/**
 * The `★ Set as lead` control. This is a front-end-only visual toggle: the
 * designation is NOT persisted (the backend has no lead field for a section
 * item), so it lives in local component state and resets on reload.
 */
function LeadToggle() {
  const [lead, setLead] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={lead}
      onClick={(e) => { e.stopPropagation(); setLead((v) => !v); }}
      className={
        'mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-bold tracking-wide transition-colors ' +
        (lead
          ? 'border-amber-600/50 bg-amber-500/10 text-amber-400'
          : 'border-[color:var(--pulse-border-hi)] text-muted-foreground hover:border-primary hover:text-foreground')
      }
      title="Designate this story as the edition lead (visual only — not saved yet)"
    >
      <Star className={'h-3 w-3 ' + (lead ? 'fill-current' : '')} />
      {lead ? 'Lead' : 'Set as lead'}
    </button>
  );
}

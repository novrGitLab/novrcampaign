import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Eye, Plus, RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { Button, EmptyState, Input, Skeleton } from '../components/ui';
import {
  PulseFinalReviewPanel, PulsePreviewModal, PulseSupportingPanel,
} from '../components/pulse/PulsePanels';
import PulseSectionBlock from '../components/pulse/PulseSectionBlock';
import PipelineStepper from '../components/pulse/PipelineStepper';
import { NEWS_DERIVED_PILLARS, itemStatusTone, sectionGlyph } from '../components/pulse/pulseNewsletter';
import { pillarLabel } from '../lib/pillars';
import { suggestForSection } from '../lib/suggestions';
import {
  useAvailablePublishItems, useBriefing, useBriefings,
  useCreateBriefing, useUpdateBriefing,
} from '../hooks/briefingQueries';
import { usePulseEvents } from '../hooks/queries';
import { useCreateItemFromEvent } from '../hooks/mutations';

// ── Lagos-day helpers (kept identical to PulseReview.jsx so both agree) ───────
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST

/** Lagos-local day key (YYYY-MM-DD) for an ISO instant. */
function lagosDayKey(iso) {
  const d = new Date(new Date(iso).getTime() + LAGOS_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

function lagosTodayKey() {
  return lagosDayKey(new Date().toISOString());
}

/** Add `days` to a Lagos day key, returning another key. */
function shiftDayKey(key, days) {
  return lagosDayKey(new Date(`${key}T12:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000);
}

const dayLabel = (isoDateKey) => format(new Date(`${isoDateKey}T12:00:00Z`), 'EEEE d MMMM yyyy');
const shortDayLabel = (isoDateKey) => format(new Date(`${isoDateKey}T12:00:00Z`), 'EEE d MMM yyyy');

// The three lifecycle states the desk may set here (publish is out of scope).
const SETTABLE_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
];

/**
 * One row in the unassigned-drafts tray: a publish item usable for the desk that
 * is NOT yet attached to this briefing (filtered client-side by the parent).
 * `functionId` is the pillar the item was authored for.
 */
function DraftChip({ item, selected, onSelect }) {
  const tone = itemStatusTone(item.status);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      className={
        'mb-2.5 block w-full rounded-[9px] border bg-secondary px-3.5 py-3 text-left transition-all ' +
        (selected
          ? 'border-primary shadow-[0_0_18px_rgba(59,130,246,0.22)]'
          : 'border-border hover:border-[color:var(--pulse-border-hi)]')
      }
    >
      <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        <span className="text-[11px]" aria-hidden="true">{sectionGlyph(item.functionId)}</span>
        {pillarLabel(item.functionId)}
        <span
          className={
            'ml-auto inline-block h-1.5 w-1.5 rounded-full ' +
            (tone === 'ready' ? 'bg-success' : tone === 'none' ? 'bg-[color:var(--pulse-faint)]' : 'bg-warning')
          }
          title={item.status}
        />
      </span>
      <span className="mt-1 block line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
        {item.body || 'Untitled draft'}
      </span>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PulseFrontPage() {
  const [dayKey, setDayKey] = useState(lagosTodayKey);
  const [actionError, setActionError] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [supportingOpen, setSupportingOpen] = useState(false);
  const [finalReviewOpen, setFinalReviewOpen] = useState(false);
  const [selectedChipId, setSelectedChipId] = useState(null);
  // Pillars whose suggestion row the editor dismissed this session (client-only
  // — real reject-with-reason lands with the recommender backend).
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => new Set());

  const { data: briefings = [], isLoading, isError, error, refetch, isFetching } = useBriefings({
    from: dayKey,
    to: dayKey,
  });

  const briefing = useMemo(
    () => briefings.find((b) => (b.briefingDate || '').slice(0, 10) === dayKey) ?? null,
    [briefings, dayKey],
  );

  const { data: detail } = useBriefing(briefing?.id);

  const create = useCreateBriefing();
  const update = useUpdateBriefing(briefing?.id);

  // The unassigned tray: every desk-usable publish item MINUS ids already
  // attached to any section of this briefing (filtered client-side from the
  // section items we already hold). Items live independently; the tray needs no
  // remove affordance — attaching is what clears a chip.
  const { data: publishItems = [] } = useAvailablePublishItems({ limit: 50 });
  const attachedIds = useMemo(() => {
    const ids = new Set();
    for (const s of detail?.sections ?? []) {
      for (const it of s.items ?? []) {
        if (it.publishItemId) ids.add(it.publishItemId);
      }
    }
    return ids;
  }, [detail?.sections]);
  const trayItems = useMemo(
    () => publishItems.filter((it) => !attachedIds.has(it.id)),
    [publishItems, attachedIds],
  );

  // Reconcile a stale chip selection when an item is attached elsewhere.
  useEffect(() => {
    if (selectedChipId && !trayItems.some((it) => it.id === selectedChipId)) {
      setSelectedChipId(null);
    }
  }, [trayItems, selectedChipId]);

  // ── Suggestions (deterministic v1) ─────────────────────────────────────────
  // The wire events the Wire already exposes; the Front Page reads the SAME
  // endpoint. The suggestions themselves come only from lib/suggestions.js, so
  // the future LLM recommender can replace that source without a UI change.
  const { data: wireData } = usePulseEvents({ pageSize: 100 });
  const wireEvents = useMemo(() => wireData?.items ?? [], [wireData]);

  // Assign = create a publish item FROM the event for the target section, then
  // the section block attaches it (it already owns a per-section attach hook).
  // This callback only performs the CREATE and returns the new item; the attach
  // is the block's own mutation, so no dynamic section binding is needed here.
  const createFromEvent = useCreateItemFromEvent();

  // The suggestion list for one empty news-derived section. Exclusion is handled
  // inside lib/suggestions.js: an event already written up (its publish item is
  // bound) is dropped by rule (b), so no client-side id filtering is needed.
  const suggestionsBySection = useMemo(() => {
    const map = {};
    for (const section of detail?.sections ?? []) {
      if (section.items.length > 0) continue;
      if (!NEWS_DERIVED_PILLARS.includes(section.functionId)) continue;
      if (dismissedSuggestions.has(section.functionId)) continue;
      map[section.functionId] = suggestForSection(section.functionId, wireEvents);
    }
    return map;
  }, [detail?.sections, wireEvents, dismissedSuggestions]);

  /**
   * Step 1 of an assignment: create a publish item from the suggested event for
   * this pillar. The section block runs step 2 (attach) with the returned item.
   * Returns the created item so the caller can attach it.
   */
  const onCreateItemFromSuggestion = async (suggestion, sectionFunctionId) => {
    setActionError(null);
    try {
      const item = await createFromEvent.mutateAsync({
        eventId: suggestion.id,
        functionId: sectionFunctionId,
      });
      return item;
    } catch (err) {
      setActionError(err.message);
      throw err;
    }
  };

  const onDismissSuggestion = (sectionFunctionId) => {
    setDismissedSuggestions((prev) => new Set(prev).add(sectionFunctionId));
  };

  const isToday = dayKey === lagosTodayKey();
  const sections = detail?.sections ?? [];
  const readyCount = sections.filter((s) => s.state === 'ready').length;
  const totalSections = sections.length;

  const onCreate = async () => {
    setActionError(null);
    try {
      await create.mutateAsync({ briefingDate: dayKey });
    } catch (err) {
      setActionError(err.message);
    }
  };

  const onStatus = async (status) => {
    setActionError(null);
    try {
      await update.mutateAsync({ id: briefing.id, body: { status } });
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* ── Newsletter masthead ─────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1240px] px-7 pt-8">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/pulse/wire"
            className="-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-[color:var(--pulse-faint)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            The Wire
          </Link>
          <PipelineStepper active="front" />
        </div>
      </div>
      <div className="mx-auto max-w-[1240px] px-7 pt-2 text-center">
        <h1
          className="m-0 bg-gradient-to-b from-white to-[#aebbd8] bg-clip-text text-[44px] font-extrabold tracking-[0.34em] text-transparent"
          style={{ paddingLeft: '0.34em' }}
        >
          NOVRPULSE
        </h1>
        <div className="mx-auto mt-3.5 h-[3px] max-w-[1240px] bg-gradient-to-r from-transparent via-primary to-transparent" />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{dayLabel(dayKey)}</span>
          <span className="text-[color:var(--pulse-faint)]">·</span>
          <span>Daily Brief</span>
          <span className="text-[color:var(--pulse-faint)]">·</span>
          <span className="text-primary">NOVRPULSE · 8 sections · public tier</span>
        </div>
      </div>

      {/* ── Edition bar: date nav, create, status, progress, actions ────── */}
      <div className="mx-auto mt-6 flex max-w-[1240px] flex-wrap items-end justify-between gap-5 px-7">
        <div>
          <h1 className="m-0 text-[30px] font-extrabold tracking-tight text-foreground">Today’s Briefing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One dated edition, eight fixed sections. Fill it, then send it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setDayKey((k) => shiftDayKey(k, -1))} aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[220px] text-center text-sm font-medium tabular-nums text-foreground" aria-live="polite">
              {isToday ? `Today · ${dayLabel(dayKey)}` : dayLabel(dayKey)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setDayKey((k) => shiftDayKey(k, 1))} aria-label="Next day">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDayKey(lagosTodayKey())}>Today</Button>
            <Input
              type="date"
              value={dayKey}
              onChange={(e) => { if (e.target.value) setDayKey(e.target.value); }}
              className="ml-1 w-40"
              aria-label="Briefing date"
            />
            <CalendarDays className="hidden h-4 w-4 text-muted-foreground md:block" />
          </div>
        </div>

        <div className="flex items-center gap-3.5">
          <div className="text-right">
            <span className="text-xl font-bold tabular-nums text-foreground">{readyCount}</span>
            <span className="ml-1 text-sm text-muted-foreground">of {totalSections || 8} ready</span>
          </div>
          <div className="h-[7px] w-[190px] overflow-hidden rounded-full bg-[color:var(--pulse-track)]" role="progressbar" aria-valuemin={0} aria-valuemax={totalSections || 0} aria-valuenow={readyCount} aria-label="Sections ready">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-primary to-[#60a5fa] transition-[width]"
              style={{ width: totalSections > 0 ? `${(readyCount / totalSections) * 100}%` : '0%' }}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button size="sm" onClick={() => setPreviewOpen(true)} disabled={!detail}>
            <Eye className="h-4 w-4" />
            Preview
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setFinalReviewOpen(true)} disabled={!detail}>
            <CheckCircle2 className="h-4 w-4" />
            Final review
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="mx-auto mt-4 max-w-[1240px] px-7">
          <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError}</p>
        </div>
      )}

      {/* ── Body: tray + newsletter skeleton ────────────────────────────── */}
      {isLoading ? (
        <div className="mx-auto mt-6 max-w-[1240px] space-y-3 px-7">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="mx-auto mt-10 max-w-[1240px] px-7 py-10 text-center">
          <p className="mb-3 text-sm text-destructive">Could not load briefings: {error?.message}</p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      ) : !briefing ? (
        <div className="mx-auto mt-6 max-w-[1240px] px-7">
          <EmptyState
            icon={<ClipboardList className="h-10 w-10" />}
            title="No briefing for this date"
            description="Create one to start composing the day’s eight sections."
            action={
              <Button onClick={onCreate} disabled={create.isPending}>
                <Plus className="h-4 w-4" />
                {create.isPending ? 'Creating…' : 'Create briefing'}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mx-auto mt-5 grid max-w-[1240px] grid-cols-1 gap-6 px-7 lg:grid-cols-[300px_1fr] lg:items-start">
          {/* Left tray: unassigned drafts */}
          <aside className="rounded-xl border border-border bg-card p-4 lg:sticky lg:top-[82px]">
            <h3 className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Unassigned drafts</h3>
            <p className="mb-3.5 mt-1 text-xs text-muted-foreground">
              {selectedChipId ? 'Now click a section to place it.' : 'Select a draft, then click a section slot.'}
            </p>

            {detail ? (
              trayItems.length > 0 ? (
                trayItems.map((it) => (
                  <DraftChip
                    key={it.id}
                    item={it}
                    selected={selectedChipId === it.id}
                    onSelect={(id) => setSelectedChipId((cur) => (cur === id ? null : id))}
                  />
                ))
              ) : (
                <p className="px-0.5 py-2 text-[12.5px] italic text-[color:var(--pulse-faint)]">
                  All drafts assigned to the page.
                </p>
              )
            ) : (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            )}
          </aside>

          {/* Main: the newsletter skeleton (8 ordered sections) */}
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-4 border-b border-border bg-[#0d1425] px-5 py-4">
              <div className="font-bold tracking-tight text-foreground">
                Today’s Briefing
                <small className="block font-medium text-muted-foreground">NOVRPULSE · 8 sections · public tier</small>
              </div>
              <div className="text-xs text-[color:var(--pulse-faint)]">{shortDayLabel(dayKey)}</div>
            </div>

            {detail ? (
              detail.sections.map((section) => (
                <PulseSectionBlock
                  key={section.id}
                  briefingId={detail.id}
                  section={section}
                  armedChipId={selectedChipId}
                  onPlaced={() => setSelectedChipId(null)}
                  onError={setActionError}
                  suggestions={suggestionsBySection[section.functionId] ?? []}
                  onCreateItemFromSuggestion={onCreateItemFromSuggestion}
                  onDismissSuggestion={onDismissSuggestion}
                />
              ))
            ) : (
              <div className="space-y-2 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Status + supporting records (below the fold) ────────────────── */}
      {briefing && detail && (
        <div className="mx-auto mt-6 max-w-[1240px] space-y-4 px-7">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Briefing status">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</span>
            {SETTABLE_STATUSES.map((s) => (
              <Button
                key={s.value}
                size="sm"
                variant={briefing.status === s.value ? 'primary' : 'secondary'}
                aria-pressed={briefing.status === s.value}
                disabled={update.isPending}
                onClick={() => onStatus(s.value)}
              >
                {s.label}
              </Button>
            ))}
            {briefing.status === 'approved' && (
              <span className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                Approval recorded. Publishing is not enabled yet.
              </span>
            )}
          </div>

          <PulseSupportingPanel open={supportingOpen} onToggle={() => setSupportingOpen((v) => !v)} />
        </div>
      )}

      <PulsePreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} briefing={detail} />
      <PulseFinalReviewPanel
        open={finalReviewOpen}
        onClose={() => setFinalReviewOpen(false)}
        briefing={detail}
        sections={sections}
      />
    </div>
  );
}
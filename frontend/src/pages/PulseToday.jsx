import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { Check, ChevronDown, CloudDownload, RefreshCw, Sparkles, X } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import AiJudgementCard from '../components/pulse/AiJudgementCard';
import AiDraftNote, { warningMessage } from '../components/pulse/AiDraftNote';
import { PulsePreviewModal } from '../components/pulse/PulsePanels';
import PillarIcon from '../components/pulse/PillarIcon';
import { PILLARS } from '../lib/pillars';
import { sectionNumber, parseSeedBody, scaffoldFor } from '../lib/canvasScaffolds';
import { NEWS_DERIVED_PILLARS } from '../components/pulse/pulseNewsletter';
import {
  useAiJudgements, usePulseEvent, usePulseEvents,
} from '../hooks/queries';
import {
  useAcceptJudgement, useAiDraft, useCreateItemFromEvent,
  useEditPublish, useReviewPulseEvent, useRejectJudgement,
  useRunPulseCollection,
} from '../hooks/mutations';
import { useAvailablePublishItems, useBriefing, useBriefings, useCreateBriefing } from '../hooks/briefingQueries';
import api from '../lib/api';

// ── Data access for the write/attach flow ─────────────────────────────────────
// Two writes have no dedicated hook: the manual publish (Part A endpoint) and
// the briefing-section attach (the shared section hook binds one functionId).
// Kept here as small named functions so the page logic stays presentational.

/** POST /api/publish — create a manually written piece (free mode). */
async function createManualItem(payload) {
  const res = await api('/publish', { method: 'POST', body: payload });
  return res.item;
}

/** POST /api/briefings/:id/sections/:functionId/items — attach a piece. */
async function attachItemToSection({ briefingId, functionId, publishItemId }) {
  const res = await api(`/briefings/${briefingId}/sections/${functionId}/items`, {
    method: 'POST',
    body: { publishItemId },
  });
  return res.section;
}

/**
 * PULSE — TODAY. The single-screen edition desk.
 *
 * One screen, three moves (the owner's daily job), matching the approved
 * prototype `docs/novrpulse/design/pulse-redesign-prototype.html`:
 *   1. Scan today's news (a short list) → "Use →" a story.
 *   2. A clean write overlay → "Add to email →".
 *   3. See what is in today's email → Preview → Send (send is not built).
 *
 * This page REPLACES the three heavy surfaces (Inbox / Writer / Front Page).
 * Everything else the product can do (day nav, the pipeline stepper,
 * per-story accept/dismiss bar, bulk checkboxes, the tray and section
 * management, lead designation, reorder, notes, final-review) is deliberately
 * NOT shown here. Those remain server-side; this is the surface the owner
 * sees. The two owner-requested additions on top of the minimal screen are a
 * small region filter chip row (All/Nigeria/Africa/Global → the `region` query
 * param) and the header Refresh / Pull latest actions.
 *
 * Theme: the app's LIGHT theme only (standard tokens + Inter). The email
 * preview iframe is the product's own dark-branded HTML and is unchanged.
 */

// ── Lagos-day helpers (kept identical to the old Inbox so "today" agrees) ─────
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST
function lagosDayKey(iso) {
  const d = new Date(new Date(iso).getTime() + LAGOS_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}
function lagosTodayKey() {
  return lagosDayKey(new Date().toISOString());
}

const todayDateLabel = () => format(new Date(), 'EEE d MMM');

function relativeTime(iso) {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

// The news-derived pillars a wire story may feed. Sourced once from
// pulseNewsletter so this page and the old surfaces agreed on the same set.
const FITS_PILLARS = NEWS_DERIVED_PILLARS;

// Region filter chips → the backend `region` query param. `undefined` (All) is
// omitted entirely by the api client; the server accepts the short codes and
// maps them to the canonical `np_source.region` value (see pulseController).
const REGION_CHIPS = [
  { key: 'all', label: 'All', param: undefined },
  { key: 'ng', label: 'Nigeria', param: 'NG' },
  { key: 'af', label: 'Africa', param: 'AF' },
  { key: 'global', label: 'Global', param: 'GLOBAL' },
];

/**
 * Eligible news-derived pillars for a story.
 *
 * The intended rule is functions ∩ {1,4,7,8}. But the AI understanding stage has
 * never run, so `event.functions` is EMPTY on every collected event — which made
 * the intersection empty and left the Use overlay with zero selectable chips (the
 * owner-reported "Use button doesn't work"). So:
 *   * when the story is UNCLASSIFIED (empty/missing `functions`) we enable ALL
 *     four news-derived pillars (01/04/07/08) and let the editor choose;
 *   * when the story IS classified we restrict to the real intersection, but if
 *     that intersection is empty we still fall back to all four (a classified
 *     story with no overlap must not dead-end the editor).
 * Manual pillars (02/03/05/06) are handled separately as always-enabled.
 */
function eligiblePillars(functions) {
  if (!Array.isArray(functions) || functions.length === 0) return [...FITS_PILLARS];
  const intersect = FITS_PILLARS.filter((f) => functions.includes(f));
  return intersect.length > 0 ? intersect : [...FITS_PILLARS];
}

/** Faint slot-hint string for a pillar, reused from the scaffold contracts. */
function bodyHint(functionId) {
  const def = scaffoldFor(functionId);
  if (!def) return '';
  if (def.kind === 'fields') return def.fields.map((f) => f.label).join(' · ');
  return def.slots.join(' · ');
}

// ── Region filter chips — single-select, composes with the search box ─────────
function RegionChips({ value, onSelect }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Filter today's news by region">
      {REGION_CHIPS.map((chip) => {
        const active = value === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(chip.key)}
            className={
              'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
              (active
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:text-foreground')
            }
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Cyber chip — a single toggle that composes with region + search ───────────
// "Cybersecurity only" narrows the news list to events whose source is a
// dedicated cybersecurity outlet (backend `cyber=true`). Off by default.
function CyberChip({ active, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={() => onToggle(!active)}
      title="Stories from dedicated cybersecurity sources"
      className={
        'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
        (active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground hover:text-foreground')
      }
    >
      Cybersecurity only
    </button>
  );
}

// ── Write overlay: pillar chips (story mode = eligible only; free mode = all) ─
function PillarChips({ value, onSelect, enabledIds }) {
  const enabled = new Set(enabledIds);
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Choose a section">
      {PILLARS.map((p) => {
        const isEnabled = enabled.has(p.functionId);
        const active = value === p.functionId;
        return (
          <button
            key={p.functionId}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={!isEnabled}
            title={isEnabled ? p.label : "This story doesn't fit this section"}
            disabled={!isEnabled}
            onClick={() => onSelect(p.functionId)}
            className={
              'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
              (active
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-secondary text-muted-foreground hover:border-ring hover:text-foreground') +
              (isEnabled ? '' : ' cursor-not-allowed opacity-40')
            }
          >
            <PillarIcon functionId={p.functionId} className="h-3.5 w-3.5" />
            {sectionNumber(p.functionId)} {p.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Write overlay ─────────────────────────────────────────────────────────────
// ONE overlay reused for both modes:
//   * story mode (from "Use →"): a source attribution line, eligible pillars
//     only, best fit preselected, headline placeholder "Write your headline —
//     not the source's".
//   * free mode (from "✎ Write your own"): "Write your own piece" header, ALL
//     eight pillars enabled, none preselected, an optional Reference link, and
//     no source attribution.
function WriteOverlay({ open, onClose, mode, source, onSave, busy, error }) {
  const isFree = mode === 'free';
  // Editing an existing piece: the pillar cannot change (the PATCH endpoint
  // edits the body only), so the chips are locked to its pillar.
  const isEdit = Boolean(source?.itemId);
  // The SOURCE event for the write overlay (story mode). Used for the
  // collapsible "Source article" pane; the list card carries no full body.
  const eventId = source?.eventId ?? null;

  const [functionId, setFunctionId] = useState(null);
  const [headline, setHeadline] = useState('');
  const [text, setText] = useState('');
  const [referenceLink, setReferenceLink] = useState('');
  // When the AI has drafted, its item already exists server-side. We keep its id
  // so "Add to email"/"Save draft" PATCHes this item instead of creating a
  // second one (the existing edit-else-create branch in `addToEmail`).
  const [aiItemId, setAiItemId] = useState(null);
  const [aiDrafted, setAiDrafted] = useState(false);
  const [aiFunctionId, setAiFunctionId] = useState(null);
  const [aiError, setAiError] = useState(null);
  // Guard-warning codes returned by the AI draft (owner decision: the draft is
  // STILL saved and the guard is surfaced as a warning). Carried onto the email
  // row so the amber chip persists for this session.
  const [aiWarnings, setAiWarnings] = useState([]);
  const [sourceOpen, setSourceOpen] = useState(false);

  const ai = useAiDraft();

  // Reset the form whenever the overlay (re)opens or its target changes.
  const resetKey = `${open}:${mode}:${source?.eventId ?? source?.id ?? source?.itemId ?? 'new'}`;
  const lastKey = useRef(null);
  useEffect(() => {
    if (!open || lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    setFunctionId(source?.preselect ?? null);
    setHeadline(source?.headline ?? '');
    setText(source?.text ?? '');
    setReferenceLink(source?.referenceLink ?? '');
    setAiItemId(null);
    setAiDrafted(false);
    setAiFunctionId(null);
    setAiError(null);
    setAiWarnings([]);
    setSourceOpen(false);
  }, [open, resetKey, source]);

  // Full source text for the "Source article" pane. Only fetched once the pane
  // is actually open (and only in story mode), so the overlay opening stays cheap.
  const { data: eventDetail, isLoading: sourceLoading, isError: sourceError } =
    usePulseEvent(sourceOpen && eventId ? eventId : null);

  const enabledIds = isFree
    ? PILLARS.map((p) => p.functionId)
    : (source?.eligible ?? []);

  const canAdd = Boolean(functionId) && headline.trim().length > 0 && text.trim().length > 0;
  const submit = (addToEmail) => {
    if (!canAdd || busy) return;
    // PATCH the AI item only when the pillar still matches what it was drafted
    // for. If the editor switched section after drafting, the draft no longer
    // belongs to that pillar, so a fresh item is created for the new one.
    const aiPatchId = aiItemId && aiFunctionId === functionId ? aiItemId : undefined;
    onSave({
      functionId,
      headline: headline.trim(),
      text: text.trim(),
      referenceLink: referenceLink.trim(),
      itemId: aiPatchId,
      addToEmail,
      warning: aiPatchId ? aiWarnings : [],
    });
  };

  // AI draft: one click → server rewrites the source into the chosen pillar,
  // runs its copyright + defamation guards, and returns the created item. The
  // guards WARN (owner decision): a tripped guard still saves the draft and the
  // codes come back in `res.warnings`, which we load into an amber banner. We
  // load the body into the form (headline = line 1, body = the rest) and
  // remember its id. Real errors (503 not configured / 400 / 404) still show red.
  const onAiDraft = async () => {
    if (isFree || !eventId || !functionId || ai.isPending) return;
    setAiError(null);
    try {
      const res = await ai.mutateAsync({ eventId, functionId });
      const item = res?.item;
      if (!item) throw new Error('The AI returned no draft.');
      const parsed = parseSeedBody(item.body ?? '');
      setHeadline(parsed.headline);
      setText(parsed.paragraph);
      setFunctionId(item.functionId ?? functionId);
      setAiItemId(item.id);
      setAiFunctionId(item.functionId ?? functionId);
      setAiWarnings(Array.isArray(res?.warnings) ? res.warnings : []);
      setAiDrafted(true);
    } catch (err) {
      if (err?.status === 503) {
        setAiError('AI is not configured.');
      } else {
        setAiError(err?.message || 'Could not draft with AI.');
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit piece' : isFree ? 'Write your own piece' : 'Write'}
      description={
        isEdit
          ? 'Edit this piece. Changing its section is not supported here.'
          : isFree
            ? 'A piece you write yourself — pick a section, then write.'
            : "Write for today's email."
      }
      className="max-w-3xl"
    >
      <div className="space-y-5">
        {!isFree && source?.sourceName && (
          <p className="border-b border-border pb-4 text-[12.5px] text-muted-foreground">
            <b className="font-semibold text-foreground">{source.sourceName}</b>
            {source.sourceHeadline ? <> — <q className="italic">{source.sourceHeadline}</q></> : null}
          </p>
        )}

        {aiDrafted && <AiDraftNote warnings={aiWarnings} />}

        {isFree && !isEdit && (
          <div>
            <label htmlFor="pulse-ref-link" className="label">Reference link (optional)</label>
            <input
              id="pulse-ref-link"
              type="url"
              value={referenceLink}
              onChange={(e) => setReferenceLink(e.target.value)}
              placeholder="Link to the thread, post or source"
              autoComplete="off"
              className="input mt-1"
            />
          </div>
        )}

        {/* AI draft — STORY MODE ONLY: free mode has nothing to rewrite. */}
        {!isFree && !isEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onAiDraft}
              disabled={!functionId || ai.isPending}
              title={functionId ? 'Rewrite the source into a draft for this section' : 'Pick a section first'}
            >
              <Sparkles className={'h-3.5 w-3.5' + (ai.isPending ? ' animate-pulse' : '')} />
              {ai.isPending ? 'Drafting…' : 'AI draft'}
            </Button>
            {aiError && <span role="alert" className="text-[12.5px] text-destructive">{aiError}</span>}
          </div>
        )}

        <PillarChips
          value={functionId}
          onSelect={setFunctionId}
          enabledIds={isEdit && functionId ? [functionId] : enabledIds}
        />

        {/* Source article — collapsible reader, collapsed by default. Story mode
            only; this is the publisher text the writer rewrites from. */}
        {!isFree && eventId && (
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setSourceOpen((v) => !v)}
              aria-expanded={sourceOpen}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={'h-4 w-4 transition-transform' + (sourceOpen ? '' : ' -rotate-90')} />
              Source article
            </button>
            {sourceOpen && (
              <div className="border-t border-border px-3.5 py-3">
                {sourceLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : sourceError ? (
                  <p className="text-[12.5px] text-destructive">Could not load the source article.</p>
                ) : eventDetail?.sourceBody ? (
                  <>
                    <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-[12.5px] leading-[1.6] text-muted-foreground">
                      {eventDetail.sourceBody}
                    </div>
                    {eventDetail.sourceTruncated && (
                      <p className="mt-1.5 text-[11.5px] italic text-muted-foreground">(truncated)</p>
                    )}
                  </>
                ) : (
                  <p className="text-[12.5px] italic text-muted-foreground">No source text available.</p>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={200}
            placeholder={isFree ? 'Write your headline' : "Write your headline — not the source's"}
            aria-label="Headline"
            className="w-full bg-transparent font-display text-[28px] font-bold leading-[1.18] tracking-[-0.02em] text-foreground placeholder:font-normal placeholder:italic placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            placeholder={functionId ? bodyHint(functionId) : 'Pick a section to see its slot guide.'}
            aria-label="Body"
            className="mt-3 w-full resize-y bg-transparent font-display text-[16px] leading-[1.7] text-foreground placeholder:italic placeholder:text-muted-foreground focus-visible:outline-none"
          />
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => submit(false)}
              disabled={!canAdd || busy}
            >
              Save draft
            </Button>
            <Button size="sm" onClick={() => submit(true)} disabled={!canAdd || busy}>
              {busy ? 'Adding…' : 'Add to email →'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── AI review modal ───────────────────────────────────────────────────────────
// Duplicate verdicts only. The recommendation ("Suggestions") pane that used to
// live here is now absorbed into the edition wizard's step 1, so this modal owns
// a single queue: the `kind='dedup'` pending judgements.

/** One review pane's loading / error / empty shell around a list of rows. */
function ReviewPane({ query, emptyTitle, emptyDescription, children }) {
  const { data, isLoading, isError, error, refetch } = query;
  const rows = data ?? [];
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="py-8 text-center">
        <p className="mb-3 text-sm text-destructive">Could not load AI judgements: {error?.message}</p>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return <EmptyState icon={<Check className="h-10 w-10" />} title={emptyTitle} description={emptyDescription} />;
  }
  return <div className="space-y-3">{children(rows)}</div>;
}

function AiReviewModal({ open, onClose }) {
  const dupQuery = useAiJudgements({ kind: 'dedup', outcome: 'pending' });
  const accept = useAcceptJudgement();
  const reject = useRejectJudgement();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI review"
      description="Duplicate pairs awaiting your verdict."
      className="max-w-2xl"
    >
      <ReviewPane
        query={dupQuery}
        emptyTitle="Nothing to review"
        emptyDescription="No duplicate pairings await review."
      >
        {(rows) => rows.map((j) => (
          <AiJudgementCard
            key={j.id}
            judgement={j}
            onAccept={accept.mutateAsync}
            onReject={reject.mutateAsync}
            acceptPending={accept.isPending}
            rejectPending={reject.isPending}
          />
        ))}
      </ReviewPane>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PulseToday() {
  const dayKey = lagosTodayKey();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('all');
  const [cyberOnly, setCyberOnly] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [write, setWrite] = useState(null); // { mode, source }
  const [writeError, setWriteError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [pullNote, setPullNote] = useState(null); // transient Pull latest result
  // Guard warnings for AI-drafted items, keyed by publish item id, for this
  // session only. The warning is CARRIED from the draft response through the
  // write overlay (the item's judgement detail also holds it server-side, but
  // re-fetching it per row is out of scope for v1). A row reloaded from the
  // server without this local state loses the chip — an accepted v1 limitation.
  const [itemWarnings, setItemWarnings] = useState({});

  const regionParam = REGION_CHIPS.find((c) => c.key === region)?.param;
  // The cyber chip is a boolean "dedicated cybersecurity sources only" filter.
  // OFF → undefined, so the param is omitted entirely (the api client drops
  // undefined) and the request is byte-identical to before the chip existed.
  const cyberParam = cyberOnly ? true : undefined;

  // Today's wire events. The API has no date param, so fetch a wide page and
  // filter to the Lagos day client-side (as the old Inbox did).
  const { data: eventsData, isLoading: eventsLoading, isError: eventsError, error: eventsErr, refetch: refetchEvents, isFetching } =
    usePulseEvents({ pageSize: 100, region: regionParam, cyber: cyberParam });
  const events = useMemo(() => eventsData?.items ?? [], [eventsData]);

  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => e.publishedAt && lagosDayKey(e.publishedAt) === dayKey)
        .filter((e) => e.reviewStatus !== 'dismissed')
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)),
    [events, dayKey],
  );

  const filteredEvents = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return dayEvents;
    return dayEvents.filter((e) =>
      `${e.title ?? ''} ${e.excerpt ?? ''} ${e.summary ?? ''}`.toLowerCase().includes(term),
    );
  }, [dayEvents, query]);

  // Today's briefing (the email being assembled). Reused for the email list, the
  // attach flow, and the preview.
  const { data: briefings = [] } = useBriefings({ from: dayKey, to: dayKey });
  const briefing = useMemo(
    () => briefings.find((b) => (b.briefingDate || '').slice(0, 10) === dayKey) ?? null,
    [briefings, dayKey],
  );
  const { data: briefingDetail } = useBriefing(briefing?.id);

  // "In today's email" = today's desk-usable pieces (drafts + approved). The
  // desk-usable endpoint returns manually-authored items plus items whose linked
  // event was Accepted; we narrow to today by `createdAt` (now a real column on
  // `publish_item` — see the publish_item_timestamps migration — so a piece can
  // no longer linger in the list forever). A piece belongs to today when its
  // Lagos day equals today.
  // (The Briefing Desk's attach machinery still exists server-side; this minimal
  // UI lists pieces directly — "Add to email" is what creates+attaches a piece.)
  const { data: publishItems = [], refetch: refetchItems } = useAvailablePublishItems({ limit: 50 });

  const emailItems = useMemo(() => {
    const key = dayKey;
    return publishItems
      .filter((it) => it.createdAt && lagosDayKey(it.createdAt) === key)
      .sort((a, b) => (a.functionId ?? 0) - (b.functionId ?? 0));
  }, [publishItems, dayKey]);

  // Pending DUPLICATE judgements count for the header button (hidden while 0).
  // Recommendations now live in the edition wizard (step 1), so the header badge
  // reflects only the dedup queue the AI-review modal still owns.
  const { data: pendingJudgements } = useAiJudgements({ kind: 'dedup', outcome: 'pending' });
  const pendingCount = pendingJudgements?.length ?? 0;

  // Mutations.
  const review = useReviewPulseEvent();
  const createFromEvent = useCreateItemFromEvent();
  const editPublish = useEditPublish();
  const createBriefing = useCreateBriefing();

  // Counters for the header + sections.
  const newsCount = filteredEvents.length;
  const emailCount = emailItems.length;

  // ── Create / add sequence ──────────────────────────────────────────────────
  // "Add to email" = (1) create the piece, (2) ensure today's briefing exists,
  // (3) attach the piece to the briefing's matching section so the preview and
  // the eventual send include it. The briefing-section machinery stays
  // server-side; this preserves the frozen preview/publish contract.
  // "Save draft" runs step (1) only — the piece exists and appears in the email
  // list, but is not yet attached to the briefing.
  async function addToEmail({ functionId, headline, text, referenceLink, eventId, itemId, addToEmail: withEmail, warning }) {
    setWriteError(null);
    setActionError(null);
    try {
      // (1) Create or update the piece. An `itemId` (an edited piece, OR an item
      // the AI already drafted server-side) means PATCH the body only — never
      // create a second item. The AI draft's pillar is already persisted.
      let item;
      if (itemId) {
        const body = [headline, text].filter(Boolean).join('\n\n');
        item = await editPublish.mutateAsync({ id: itemId, body });
      } else if (eventId) {
        // Story mode: the server seeds the body from the event, then we PATCH in
        // the editor's typed headline/text (same "<headline>\n\n<text>" contract
        // the seed and the tray preview already use) so nothing typed is lost.
        item = await createFromEvent.mutateAsync({ eventId, functionId });
        if (headline || text) {
          const body = [headline, text].filter(Boolean).join('\n\n');
          item = await editPublish.mutateAsync({ id: item.id, body });
        }
      } else {
        // Free mode: create the manual piece (server composes the body).
        item = await createManualItem({ functionId, headline, text, referenceLink });
      }

      // (2)+(3) Ensure today's briefing exists, then attach — only for "Add".
      if (withEmail) {
        let briefingId = briefing?.id;
        if (!briefingId) {
          const created = await createBriefing.mutateAsync({ briefingDate: dayKey });
          briefingId = created.id;
        }
        await attachItemToSection({
          briefingId,
          functionId: item.functionId ?? functionId,
          publishItemId: item.id,
        });
      }

      // Carry any AI guard warnings onto the item so its email row shows an
      // amber chip for this session (see `itemWarnings`).
      if (Array.isArray(warning) && warning.length > 0 && item?.id) {
        setItemWarnings((prev) => ({ ...prev, [item.id]: warning }));
      }

      setWrite(null);
      await refetchItems();
    } catch (err) {
      setWriteError(err.message);
    }
  }

  // ── Row actions ────────────────────────────────────────────────────────────
  const onUse = (event) => {
    const eligible = eligiblePillars(event.functions);
    setWriteError(null);
    setWrite({
      mode: 'story',
      source: {
        eventId: event.id,
        eligible,
        preselect: eligible[0] ?? null,
        sourceName: event.sourceName || 'Source',
        sourceHeadline: event.title,
        functionId: eligible[0] ?? null,
      },
    });
  };

  const onWriteOwn = () => {
    setWriteError(null);
    setWrite({ mode: 'free', source: { eligible: PILLARS.map((p) => p.functionId) } });
  };

  const onNotRelevant = async (id) => {
    setMenuOpenId(null);
    setActionError(null);
    try {
      await review.mutateAsync({ id, status: 'dismissed' });
    } catch (err) {
      setActionError(err.message);
    }
  };

  const onOpenItem = (item) => {
    const parsed = parseSeedBody(item.body ?? '');
    setWriteError(null);
    setWrite({
      mode: 'free',
      source: {
        itemId: item.id,
        eligible: PILLARS.map((p) => p.functionId),
        preselect: item.functionId,
        headline: parsed.headline,
        text: parsed.paragraph,
      },
    });
  };

  const busy = createFromEvent.isPending || editPublish.isPending || createBriefing.isPending;

  // ── Header actions: Refresh (invalidate) vs Pull latest (real collection) ───
  const qc = useQueryClient();
  const pull = useRunPulseCollection();

  const onRefresh = () => {
    setActionError(null);
    // Refetch the news + email lists from cache — a cheap re-read, no collection.
    qc.invalidateQueries({ queryKey: ['pulse-events'] });
    qc.invalidateQueries({ queryKey: ['publish-items'] });
  };

  const onPullLatest = async () => {
    setActionError(null);
    setPullNote(null);
    try {
      const summary = await pull.mutateAsync();
      // Both collection paths report the new events as `events` (in-app also
      // carries `stored`; the collector path carries `items`). Prefer `events`.
      const newCount = summary?.events ?? summary?.stored ?? 0;
      setPullNote({ kind: 'ok', text: `Pulled: ${newCount} new` });
    } catch (err) {
      if (err?.status === 403) {
        setPullNote({ kind: 'error', text: 'Only an admin can pull from sources.' });
      } else {
        setPullNote({ kind: 'error', text: err?.message || 'Could not pull from sources.' });
      }
    }
  };

  useEffect(() => {
    if (!menuOpenId) return undefined;
    const close = () => setMenuOpenId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpenId]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[860px] px-6 pb-28">
        {/* ── Header: wordmark · date · AI review (n) · Send ─────────────── */}
        <header className="sticky top-0 z-40 -mx-6 mb-6 flex items-center gap-4 border-b border-border bg-background/90 px-6 py-3.5 backdrop-blur">
          <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-foreground">Pulse</span>
          <span className="text-[13px] font-semibold text-muted-foreground">{todayDateLabel()}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isFetching}
              title="Refresh the news and email lists"
            >
              <RefreshCw className={'h-4 w-4' + (isFetching ? ' animate-spin' : '')} />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onPullLatest}
              disabled={pull.isPending}
              title="Collect the latest stories from sources"
            >
              <CloudDownload className={'h-4 w-4' + (pull.isPending ? ' animate-pulse' : '')} />
              {pull.isPending ? 'Pulling…' : 'Pull latest'}
            </Button>
            {pendingCount > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setAiOpen(true)}>
                AI review
                <span className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
                  {pendingCount}
                </span>
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/pulse/build')}
              title="Build today's edition with the 3-step AI wizard"
            >
              ✦ Build today's edition
            </Button>
            <Button
              size="sm"
              disabled
              title="Connecting the email send is the next milestone"
            >
              Send
            </Button>
          </div>
        </header>

        {(actionError || eventsError) && (
          <p className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionError || `Could not load today's news: ${eventsErr?.message}`}
          </p>
        )}

        {pull.isPending && (
          <p className="mb-4 rounded-md bg-secondary px-4 py-2.5 text-[13px] text-secondary-foreground">
            Pulling from sources… this can take a minute or two.
          </p>
        )}
        {pullNote && !pull.isPending && (
          <p
            role="status"
            className={
              'mb-4 rounded-md px-4 py-2.5 text-[13px] ' +
              (pullNote.kind === 'ok'
                ? 'bg-success/10 text-success'
                : 'bg-destructive/10 text-destructive')
            }
          >
            {pullNote.text}
          </p>
        )}

        {/* ── BLOCK 1 — TODAY'S NEWS ──────────────────────────────────────── */}
        <section aria-labelledby="newsHead" className="mt-8">
          <div className="flex items-center gap-3 border-b border-border pb-3">
            <h2 id="newsHead" className="text-[13px] font-extrabold uppercase tracking-[0.12em] text-foreground">
              Today's news <span className="ml-0.5 text-primary">({newsCount})</span>
            </h2>
            <div className="ml-auto flex items-center gap-3">
              <RegionChips value={region} onSelect={setRegion} />
              <CyberChip active={cyberOnly} onToggle={setCyberOnly} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search today's news"
                autoComplete="off"
                aria-label="Search today's news"
                className="h-8 w-[220px] rounded-full border border-border bg-secondary px-3.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {eventsLoading ? (
            <div className="space-y-3 py-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : eventsError ? (
            <div className="py-12 text-center">
              <Button variant="secondary" size="sm" onClick={() => refetchEvents()} disabled={isFetching}>
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
            </div>
          ) : filteredEvents.length === 0 ? (
            <EmptyState
              title="Nothing in today's news"
              description="No stories match today. Try clearing the search, or refresh."
            />
          ) : (
            <ul>
              {filteredEvents.map((event) => {
                const eligible = eligiblePillars(event.functions);
                return (
                  <li key={event.id} className="flex items-start gap-4 border-b border-border px-1 py-4">
                    <div className="min-w-0 flex-1">
                      {event.canonicalUrl ? (
                        <a
                          href={event.canonicalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-display text-[18px] font-bold leading-[1.3] tracking-[-0.01em] text-foreground hover:text-primary hover:underline"
                        >
                          {event.title}
                        </a>
                      ) : (
                        <h3 className="m-0 font-display text-[18px] font-bold leading-[1.3] tracking-[-0.01em] text-foreground">
                          {event.title}
                        </h3>
                      )}
                      {(event.excerpt || event.summary) && (
                        <p className="mt-1 line-clamp-1 text-[13.5px] text-muted-foreground">
                          {event.excerpt || event.summary}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                        <span className="font-semibold text-muted-foreground">{event.sourceName || '1 source'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{relativeTime(event.publishedAt)}</span>
                      </div>
                    </div>

                    <div className="relative flex shrink-0 items-center gap-1.5 pt-0.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={eligible.length === 0}
                        title={eligible.length === 0 ? 'This story fits no news section' : undefined}
                        onClick={() => onUse(event)}
                      >
                        Use →
                      </Button>
                      <button
                        type="button"
                        aria-label="More options"
                        aria-haspopup="true"
                        aria-expanded={menuOpenId === event.id}
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId((cur) => (cur === event.id ? null : event.id)); }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        ⋯
                      </button>
                      {menuOpenId === event.id && (
                        <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-border bg-card p-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => onNotRelevant(event.id)}
                            className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            Not relevant
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── BLOCK 2 — IN TODAY'S EMAIL ──────────────────────────────────── */}
        <section aria-labelledby="emailHead" className="mt-10">
          <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
            <h2 id="emailHead" className="text-[13px] font-extrabold uppercase tracking-[0.12em] text-foreground">
              In today's email <span className="ml-0.5 text-primary">({emailCount})</span>
            </h2>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onWriteOwn}>✎ Write your own</Button>
              <Button variant="secondary" size="sm" onClick={() => setPreviewOpen(true)} disabled={!briefing}>
                Preview email
              </Button>
            </div>
          </div>

          {emailItems.length === 0 ? (
            <p className="px-1 py-4 text-[13.5px] italic text-muted-foreground">
              Nothing in today's email yet. Use a story above to start.
            </p>
          ) : (
            <ul>
              {emailItems.map((item) => {
                const parsed = parseSeedBody(item.body ?? '');
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onOpenItem(item)}
                      className="flex w-full items-center gap-3 rounded-lg border border-transparent border-b-border px-3 py-3.5 text-left transition-colors hover:border-border hover:bg-card"
                    >
                      <span className="shrink-0 font-mono text-[13px] font-bold text-muted-foreground">
                        {String(item.functionId ?? 0).padStart(2, '0')}
                      </span>
                      <span
                        className={
                          'h-2 w-2 shrink-0 rounded-full ' +
                          (item.status === 'approved' || item.status === 'published' ? 'bg-success' : 'bg-warning')
                        }
                        title={item.status}
                      />
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-foreground">
                        {parsed.headline || 'Untitled piece'}
                      </span>
                      {itemWarnings[item.id]?.length > 0 && (
                        <span
                          className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.04em] text-warning"
                          title={itemWarnings[item.id].map(warningMessage).filter(Boolean).join(' · ')}
                        >
                          ⚠ Warning
                        </span>
                      )}
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                        {item.status}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Overlays */}
      <WriteOverlay
        open={Boolean(write)}
        mode={write?.mode ?? 'free'}
        source={write?.source}
        busy={busy}
        error={writeError}
        onClose={() => { setWrite(null); setWriteError(null); }}
        onSave={(payload) =>
          addToEmail({ ...payload, eventId: write?.source?.eventId, itemId: payload.itemId ?? write?.source?.itemId })
        }
      />
      <AiReviewModal open={aiOpen} onClose={() => setAiOpen(false)} />
      <PulsePreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} briefing={briefingDetail} />
    </div>
  );
}

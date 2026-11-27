import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Sparkles, X } from '../components/ui/icons';
import { Button, EmptyState, Skeleton } from '../components/ui';
import PillarIcon from '../components/pulse/PillarIcon';
import { warningMessage } from '../components/pulse/AiDraftNote';
import { PILLARS, pillarLabel } from '../lib/pillars';
import { sectionNumber, parseSeedBody } from '../lib/canvasScaffolds';
import { parseSlots, composeDraftBody } from '../lib/slots';
import { formatDate } from '../lib/utils';
import {
  usePulseEvent, usePulseEvents,
} from '../hooks/queries';
import { useBriefings, useCreateBriefing } from '../hooks/briefingQueries';
import {
  useAcceptJudgement, useAiDraft,
  useRecommendEvents, useRejectJudgement,
} from '../hooks/mutations';
import api from '../lib/api';

/**
 * PULSE — BUILD TODAY'S EDITION (the 3-step AI wizard).
 *
 * The owner-approved flow from `docs/novrpulse/design/pulse-redesign-prototype.html`,
 * adapted to the app's LIGHT theme and the real API:
 *
 *   1. Select  — the AI recommends a story per section (08/07/01/04, edition-lead
 *                order). Approve, reject-with-reason, or pick your own from
 *                today's stories. Every pick records its own judgement.
 *   2. Drafts  — one Suggested draft per approved (story, section) pair, side-by-side
 *                with the full source article. Approve / Retry (regenerate) /
 *                Edit, then continue.
 *   3. Write   — the manual sections (02/03/05/06) plus any AI section left empty.
 *                Each opens the shared write overlay in free mode. Finish creates
 *                today's briefing if missing and attaches every piece.
 *
 * The wizard is client-side session state; a Close with selections in progress
 * confirms before discarding. Nothing is written to the briefing until Finish.
 */

// The AI sections, in the owner's edition-lead order.
const AI_SECTIONS = [8, 7, 1, 4];
// The sections the owner writes by hand in step 3.
const MANUAL_SECTIONS = [2, 3, 5, 6, 9, 10];

// ── Lagos-day helpers (kept identical to PulseToday so "today" agrees) ────────
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST
function lagosDayKey(iso) {
  const d = new Date(new Date(iso).getTime() + LAGOS_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}
function lagosTodayKey() {
  return lagosDayKey(new Date().toISOString());
}

/** Confidence 0–1 → whole-number percent, or null when unknown. */
function confidencePercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round(Math.min(Math.max(value, 0), 1) * 100);
}

/** Draft key for the (event, section) pair. */
function pairKey(eventId, functionId) {
  return `${eventId}|${functionId}`;
}

// ── Small presentational pieces ───────────────────────────────────────────────

/** The step indicator: 1 Select → 2 Drafts → 3 Write. */
function StepIndicator({ step }) {
  const steps = [
    { n: 1, label: 'Select' },
    { n: 2, label: 'Drafts' },
    { n: 3, label: 'Write' },
  ];
  return (
    <div className="flex items-center gap-2 text-[12.5px]" aria-label="Edition build progress">
      {steps.map((s, i) => (
        <span key={s.n} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="text-muted-foreground">→</span>}
          <span
            aria-current={step === s.n ? 'step' : undefined}
            className={
              'inline-flex items-center gap-1.5 font-semibold ' +
              (step === s.n ? 'text-foreground' : 'text-muted-foreground')
            }
          >
            <span
              className={
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ' +
                (step >= s.n ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground')
              }
            >
              {s.n}
            </span>
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Pillar caption used on each section block and draft card. */
function SectionCaption({ functionId }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-secondary-foreground">
      <PillarIcon functionId={functionId} className="h-3.5 w-3.5" />
      {sectionNumber(functionId)} {pillarLabel(functionId)}
    </span>
  );
}

// ── Step 1 — Select ───────────────────────────────────────────────────────────

/**
 * One AI suggestion row: the event title, source, confidence and the AI's
 * reason, with ✓ Use / ✕ Not this. Reject reveals a small inline reason input
 * (encouraged, optional). The confirm hits the real reject endpoint.
 */
function SuggestionRow({ row, picked, onUse, onReject, busy }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);

  const pct = confidencePercent(row.confidence);

  const reject = async () => {
    setErr(null);
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setErr('A short reason helps the model (at least 3 characters).');
      return;
    }
    try {
      await onReject(row.id, trimmed);
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className={'rounded-lg border bg-card p-3.5 ' + (picked ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border')}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="pt-0.5 text-primary"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-bold leading-[1.3] text-foreground">
            {row.eventTitle || 'Untitled story'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            {pct !== null && <span className="font-semibold text-muted-foreground">{pct}% confident</span>}
            {picked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                <Check className="h-3 w-3" /> Added — drafting next
              </span>
            )}
          </div>
          {row.rationale && <p className="mt-1.5 text-[13px] text-muted-foreground">{row.rationale}</p>}
        </div>
        {picked ? (
          <span className="shrink-0 text-[12px] italic text-muted-foreground">Picked</span>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" onClick={() => onUse(row)} disabled={busy}>
              <Check className="h-3.5 w-3.5" />
              Use
            </Button>
            {!rejectOpen && (
              <Button variant="secondary" size="sm" onClick={() => setRejectOpen(true)} disabled={busy}>
                <X className="h-3.5 w-3.5" />
                Not this
              </Button>
            )}
          </div>
        )}
      </div>

      {rejectOpen && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            placeholder="Why not? (optional) — e.g. already covered elsewhere"
            aria-label="Reason for rejecting this suggestion"
            className="h-8 min-w-[240px] flex-1 rounded-md border border-border bg-secondary px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button variant="danger" size="sm" onClick={reject} disabled={busy}>Reject</Button>
          <Button variant="ghost" size="sm" onClick={() => { setRejectOpen(false); setErr(null); }} disabled={busy}>
            Cancel
          </Button>
          {err && <span role="alert" className="text-[12px] text-destructive">{err}</span>}
        </div>
      )}
    </div>
  );
}

/** "+ Pick your own" — a compact list of today's stories, excluding picked ones. */
function PickOwnPanel({ functionId, stories, takenIds, onPick, onCancel }) {
  const available = stories.filter((s) => !takenIds.has(s.id));
  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        Pick your own for {sectionNumber(functionId)} {pillarLabel(functionId)}
      </p>
      {available.length === 0 ? (
        <p className="py-2 text-[13px] italic text-muted-foreground">No other stories in today's news.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {available.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
                {s.title || 'Untitled story'}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">{s.sourceName || '1 source'}</span>
              <Button size="sm" onClick={() => onPick(s)}>+ Add</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * One section block in step 1: the AI's suggestions for that section, plus a
 * "+ Pick your own" affordance. A section with no suggestions shows the picker
 * only (or nothing but an empty note).
 */
function SectionBlock({ functionId, suggestions, loading, aiError, pickedIds, ...rowProps }) {
  const [pickOpen, setPickOpen] = useState(false);

  return (
    <section className="border-b border-border pb-5">
      <div className="mb-3 flex items-center gap-3">
        <SectionCaption functionId={functionId} />
        <span className="ml-auto text-[12px] text-muted-foreground">
          {loading ? 'Finding suggestions…' : aiError ? '' : `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : aiError === 'AI_NOT_CONFIGURED' ? (
        <p className="text-[13px] text-muted-foreground">
          Choose a story for this section.
        </p>
      ) : aiError ? (
        <p role="alert" className="text-[13px] text-destructive">{aiError}</p>
      ) : suggestions.length === 0 ? (
        <p className="text-[13px] italic text-muted-foreground">No suggestion for this section today.</p>
      ) : (
        <div className="space-y-2">
          {suggestions.map((row) => (
            <SuggestionRow key={row.id} row={row} picked={pickedIds?.has(row.id) ?? false} onUse={rowProps.onUse} onReject={rowProps.onReject} busy={rowProps.busy} />
          ))}
        </div>
      )}

      {pickOpen ? (
        <PickOwnPanel
          functionId={functionId}
          stories={rowProps.stories}
          takenIds={rowProps.takenIds}
          onPick={(s) => { rowProps.onPick(functionId, s); setPickOpen(false); }}
          onCancel={() => setPickOpen(false)}
        />
      ) : (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => setPickOpen(true)}>+ Pick your own</Button>
        </div>
      )}
    </section>
  );
}

// ── Step 2 — Drafts ───────────────────────────────────────────────────────────

/**
 * One draft card: editable headline+body textarea on the LEFT, the full source
 * article in a sticky scroll pane on the RIGHT. Approve / Retry / Edit, with
 * per-card inline errors (422 messages verbatim).
 *
 * The Suggested draft is created (or regenerated) when the card mounts; errors land
 * inline. A card is keyed by its (event, section) pair so switching between
 * cards never mixes text.
 */
function DraftCard({ eventId, functionId, sourceName, onDraftReady, initial, otherSections }) {
  const ai = useAiDraft();
  const { data: eventDetail, isLoading: sourceLoading } = usePulseEvent(eventId);

  // The parsed slot blocks for the body, or null when the body is free text
  // (an old piece the AI did not shape) — then we render the single textarea.
  const [slots, setSlots] = useState(() => parseSlots(initial?.body) ?? null);
  const [headline, setHeadline] = useState(initial?.headline ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [itemId, setItemId] = useState(initial?.itemId ?? null);
  const [status, setStatus] = useState(initial?.status ?? 'draft');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  // True while the initial draft (or a retry) is being generated, so the card
  // shows an explicit "Preparing draft…" state instead of a silent skeleton.
  const [drafting, setDrafting] = useState(!initial?.itemId);
  // Guard warning codes returned by the Suggested draft (owner decision: warn, not
  // block). Captured from every draft/regenerate response and deduped; a card
  // with warnings requires the two-step "Approve anyway" confirmation.
  const [warnings, setWarnings] = useState([]);
  // True once the editor clicked Approve on a warned draft — the button becomes
  // "⚠ Approve anyway" until it is clicked again or the editor backs out.
  const [confirmApprove, setConfirmApprove] = useState(false);

  // The exact body the parent records/persists: the composed slot region when
  // the draft is in slot format, else the raw free-text body unchanged.
  const composedBody = slots ? composeDraftBody(headline, slots) : body;

  // Union (deduped) the guard warning codes from a draft response into state.
  const captureWarnings = (res) => {
    const codes = Array.isArray(res?.warnings) ? res.warnings : [];
    if (codes.length === 0) {
      setWarnings([]);
      setConfirmApprove(false);
      return;
    }
    setWarnings((prev) => [...new Set([...prev, ...codes])]);
  };

  // Create the draft once for a fresh pair. A pair arriving with an itemId/body
  // is already drafted (e.g. the editor came back to step 2) — do not re-call.
  //
  // StrictMode runs this effect twice (mount → cleanup → mount). The FIRST run
  // starts the ai-draft call and stores its promise in `promiseRef`; BOTH runs
  // await the SAME promise and apply the result. The endpoint is idempotent —
  // the second call returns the same live item, so there is no duplicate LLM
  // call and no duplicate item. Applying in both runs is safe (same values) and
  // sidesteps the previous bug where the first run's cleanup DISCARDED the
  // result and the second run early-returned, leaving the card permanently blank.
  const promiseRef = useRef(null);
  useEffect(() => {
    if (initial?.itemId) return;
    if (!promiseRef.current) {
      promiseRef.current = ai.mutateAsync({ eventId, functionId });
    }
    let cancelled = false;
    (async () => {
      setError(null);
      setDrafting(true);
      try {
        const res = await promiseRef.current;
        if (cancelled) return;
        const parsed = parseSeedBody(res?.item?.body ?? '');
        const nextSlots = parseSlots(parsed.paragraph);
        setHeadline(parsed.headline);
        setBody(parsed.paragraph);
        setSlots(nextSlots);
        setItemId(res?.item?.id ?? null);
        setStatus('draft');
        captureWarnings(res);
        onDraftReady(eventId, functionId, {
          itemId: res?.item?.id ?? null,
          headline: parsed.headline,
          body: nextSlots ? composeDraftBody(parsed.headline, nextSlots) : parsed.paragraph,
          status: 'draft',
        });
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      } finally {
        if (!cancelled) setDrafting(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async () => {
    setError(null);
    setDrafting(true);
    try {
      const res = await ai.mutateAsync({ eventId, functionId, regenerate: true });
      const parsed = parseSeedBody(res?.item?.body ?? '');
      // A fresh draft uses the same labels — re-parse it into slots.
      const nextSlots = parseSlots(parsed.paragraph);
      setHeadline(parsed.headline);
      setBody(parsed.paragraph);
      setSlots(nextSlots);
      setItemId(res?.item?.id ?? null);
      setStatus('draft');
      // A fresh draft replaces the previous one — reset warnings to this
      // response's set (not unioned with the superseded draft's).
      setWarnings(Array.isArray(res?.warnings) ? res.warnings : []);
      setConfirmApprove(false);
      onDraftReady(eventId, functionId, {
        itemId: res?.item?.id ?? null,
        headline: parsed.headline,
        body: nextSlots ? composeDraftBody(parsed.headline, nextSlots) : parsed.paragraph,
        status: 'draft',
      }, { regenerate: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDrafting(false);
    }
  };

  // Update one slot's text (slot format only).
  const updateSlot = (index, text) => {
    setSlots((prev) => prev.map((b, i) => (i === index ? { ...b, text } : b)));
  };

  const approve = () => {
    if (!headline.trim() || !composedBody.trim()) {
      setError('Add a headline and body before approving.');
      return;
    }
    // A warned draft needs a second, explicit confirmation (inline two-step, no
    // window.confirm): the first click only arms "Approve anyway".
    if (warnings.length > 0 && !confirmApprove) {
      setConfirmApprove(true);
      return;
    }
    setStatus('approved');
    setEditing(false);
    setConfirmApprove(false);
    onDraftReady(eventId, functionId, { itemId, headline: headline.trim(), body: composedBody.trim(), status: 'approved' });
  };

  const doneEditing = () => {
    setEditing(false);
    setConfirmApprove(false);
    onDraftReady(eventId, functionId, { itemId, headline: headline.trim(), body: composedBody.trim(), status: 'draft' });
  };

  return (
    <article className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <SectionCaption functionId={functionId} />
        <span className="text-[12px] text-muted-foreground">← {sourceName || 'source'}</span>
        {otherSections?.length > 0 && (
          <span
            className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground"
            title="This same story is also drafted for other sections"
          >
            <span className="text-muted-foreground">also in:</span>
            {otherSections.map((fn) => (
              <span
                key={fn}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-semibold text-secondary-foreground"
              >
                <PillarIcon functionId={fn} className="h-3 w-3" />
                {sectionNumber(fn)} {pillarLabel(fn)}
              </span>
            ))}
          </span>
        )}
        <span
          className={
            'ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.04em] ' +
            (status === 'approved' ? 'bg-success/10 text-success' : editing ? 'bg-warning/10 text-warning' : 'bg-secondary text-secondary-foreground')
          }
        >
          {status === 'approved' ? '✓ approved' : editing ? '✎ editing' : '● awaiting review'}
        </span>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-2">

        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Suggested draft
            {drafting && (
              <span className="inline-flex items-center gap-1 font-normal normal-case tracking-normal text-primary">
                <Sparkles className="h-3 w-3 animate-pulse" />
                Preparing draft…
              </span>
            )}
          </p>
          {drafting ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <input
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                readOnly={!editing}
                maxLength={200}
                placeholder="Headline"
                aria-label="Draft headline"
                className="w-full bg-transparent font-display text-[20px] font-bold leading-[1.2] tracking-[-0.01em] text-foreground focus-visible:outline-none"
              />
              {slots ? (
                <div className="mt-2">
                  {slots.map((slot, i) => (
                    <div key={`${slot.label}-${i}`} className={i > 0 ? 'mt-3 border-t border-border pt-3' : ''}>
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {slot.label}
                      </label>
                      <textarea
                        value={slot.text}
                        onChange={(e) => updateSlot(i, e.target.value)}
                        readOnly={!editing}
                        rows={3}
                        aria-label={`${slot.label} slot text`}
                        className="mt-1 w-full resize-y rounded-md bg-secondary/30 p-3 font-display text-[14px] leading-[1.7] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  readOnly={!editing}
                  rows={12}
                  placeholder="Slot text — UPPER_LABEL blocks and their copy."
                  aria-label="Draft body"
                  className="mt-2 w-full resize-y rounded-md bg-secondary/30 p-3 font-display text-[14px] leading-[1.7] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              )}
            </>
          )}

          {error && <p role="alert" className="mt-2 text-[12.5px] text-destructive">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {editing ? (
              <Button size="sm" onClick={doneEditing}><Check className="h-3.5 w-3.5" />Done</Button>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={approve}
                  disabled={drafting || status === 'approved'}
                  className={confirmApprove ? 'bg-warning text-warning-foreground hover:bg-warning/90' : undefined}
                >
                  {confirmApprove ? <AlertTriangle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  {status === 'approved' ? 'Approved' : confirmApprove ? 'Approve anyway' : 'Approve'}
                </Button>
                <Button variant="secondary" size="sm" onClick={retry} disabled={drafting}>
                  <Sparkles className={'h-3.5 w-3.5' + (drafting ? ' animate-pulse' : '')} />
                  {drafting ? 'Retrying…' : 'Retry'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setConfirmApprove(false); setEditing(true); }} disabled={drafting}>
                  ✎ Edit
                </Button>
              </>
            )}
          </div>


          {!editing && warnings.length > 0 && (
            <div className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-[12px] text-warning">
              {warnings.map(warningMessage).filter(Boolean).map((m) => (
                <p key={m}>⚠ {m}.</p>
              ))}
            </div>
          )}
        </div>


        <div className="min-w-0">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Source article
          </p>
          {sourceLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : eventDetail?.sourceBody ? (
            <div className="lg:sticky lg:top-4">
              <p className="text-[13.5px] font-semibold leading-[1.35] text-foreground">
                {eventDetail.title || 'Untitled source'}
              </p>
              <p className="mt-0.5 mb-2 text-[11.5px] text-muted-foreground">
                {eventDetail.sourceName || 'Unknown source'}
                {eventDetail.publishedAt && (
                  <> · {formatDate(eventDetail.publishedAt)}</>
                )}
              </p>
              <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/30 p-3 text-[12.5px] leading-[1.65] text-muted-foreground">
                {eventDetail.sourceBody}
              </div>
              {eventDetail.sourceTruncated && (
                <p className="mt-1.5 text-[11.5px] italic text-muted-foreground">(truncated)</p>
              )}
            </div>
          ) : (
            <p className="text-[12.5px] italic text-muted-foreground">No source text available.</p>
          )}
        </div>
      </div>
    </article>
  );
}

/** Map a server error to a verbatim-ish inline message. */
function errorText(e) {
  if (e?.code === 'DRAFT_TOO_CLOSE_TO_SOURCE') return 'Too close to the source — try Retry or edit it yourself.';
  if (e?.code === 'named_individual_in_public_arrest') return 'The piece names an individual — rewrite it without names.';
  if (e?.status === 503) return 'Draft suggestions are unavailable.';
  return 'Draft unavailable. Write or edit the story manually.';
}

// ── Step 3 — Write overlay (free mode, shared with the Today screen) ──────────

/**
 * The manual-piece overlay in FREE mode — a compact version of PulseToday's
 * WriteOverlay. All eight pillars are enabled; the piece's pillar (the section
 * being written) is preselected. On save the item is created via POST /api/publish
 * and the section is recorded as written.
 */
function WriteOverlay({ open, section, onClose, onSave, busy, error }) {
  const [functionId, setFunctionId] = useState(section);
  const [headline, setHeadline] = useState('');
  const [text, setText] = useState('');
  const [referenceLink, setReferenceLink] = useState('');

  const resetKey = `${open}:${section}`;
  const lastKey = useRef(null);
  useEffect(() => {
    if (!open || lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    setFunctionId(section);
    setHeadline('');
    setText('');
    setReferenceLink('');
  }, [open, section, resetKey]);

  if (!open) return null;

  const canAdd = Boolean(functionId) && headline.trim() && text.trim();
  const submit = () => {
    if (!canAdd || busy) return;
    onSave({ functionId, headline: headline.trim(), text: text.trim(), referenceLink: referenceLink.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <h2 className="text-[16px] font-bold text-foreground">Write a piece</h2>
          <span className="text-[13px] text-muted-foreground">for {sectionNumber(section)} {pillarLabel(section)}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
            className="ml-auto rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Choose a section">
            {PILLARS.map((p) => {
              const active = functionId === p.functionId;
              return (
                <button
                  key={p.functionId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setFunctionId(p.functionId)}
                  className={
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                    (active
                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                      : 'border-border bg-secondary text-muted-foreground hover:border-ring hover:text-foreground')
                  }
                >
                  <PillarIcon functionId={p.functionId} className="h-3.5 w-3.5" />
                  {sectionNumber(p.functionId)} {p.label}
                </button>
              );
            })}
          </div>

          <div>
            <label htmlFor="wiz-ref-link" className="label">Reference link (optional)</label>
            <input
              id="wiz-ref-link"
              type="url"
              value={referenceLink}
              onChange={(e) => setReferenceLink(e.target.value)}
              placeholder="Link to the thread, post or source"
              autoComplete="off"
              className="input mt-1"
            />
          </div>

          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={200}
            placeholder="Write your headline"
            aria-label="Headline"
            className="w-full bg-transparent font-display text-[26px] font-bold leading-[1.18] tracking-[-0.02em] text-foreground placeholder:font-normal placeholder:italic placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            placeholder="Write the piece."
            aria-label="Body"
            className="w-full resize-y bg-transparent font-display text-[16px] leading-[1.7] text-foreground placeholder:italic placeholder:text-muted-foreground focus-visible:outline-none"
          />

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={!canAdd || busy}>
              {busy ? 'Adding…' : 'Add piece'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PulseWizard() {
  const router = useRouter();
  const dayKey = lagosTodayKey();

  const [step, setStep] = useState(1);
  const [picks, setPicks] = useState<Record<string,{eventId:string;judgementId:string|null;source:string;title:string;status:string;manual?:boolean}>>({});   // { [functionId]: { judgementId, eventId, title, source, status, manual? } }
  const [drafts, setDrafts] = useState({}); // { [`${eventId}|${fn}`]: { itemId, headline, body, status, attempts } }
  const [writes, setWrites] = useState({}); // { [functionId]: true } — manual sections written
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [finishError, setFinishError] = useState(null);
  const [finishing, setFinishing] = useState(false);

  const [writeSection, setWriteSection] = useState(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeError, setWriteError] = useState(null);

  // ── Step 1 data: one recommend call on open. ────────────────────────────────
  const recommend = useRecommendEvents();
  const accept = useAcceptJudgement();
  const reject = useRejectJudgement();
  const recommendStarted = useRef(false);
  const [recError, setRecError] = useState(null);

  useEffect(() => {
    if (recommendStarted.current) return;
    recommendStarted.current = true;
    (async () => {
      setRecError(null);
      try {
        await recommend.mutateAsync({});
      } catch (e) {
        setRecError(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The recommend response rows: { id, eventId, eventTitle, rationale, confidence, outcome }.
  const recommendationsBySection = useMemo(() => {
    const out = {};
    for (const rec of recommend.data?.recommendations ?? []) {
      out[rec.functionId] = rec.judgements ?? [];
    }
    return out;
  }, [recommend.data]);

  const aiNotConfigured = recError?.status === 503;

  // Today's stories for "Pick your own". The API has no date param, so fetch a
  // wide page and filter to the Lagos day client-side (as PulseToday does).
  const { data: eventsData } = usePulseEvents({ pageSize: 100, isCybersecurity: true });
  const todayStories = useMemo(() => {
    const items = eventsData?.items ?? [];
    return items
      .filter((e) => e.publishedAt && lagosDayKey(e.publishedAt) === dayKey)
      .filter((e) => e.reviewStatus !== 'dismissed')
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }, [eventsData, dayKey]);

  const takenEventIds = useMemo(
    () => new Set(Object.values(picks).map((p) => p.eventId)),
    [picks],
  );

  // Judgement ids already picked — drives the "Added — drafting next" state on
  // the suggestion cards so a successful Use gives immediate visible feedback.
  const pickedJudgementIds = useMemo(
    () => new Set(Object.values(picks).map((p) => p.judgementId)),
    [picks],
  );

  // ── Step 1 actions ──────────────────────────────────────────────────────────
  const onUse = async (functionId, row) => {
    try {
      await accept.mutateAsync(row.id);
    } catch (e) {
      // A 409 (already adjudicated) is non-fatal — the pick still stands.
      if (e?.status !== 409) {
        setRecError(e);
        return;
      }
    }
    setRecError(null);
    setPicks((prev) => ({
      ...prev,
      [functionId]: {
        judgementId: row.id,
        eventId: row.eventId,
        title: row.eventTitle,
        source: row.source ?? '',
        status: 'approved',
      },
    }));
  };

  const onReject = async (judgementId, reason) => {
    const res = await reject.mutateAsync({ id: judgementId, reason });
    // Drop any pick that referenced this judgement (normally none).
    setPicks((prev) => {
      const next = { ...prev };
      for (const [fn, p] of Object.entries(next)) {
        if (p.judgementId === judgementId) delete next[fn];
      }
      return next;
    });
    return res;
  };

  const onPickOwn = (functionId, story) => {
    setPicks((prev) => ({
      ...prev,
      [functionId]: {
        judgementId: null,
        eventId: story.id,
        title: story.title,
        source: story.sourceName || '',
        status: 'approved',
        manual: true,
      },
    }));
  };

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  const approvedPairs = useMemo(
    () => Object.entries(picks).map(([fn, p]) => ({ functionId: Number(fn), ...p })),
    [picks],
  );

  const onDraftReady = useCallback((eventId, functionId, patch, { regenerate=false } = {}) => {
    const key = pairKey(eventId, functionId);
    setDrafts((prev) => {
      const cur = prev[key] ?? { attempts: 0 };
      return {
        ...prev,
        [key]: {
          ...cur,
          ...patch,
          attempts: regenerate ? cur.attempts + 1 : cur.attempts,
        },
      };
    });
  }, []);

  const approvedDraftCount = useMemo(
    () => approvedPairs.filter((p) => drafts[pairKey(p.eventId, p.functionId)]?.status === 'approved').length,
    [approvedPairs, drafts],
  );

  // The other sections a story is ALSO drafted for — derived per event from the
  // drafts state (keyed `eventId|fn`). Rendered as the "also in:" chips on a
  // card whose event appears in more than one section.
  const sectionsByEvent = useMemo(() => {
    const out = {};
    for (const p of approvedPairs) {
      if (!out[p.eventId]) out[p.eventId] = [];
      out[p.eventId].push(p.functionId);
    }
    return out;
  }, [approvedPairs]);

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  // Rows = manual sections not yet written + any AI section that ended empty.
  const writeRows = useMemo(() => {
    const manual = MANUAL_SECTIONS.filter((fn) => !writes[fn]);
    const emptyAi = AI_SECTIONS.filter((fn) => !picks[fn]);
    return [...manual, ...emptyAi];
  }, [writes, picks]);

  const openWrite = (functionId) => {
    setWriteError(null);
    setWriteSection(functionId);
  };

  const saveWrite = async ({ functionId, headline, text, referenceLink }) => {
    setWriteBusy(true);
    setWriteError(null);
    try {
      const res = await api('/publish', { method: 'POST', body: { functionId, headline, text, referenceLink } });
      const item = res?.item;
      if (!item) throw new Error('The piece could not be created.');
      setDrafts((prev) => ({ ...prev, [`manual:${functionId}`]: { itemId: item.id, headline, body: text, status: 'approved' } }));
      setWrites((prev) => ({ ...prev, [functionId]: true }));
      setWriteSection(null);
    } catch (e) {
      setWriteError(e.message);
    } finally {
      setWriteBusy(false);
    }
  };

  // ── Finish: ensure briefing, attach every piece, then leave. ────────────────
  const createBriefing = useCreateBriefing();
  const { data: briefings = [] } = useBriefings({ from: dayKey, to: dayKey });
  const existingBriefing = useMemo(
    () => briefings.find((b) => (b.briefingDate || '').slice(0, 10) === dayKey) ?? null,
    [briefings, dayKey],
  );

  const onFinish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      // (1) Ensure today's briefing exists (create-if-missing; tolerate the race).
      let briefingId = existingBriefing?.id;
      if (!briefingId) {
        try {
          const created = await createBriefing.mutateAsync({ briefingDate: dayKey });
          briefingId = created.id;
        } catch (e) {
          if (e?.status === 409) {
            const list = await api('/briefings', { query: { from: dayKey, to: dayKey } });
            const found = (list?.briefings ?? []).find((b) => (b.briefingDate || '').slice(0, 10) === dayKey);
            if (!found) throw e;
            briefingId = found.id;
          } else {
            throw e;
          }
        }
      }

      // (2) Attach every approved draft + manual piece to its section.
      //     Manual pieces are PATCHed with the editor's headline/body first.
      const attach = async (functionId, publishItemId) => {
        try {
          await api(`/briefings/${briefingId}/sections/${functionId}/items`, {
            method: 'POST',
            body: { publishItemId },
          });
        } catch (e) {
          // 409 = already attached — the desired end state; anything else throws.
          if (e?.status !== 409) throw e;
        }
      };

      for (const p of approvedPairs) {
        const d = drafts[pairKey(p.eventId, p.functionId)];
        if (!d?.itemId) continue;
        const body = [d.headline, d.body].filter(Boolean).join('\n\n');
        if (d.headline || d.body) {
          await api(`/publish/${d.itemId}`, { method: 'PATCH', body: { body } });
        }
        await attach(p.functionId, d.itemId);
      }

      for (const [fn, w] of Object.entries(writes)) {
        const d = drafts[`manual:${fn}`];
        if (!w || !d?.itemId) continue;
        await attach(Number(fn), d.itemId);
      }

      // (3) Hand off to the publish flow: navigate to Today with the publish
      //     flag, so the briefing preview opens in publish mode — preview the
      //     email, then choose to send it (test to yourself, or to the segment).
      router.push(`/pulse?publish=1&briefing=${briefingId}`);
    } catch (e) {
      setFinishError(e.message);
      setFinishing(false);
    }
  };

  // ── Close with confirm if any selection exists ──────────────────────────────
  const hasProgress = Object.keys(picks).length > 0 || Object.keys(writes).length > 0;
  const onClose = () => {
    if (hasProgress) setCloseConfirm(true);
    else router.push('/pulse');
  };

  const suggestionCount = approvedPairs.length;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1000px] px-6 pb-28">

        <header className="sticky top-0 z-40 -mx-6 mb-6 flex items-center gap-4 border-b border-border bg-background/90 px-6 py-3.5 backdrop-blur">
          <h1 className="desk-heading">Build today's edition</h1>
          <div className="ml-auto flex items-center gap-4">
            <StepIndicator step={step} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close wizard"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>


        {step === 1 && (
          <div className="space-y-6">
            <p className="text-[13.5px] text-muted-foreground">
              Select a suggested story or choose one from the news wire.
              {aiNotConfigured && (
                <span className="mt-1 block font-semibold text-warning">
                  Suggestions are unavailable. Choose stories from the news wire.
                </span>
              )}
            </p>

            {recError && !aiNotConfigured && (
              <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Story suggestions are unavailable.
              </p>
            )}

            <div className="space-y-6">
              {AI_SECTIONS.map((functionId) => (
                <SectionBlock
                  key={functionId}
                  functionId={functionId}
                  suggestions={recommendationsBySection[functionId] ?? []}
                  loading={recommend.isPending && !recommend.data}
                  aiError={aiNotConfigured ? 'AI_NOT_CONFIGURED' : (recError ? (recError.message ?? String(recError)) : null)}
                  pickedIds={pickedJudgementIds}
                  onUse={(row) => onUse(functionId, row)}
                  onReject={onReject}
                  onPick={(fn, s) => onPickOwn(fn, s)}
                  stories={todayStories}
                  takenIds={takenEventIds}
                  busy={accept.isPending || reject.isPending}
                />
              ))}
            </div>

            <div className="flex items-center gap-3 border-t border-border pt-5">
              <span className="text-[12.5px] text-muted-foreground">
                {suggestionCount} piece{suggestionCount === 1 ? '' : 's'} selected
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep(3)}>Skip step</Button>
                <Button size="sm" onClick={() => setStep(2)}>Continue to drafts</Button>
              </div>
            </div>
          </div>
        )}


        {step === 2 && (
          <div className="space-y-5">
            <p className="text-[13.5px] text-muted-foreground">
              Compare each draft with its source, edit the copy and approve it for the edition.
            </p>

            {approvedPairs.length === 0 ? (
              <EmptyState
                title="No drafts to show"
                description="Nothing was approved in step 1. Continue to step 3 to write your sections."
              />
            ) : (
              <div className="space-y-5">
                {approvedPairs.map((p) => (
                  <DraftCard
                    key={pairKey(p.eventId, p.functionId)}
                    eventId={p.eventId}
                    functionId={p.functionId}
                    sourceName={p.source}
                    initial={drafts[pairKey(p.eventId, p.functionId)]}
                    onDraftReady={onDraftReady}
                    otherSections={(sectionsByEvent[p.eventId] ?? []).filter((fn) => fn !== p.functionId)}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 border-t border-border pt-5">
              <span className="text-[12.5px] text-muted-foreground">
                {approvedDraftCount} of {approvedPairs.length} drafted &amp; approved
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>← Back</Button>
                <Button size="sm" onClick={() => setStep(3)}>Continue to write</Button>
              </div>
            </div>
          </div>
        )}


        {step === 3 && (
          <div className="space-y-5">
            <p className="text-[13.5px] text-muted-foreground">
              Write the remaining sections. Finish creates today's briefing if needed and adds every piece to the email.
            </p>

            {writeRows.length === 0 ? (
              <p className="text-[13.5px] italic text-muted-foreground">
                Every section has a piece. Finish to add them all to today's email.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {writeRows.map((functionId) => (
                  <li key={functionId} className="flex items-center gap-3 px-4 py-3.5">
                    <SectionCaption functionId={functionId} />
                    <Button variant="secondary" size="sm" className="ml-auto" onClick={() => openWrite(functionId)}>
                      Write
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {Object.keys(writes).length > 0 && (
              <p className="text-[12.5px] text-muted-foreground">
                {Object.keys(writes).length} piece{Object.keys(writes).length === 1 ? '' : 's'} written.
              </p>
            )}

            {finishError && (
              <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {finishError}
              </p>
            )}

            <div className="flex items-center gap-3 border-t border-border pt-5">
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>← Back</Button>
              <div className="ml-auto">
                <Button size="sm" onClick={onFinish} disabled={finishing}>
                  {finishing ? 'Finishing…' : 'Finish and preview'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>


      <WriteOverlay
        open={Boolean(writeSection)}
        section={writeSection ?? MANUAL_SECTIONS[0]}
        busy={writeBusy}
        error={writeError}
        onClose={() => { setWriteSection(null); setWriteError(null); }}
        onSave={saveWrite}
      />


      {closeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <h2 className="text-[16px] font-bold text-foreground">Discard this edition build?</h2>
            <p className="mt-2 text-[13.5px] text-muted-foreground">
              You have selections in progress. Closing the wizard will discard them. Nothing in “In today's email” changes.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCloseConfirm(false)}>Keep building</Button>
              <Button size="sm" onClick={() => router.push('/pulse')}>Discard &amp; close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

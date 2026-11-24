import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { Badge, Button } from '../components/ui';
import PillarIcon from '../components/pulse/PillarIcon';
import CanvasDraftStrip from '../components/pulse/CanvasDraftStrip';
import PipelineStepper from '../components/pulse/PipelineStepper';
import { PILLARS, pillarLabel } from '../lib/pillars';
import {
  blankSlotValues, composeBody, parseSeedBody, scaffoldFor, scaffoldKindLabel,
  sectionNumberedLabel, sectionNumber, isPillarEnabled,
  readBoundValues, slotValuesFromItem,
} from '../lib/canvasScaffolds';
import { usePulseEvent, usePublishItemsForEvent } from '../hooks/queries';
import {
  useApprovePublish, useCreateItemFromEvent, useEditPublish, useRejectPublish,
} from '../hooks/mutations';

/**
 * THE WRITER — the Editorial Canvas (route /pulse/inbox/:eventId/canvas).
 *
 * A writing app, not an item list. The prototype's `screen-writer`: a centred
 * ~720px document, an EMPTY headline the editor authors ("Write your headline —
 * not the source's"), a per-pillar SCAFFOLD (prose slot outline, or a field form
 * for 05/06), a "Shape" guidance rail, a sources rail carrying the wire headline
 * as ATTRIBUTION ONLY, and a slim footer (Save Draft · Reject · Approve ·
 * Add to the Front Page →).
 *
 * TWO STATES
 *  1. CHOOSE (no draft loaded): the same document chrome, but the scaffold is a
 *     read-only PREVIEW of the selected pillar and a primary "Start writing →"
 *     POSTs /api/publish/from-event for that one pillar.
 *  2. WRITE (a draft is active): the editable writer. Switching pillar re-renders
 *     the scaffold and the guidance; the stored body is composed from the slots.
 *
 * The wired-versus-composed distinction is deliberate: the scaffold is the
 * writing aid, the SAVED body is a single text body (backend contract:
 * publish_item.body is text). See lib/canvasScaffolds.js for the compose format.
 */

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

/** Lagos-local day key (YYYY-MM-DD) for "now" — the edition this draft targets. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST
function lagosTodayKey() {
  return new Date(Date.now() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}
function editionDate() {
  return format(new Date(`${lagosTodayKey()}T12:00:00Z`), 'd MMMM');
}

function relativeTime(iso) {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

/**
 * Map an approval gate code to the scaffold slot/field index it concerns, so a
 * failed approve can highlight the exact input. Returns null when the code is
 * not a field-bound gate (the caller falls back to the generic error banner).
 */
const GATE_FIELD = {
  REGULATORY_IMPACT_REQUIRED: 'regulatoryImpact',
  EVENT_DATE_REQUIRED: 'eventDate',
  EVENT_NOTICE_TOO_SHORT: 'eventDate',
};
function gateFieldIndex(functionId, code) {
  const column = GATE_FIELD[code];
  if (!column) return null;
  const def = scaffoldFor(functionId);
  const idx = Object.entries(def?.bindings ?? {}).find(([, c]) => c === column)?.[0];
  return idx === undefined ? null : Number(idx);
}

function PublishStatusBadge({ status }) {
  if (!status) return null;
  return (
    <Badge status={PUBLISH_STATUS_TOKENS[status] || 'DRAFT'}>
      {PUBLISH_STATUS_LABELS[status] || status}
    </Badge>
  );
}

// ── Pillar chips (with the eligibility gate) ──────────────────────────────────
/**
 * The eight pillar chips. Chips whose pillar is not in the story's eligible
 * news-derived set are DISABLED with a tooltip — the story doesn't fit that
 * section. The manual/cadence pillars (02/03/05/06) stay always available.
 */
function PillarChips({ value, onSelect, disabled, eligibleFunctions }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Choose a section">
      {PILLARS.map((p) => {
        const num = sectionNumber(p.functionId);
        const active = value === p.functionId;
        const enabled = !disabled && isPillarEnabled(p.functionId, eligibleFunctions);
        return (
          <button
            key={p.functionId}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={!enabled}
            title={enabled ? p.label : "This story doesn't fit this section"}
            disabled={!enabled}
            onClick={() => onSelect(p.functionId)}
            className={
              'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
              (active
                ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_16px_rgba(59,130,246,0.22)]'
                : 'border-border bg-secondary text-muted-foreground hover:border-[color:var(--pulse-border-hi)] hover:text-foreground') +
              (enabled ? '' : ' cursor-not-allowed opacity-40')
            }
          >
            <PillarIcon functionId={p.functionId} className="h-3.5 w-3.5" />
            {num} {p.label}
          </button>
        );
      })}
    </div>
  );
}

// ── The scaffold (prose slot outline or field form) ───────────────────────────
function SlotOutline({ functionId, values, onChange, readOnly = false, fieldErrorIndex = null }) {
  const def = scaffoldFor(functionId);
  if (def?.kind !== 'prose') return null;
  return (
    <div className="space-y-4">
      {def.slots.map((label, i) => {
        const errored = fieldErrorIndex === i;
        return (
        <div
          key={label}
          className={
            'rounded-[10px] border border-border border-l-[3px] px-4 py-3.5 transition-colors ' +
            (errored
              ? 'border-l-destructive bg-destructive/10'
              : 'border-l-[color:var(--pulse-accent-dim)] bg-secondary/50 hover:border-[color:var(--pulse-border-hi)]')
          }
        >
          <div className="mb-2 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.13em] text-primary">
            <span className="font-mono text-[10px] text-muted-foreground">
              {String(i + 1).padStart(2, '0')}
            </span>
            {label}
          </div>
          <textarea
            value={values[i] ?? ''}
            readOnly={readOnly}
            onChange={(e) => onChange(i, e.target.value)}
            rows={2}
            placeholder={readOnly ? '' : `Write the ${label.toLowerCase()} here…`}
            aria-label={label}
            aria-invalid={errored || undefined}
            className="w-full resize-y bg-transparent font-display text-[16.5px] leading-[1.7] text-foreground placeholder:italic placeholder:text-muted-foreground focus-visible:outline-none"
          />
        </div>
        );
      })}
    </div>
  );
}

function FieldForm({ functionId, values, onChange, readOnly = false, fieldErrorIndex = null }) {
  const def = scaffoldFor(functionId);
  if (def?.kind !== 'fields') return null;
  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      {def.fields.map((field, i) => {
        const isBoundDate = field.bound === 'eventDate';
        const errored = fieldErrorIndex === i;
        return (
        <div
          key={field.label}
          className={
            'grid grid-cols-1 gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[190px_1fr] sm:items-start sm:py-3.5 ' +
            (errored ? 'bg-destructive/10' : 'bg-secondary/40')
          }
        >
          <label
            htmlFor={`field-${i}`}
            className="pt-1 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground"
          >
            {field.label}
          </label>
          {isBoundDate ? (
            <input
              id={`field-${i}`}
              type="datetime-local"
              value={values[i] ?? ''}
              readOnly={readOnly}
              onChange={(e) => onChange(i, e.target.value)}
              aria-invalid={errored || undefined}
              className={'input' + (errored ? ' border-destructive' : '')}
            />
          ) : field.multiline ? (
            <textarea
              id={`field-${i}`}
              value={values[i] ?? ''}
              readOnly={readOnly}
              onChange={(e) => onChange(i, e.target.value)}
              rows={3}
              placeholder={readOnly ? '' : 'Format, audience, anything the reader needs.'}
              className="input resize-y"
            />
          ) : (
            <input
              id={`field-${i}`}
              type="text"
              value={values[i] ?? ''}
              readOnly={readOnly}
              onChange={(e) => onChange(i, e.target.value)}
              className="input"
            />
          )}
        </div>
        );
      })}
    </div>
  );
}

function Scaffold({ functionId, values, onChange, readOnly = false, fieldErrorIndex = null }) {
  const def = scaffoldFor(functionId);
  if (!def) return null;
  return def.kind === 'fields' ? (
    <FieldForm functionId={functionId} values={values} onChange={onChange} readOnly={readOnly} fieldErrorIndex={fieldErrorIndex} />
  ) : (
    <SlotOutline functionId={functionId} values={values} onChange={onChange} readOnly={readOnly} fieldErrorIndex={fieldErrorIndex} />
  );
}

// ── Right rail: Shape guidance + sources attribution ──────────────────────────
function GuidancePanel({ functionId }) {
  const def = scaffoldFor(functionId);
  if (!def) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--pulse-accent-dim)] bg-primary/[0.06]">
      <div className="flex items-center gap-2 border-b border-[color:var(--pulse-accent-dim)] px-3.5 py-2.5 text-[11.5px] font-bold uppercase tracking-[0.11em] text-primary">
        Shape · guidance
        <span className="ml-auto rounded-full border border-[color:var(--pulse-border-hi)] px-2 py-0.5 text-[10px] font-bold tracking-[0.06em] text-muted-foreground">
          {scaffoldKindLabel(functionId)}
        </span>
      </div>
      <ul className="space-y-2.5 px-4 py-3.5">
        {def.guidance.map((g) => (
          <li key={g} className="relative pl-5 text-[12.5px] leading-snug text-muted-foreground">
            <span aria-hidden="true" className="absolute left-0 top-0 text-xs font-bold text-primary">✓</span>
            {g}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Sources & provenance rail. The wire headline is ATTRIBUTION ONLY here:
 * `Source · {sourceName} — "{event.title}"`. It is never the document headline.
 */
function SourcesRail({ detail, loading }) {
  const sources = detail?.sources ?? [];
  const attribution = sources[0]?.sourceName || 'Unknown publisher';
  return (
    <aside className="space-y-3">
      <GuidancePanel functionId={detail?.functions?.[0] ?? 1} />

      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.11em] text-muted-foreground">
          Source
        </div>
        <div className="text-[13px] leading-snug text-muted-foreground">
          <b className="font-semibold text-foreground">{attribution}</b>
          {detail?.title ? <> — <q>{detail.title}</q></> : null}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-3.5 text-xs text-muted-foreground">Loading sources…</div>
      ) : (
        <ul className="space-y-2.5">
          {sources.map((s, i) => (
            <li key={`${s.url}-${i}`} className="rounded-xl border border-border bg-card p-3.5">
              <div className="text-[13.5px] font-semibold text-foreground">{s.sourceName || 'Unknown source'}</div>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"
                >
                  {s.url}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : null}
              {s.licence ? (
                <div className="mt-1 text-[11.5px] text-muted-foreground">Licence: {s.licence}</div>
              ) : null}
            </li>
          ))}
          {sources.length === 0 && (
            <li className="rounded-xl border border-border bg-card p-3.5 text-xs text-muted-foreground">
              No provenance rows for this event.
            </li>
          )}
        </ul>
      )}
    </aside>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EditorialCanvas() {
  const { eventId } = useParams();

  const { data: detail, isLoading: detailLoading, isError: detailError, error: detailErr, refetch: refetchEvent, isFetching } =
    usePulseEvent(eventId);
  const { data: priorItems = [], refetch: refetchItems } = usePublishItemsForEvent(eventId);

  const create = useCreateItemFromEvent();
  const edit = useEditPublish();
  const approve = useApprovePublish();
  const reject = useRejectPublish();

  const [selectedPillar, setSelectedPillar] = useState(null);
  const [activeItem, setActiveItem] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  // The field a failed APPROVAL points at, so the bound slot/field is highlighted
  // inline (e.g. REGULATORY_IMPACT_REQUIRED → the 01 regulatory-impact slot).
  const [fieldGate, setFieldGate] = useState(null); // { index, message } | null

  // Editor state for the active draft: an empty headline and the scaffold values.
  const [headline, setHeadline] = useState('');
  const [values, setValues] = useState([]);
  const seeded = useRef({ headline: '', paragraph: '' });

  const busy = edit.isPending || approve.isPending || reject.isPending;

  // Newest first, deduped against the in-session item.
  const items = useMemo(() => {
    const list = [...priorItems];
    if (activeItem && !list.some((i) => i.id === activeItem.id)) list.unshift(activeItem);
    return list;
  }, [priorItems, activeItem]);

  const writeState = Boolean(activeItem);
  const editorPillar = activeItem?.functionId ?? selectedPillar;
  const eligibleFunctions = detail?.functions ?? [];

  // Load a draft into the editor. The headline field starts EMPTY (never the
  // source's); the seeded paragraph becomes the first slot's starting text.
  const loadIntoEditor = (item) => {
    setActiveItem(item);
    setActionError(null);
    setNotice(null);
    setFieldGate(null);
    const parsed = parseSeedBody(item.body ?? '');
    seeded.current = parsed;
    // Hydrate the scaffold values, seeding any dedicated-column slots (01
    // regulatory impact, 05 event date) from the item's own fields.
    const blanks = slotValuesFromItem(item);
    // The seeded paragraph seeds the first non-bound slot (for 01, slot 0 is
    // 'Regulator' — a normal prose slot — so this still lands on index 0).
    if (blanks.length > 0 && parsed.paragraph) blanks[0] = parsed.paragraph;
    setHeadline('');
    setValues(blanks);
  };

  // Default the selected pillar to one that is actually ENABLED for this story:
  // the first eligible news-derived pillar, else the first always-available
  // manual pillar (02). This keeps the pre-selected chip selectable when the
  // story fits none of 01/04/07/08.
  useEffect(() => {
    if (activeItem || detailLoading || !detail) return;
    if (selectedPillar !== null) return;
    const firstEnabled =
      eligibleFunctions.find((f) => isPillarEnabled(f, eligibleFunctions)) ??
      PILLARS.find((p) => isPillarEnabled(p.functionId, eligibleFunctions))?.functionId ??
      PILLARS[0].functionId;
    setSelectedPillar(firstEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, detailLoading]);

  const runAction = async (fn, ...args) => {
    setActionError(null);
    try {
      return await fn(...args);
    } catch (err) {
      setActionError(err.message);
      return null;
    }
  };

  // "Start writing" / "Add to the Front Page" create path: POST from-event for
  // the ONE selected pillar, then load the seeded draft into the writer.
  const onCreateOrAdd = async () => {
    if (!selectedPillar) return;
    setActionError(null);
    setNotice(null);
    try {
      const item = await create.mutateAsync({ eventId, functionId: selectedPillar });
      loadIntoEditor(item);
      await refetchItems();
      setNotice('Draft added. Approve it here, or open the Front Page to place it in the edition.');
    } catch (err) {
      // A refused create is usually the defamation gate (F7 naming an arrestee)
      // — surface the server message; never open an editor.
      setActionError(err.message);
    }
  };

  const composedBody = () =>
    composeBody({
      functionId: activeItem.functionId,
      headline,
      seededHeadline: seeded.current.headline,
      values,
    });

  const onSave = async () => {
    // Compose the text body (bound fields excluded) and send the dedicated
    // columns alongside, so the item round-trips its 01/05 fields.
    const bound = readBoundValues(activeItem.functionId, values);
    const saved = await runAction(edit.mutateAsync, { id: activeItem.id, body: composedBody(), ...bound });
    if (saved) {
      setActiveItem((prev) => (prev ? { ...prev, ...saved } : prev));
      seeded.current = { headline: parseSeedBody(saved.body).headline, paragraph: seeded.current.paragraph };
      setNotice('Draft saved.');
    }
  };

  // Map an approval gate code to the bound slot/field it concerns, so the writer
  // sees the message next to the offending input (and it is highlighted).
  const onApprove = async () => {
    setFieldGate(null);
    setActionError(null);
    try {
      const saved = await approve.mutateAsync(activeItem.id);
      if (saved) setActiveItem((prev) => (prev ? { ...prev, ...saved } : prev));
    } catch (err) {
      const index = gateFieldIndex(activeItem.functionId, err.code);
      if (index !== null) setFieldGate({ index, message: err.message });
      else setActionError(err.message);
    }
  };
  const onReject = () => runAction(reject.mutateAsync, activeItem.id);

  const onSelectPillar = (functionId) => {
    setSelectedPillar(functionId);
    setFieldGate(null);
    // In the write state, switching pillar re-shapes the (unsaved) document.
    if (activeItem) {
      const blanks = blankSlotValues(functionId);
      setValues(blanks);
    }
  };

  const sectionChip = activeItem ? sectionNumberedLabel(activeItem.functionId) : null;

  return (
    <div className="min-h-screen">
      {/* Edition-aware header: the draft declares its edition + section. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-7 pt-6">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center rounded-full border border-[color:var(--pulse-accent-dim)] bg-primary/[0.09] px-3 py-1.5">
            Drafting for the <b className="mx-1 font-bold text-foreground">{editionDate()} edition</b>
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="text-[8px] text-primary">◆</span>
            Section <b className="font-bold text-foreground">{sectionChip || '—'}</b>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/pulse/wire" className="-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-[color:var(--pulse-faint)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-3.5 w-3.5" />
            The Wire
          </Link>
          <Link to="/pulse" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-[color:var(--pulse-faint)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            The Front Page
          </Link>
          <PipelineStepper active="write" />
          <Button variant="ghost" size="sm" onClick={() => refetchEvent()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="mx-auto max-w-6xl px-7 pt-4">
          <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError}</p>
        </div>
      )}
      {notice && !actionError && (
        <div className="mx-auto max-w-6xl px-7 pt-4">
          <p className="rounded-md border border-border bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">{notice}</p>
        </div>
      )}

      {detailError && !detailLoading && (
        <div className="mx-auto max-w-6xl px-7 pt-4">
          <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Could not load the event: {detailErr?.message}
          </p>
        </div>
      )}

      {/* Prior items for this event — small chips; click to resume a draft. */}
      {items.length > 0 && (
        <div className="mx-auto max-w-6xl px-7 pt-4">
          <CanvasDraftStrip
            items={items}
            activeId={activeItem?.id ?? null}
            onSelect={loadIntoEditor}
            onNew={() => { setActiveItem(null); setNotice(null); }}
          />
        </div>
      )}

      {/* Document + rail (centred ~720px document, then the rail column). */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-7 py-6 lg:grid-cols-[minmax(0,720px)_minmax(0,1fr)]">
        <article className="min-w-0">
          <PillarChips
            value={editorPillar}
            onSelect={onSelectPillar}
            disabled={create.isPending}
            eligibleFunctions={eligibleFunctions}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {writeState
              ? 'Switching section re-shapes the document. One story can yield several pieces.'
              : 'Pick the section this story fits — 02/03/05/06 are always available for manual pieces.'}
          </p>

          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Write your headline — not the source's"
            aria-label="Document headline"
            className="mt-4 w-full bg-transparent font-display text-[40px] font-bold leading-[1.12] tracking-tight text-foreground placeholder:font-normal placeholder:italic placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <p className="mt-1 text-xs italic text-muted-foreground">
            <b className="not-italic text-muted-foreground">Your original headline</b> — the source's title stays in Sources for attribution.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2.5 border-b border-border pb-5 text-[12.5px] text-muted-foreground">
            {editorPillar && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
                {activeItem ? pillarLabel(activeItem.functionId) : sectionNumberedLabel(editorPillar)}
              </span>
            )}
            {detail?.title && <span className="text-muted-foreground/80">{detail.sources?.[0]?.sourceName || 'Source'}</span>}
            {detail?.publishedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>{relativeTime(detail.publishedAt)}</span>
              </>
            )}
            {activeItem && <PublishStatusBadge status={activeItem.status} />}
          </div>

          <div className="mt-6">
            <Scaffold
              functionId={editorPillar ?? PILLARS[0].functionId}
              values={values}
              onChange={(i, v) => {
                setValues((prev) => prev.map((x, idx) => (idx === i ? v : x)));
                // Editing the offending field clears its gate highlight.
                setFieldGate((prev) => (prev && prev.index === i ? null : prev));
              }}
              readOnly={!writeState}
              fieldErrorIndex={fieldGate?.index ?? null}
            />
            {fieldGate && (
              <p
                role="alert"
                className="mt-3 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {fieldGate.message}
              </p>
            )}
          </div>
        </article>

        <SourcesRail detail={detail} loading={detailLoading} />
      </div>

      {/* Slim footer: Save Draft · Reject · Approve · Add to the Front Page → */}
      <div className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-7 py-3">
          <span className="mr-auto text-[12.5px] text-muted-foreground">
            {writeState ? (
              <>Drafting for the {editionDate()} edition · <b className="font-semibold text-success">changes save on submit</b></>
            ) : (
              <>Choose a section, then start writing.</>
            )}
          </span>

          {writeState ? (
            <>
              <Button size="sm" disabled={busy} onClick={onSave}>
                {edit.isPending ? 'Saving…' : 'Save Draft'}
              </Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={onReject}>
                Reject
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={onApprove}>
                Approve
              </Button>
            </>
          ) : null}

          <Button onClick={onCreateOrAdd} disabled={!selectedPillar || create.isPending}>
            {create.isPending ? 'Adding…' : writeState ? 'Add to the Front Page' : 'Start writing'}
            {!create.isPending && <ArrowRight className="h-4 w-4" />}
          </Button>
          {writeState && (
            <Link
              to="/pulse"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Open the Front Page
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

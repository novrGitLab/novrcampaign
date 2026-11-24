import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, ArrowLeft, Check, ChevronLeft, ChevronRight, ExternalLink, LayoutList, Pencil, Radio, RefreshCw, Search, SlidersHorizontal, SquarePen,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Badge, Button, EmptyState, InfoTip, PillButton, SearchInput, Skeleton,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import ItemThumb from '../components/pulse/ItemThumb';
import PipelineStepper from '../components/pulse/PipelineStepper';
import { useAiJudgements, usePulseEvents, usePulseEvent } from '../hooks/queries';
import {
  useAcceptJudgement, useApprovePublish, useEditPublish, useProjectF7, useRejectJudgement, useRejectPublish, useReviewPulseEvent,
} from '../hooks/mutations';
import AiJudgementCard from '../components/pulse/AiJudgementCard';
import { NEWS_DERIVED_PILLARS } from '../components/pulse/pulseNewsletter';

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

// The Wire reads like a newspaper: display headlines in a serif face (the
// prototype's --serif). No serif token exists in the app theme, so we declare
// it inline, matching docs/novrpulse/design/pulse-redesign-prototype.html.
const SERIF_FAMILY = 'Georgia, "Times New Roman", serif';

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

// The news-derived pillars a wire story is eligible to feed: 01 Regulatory,
// 04 Cyber Hygiene, 07 Breaking News, 08 CyberIntel. The "Fits:" row on a card
// lists exactly these (see eligiblePillars). 02/03/05/06 are drafted directly
// in the Writer, not sourced from the wire. Sourced from pulseNewsletter so the
// canonical set is defined once.
const FITS_PILLARS = NEWS_DERIVED_PILLARS;

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

// Language filter. "All" sends no param; "en" and "non-en" map to the API's
// language filter. A non-English event is a flagged bad feed item — the badge
// and this filter exist to surface it, not to disable its source.
const LANGUAGE_OPTIONS = [
  { value: '', label: 'All languages' },
  { value: 'en', label: 'English' },
  { value: 'non-en', label: 'Non-English' },
];

// Human label for a non-English `language` code, used in the badge tooltip.
const LANGUAGE_LABELS = {
  ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ru: 'Russian', ar: 'Arabic',
  he: 'Hebrew', th: 'Thai', hi: 'Hindi', und: 'Undetermined',
};

function relativeTime(iso) {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

/** The first pillar id of an event, used to pick the thumbnail glyph. */
function primaryFunction(functions) {
  return Array.isArray(functions) && functions.length > 0 ? functions[0] : undefined;
}

/**
 * The eligible news-derived pillars for a story: its `functions` intersected
 * with FITS_PILLARS (01/04/07/08), in canonical order. An empty result means
 * the story fits no news-derived section (it may still be a wall item).
 */
function eligiblePillars(functions) {
  if (!Array.isArray(functions)) return [];
  return FITS_PILLARS.filter((f) => functions.includes(f));
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

/**
 * Flags an event whose detected language is not English. Script-based detection
 * occasionally labels a Latin-script event as `en` when it is another Latin
 * language; the badge only ever appears for a detected non-Latin script, so a
 * false positive here is a genuinely non-English item.
 */
function NonEnglishBadge({ language }) {
  if (!language || language === 'en') return null;
  const label = LANGUAGE_LABELS[language];
  return (
    <span
      title={label ? `Detected language: ${label}` : 'Detected as non-English'}
      className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600"
    >
      Non-English{label ? ` · ${label}` : ''}
    </span>
  );
}

/**
 * The "Fits:" row — the news-derived pillars this story can feed. One story may
 * feed several sections, so each eligible pillar is shown as a chip. When none
 * of 01/04/07/08 apply we say so explicitly rather than hiding the row.
 */
function FitsRow({ functions }) {
  const fits = eligiblePillars(functions);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-border pt-2.5">
      <span className="mr-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--pulse-faint)]">
        Fits:
      </span>
      {fits.length > 0 ? (
        fits.map((f) => (
          <span
            key={f}
            className="inline-flex items-center gap-1 rounded-full border border-primary/60 bg-primary/10 px-2.5 py-0.5 text-[10.5px] font-bold tracking-[0.02em] text-[#afc4ec]"
          >
            {PILLAR_LABELS[f] || `Pillar ${f}`}
          </span>
        ))
      ) : (
        <span className="text-[10.5px] italic text-[color:var(--pulse-faint)]">
          No pillar fit — none of 01 / 04 / 07 / 08
        </span>
      )}
    </div>
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
 * Real publish-draft controls for an event that has an F7 draft. These call the
 * existing approve / reject / edit endpoints (unlike the inbox triage which is
 * persisted via the review PATCH on the action bar).
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

/**
 * The contextual next step for a card, shown only once it has been Accepted.
 *
 * Accept is the triage signal and deliberately creates nothing (one event can
 * spawn several pillar items, so auto-creating on accept would flood the desk).
 * Instead this surfaces the ONE thing the reviewer should do next:
 *  - accepted with no editorial item yet → a link to the Canvas to write one;
 *  - accepted with an editorial item already → a link to the Front Page.
 *
 * Both are plain navigations (React Router `Link`) — no writes happen here.
 */
function AcceptedNextStep({ item, onWrite }) {
  if (item.reviewStatus !== 'accepted') return null;

  if (item.publishItemId) {
    return (
      <Link
        to="/pulse"
        onClick={(e) => e.stopPropagation()}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LayoutList className="h-3.5 w-3.5" />
        Editorial item ready — Open in Desk
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onWrite(item.id); }}
      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SquarePen className="h-3.5 w-3.5" />
      Accepted — write the briefing item →
    </button>
  );
}

// ── One wire story card ───────────────────────────────────────────────────────
// Layout: checkbox · pillar-glyph tile · story body (serif headline, clamped
// excerpt, meta row, "Fits:" row). Triage actions live in the bottom action
// bar, not in the card body.
function StoryCard({ item, selected, checked, onToggleChecked, onSelect, onWrite }) {
  const categoryLabel = PILLAR_LABELS[primaryFunction(item.functions)] || item.eventType || 'Uncategorised';

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(item.id);
    }
  };

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      onKeyDown={handleKeyDown}
      className={
        'relative flex gap-[18px] rounded-xl border bg-card px-5 py-5 text-left transition-all duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
        (checked
          ? 'border-primary/70 bg-[#14203a] shadow-[0_0_22px_rgba(59,130,246,0.14)]'
          : selected
            ? 'border-brand-purple ring-1 ring-brand-purple/40'
            : 'border-border hover:border-[color:var(--pulse-border-hi)]')
      }
    >
      {/* Reading-app selection checkbox — labelled for assistive tech. */}
      <span className="flex shrink-0 items-start pt-1" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleChecked(item.id)}
          aria-label={`Select “${item.title}”`}
          className="mt-0.5 h-[22px] w-[22px] cursor-pointer rounded-md border-[1.5px] border-[color:var(--pulse-border-hi)] text-primary focus-visible:ring-2 focus-visible:ring-ring"
        />
      </span>

      {/* Pillar-glyph tile — brand glyph, never a publisher image. */}
      <ItemThumb functionId={primaryFunction(item.functions)} className="h-[58px] w-[58px] rounded-[10px]" />

      {/* Story body */}
      <div className="min-w-0 flex-1">
        {/* Serif display headline linking to the publisher's canonical URL. */}
        <div className="mb-1.5 flex items-start gap-1.5">
          {item.canonicalUrl ? (
            <a
              href={item.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontFamily: SERIF_FAMILY }}
              className="inline-flex items-start gap-1 text-[19px] font-bold leading-[1.3] tracking-[-0.01em] text-foreground hover:text-brand-blue hover:underline"
            >
              {item.title}
              <ExternalLink className="mt-1 h-3 w-3 shrink-0" />
            </a>
          ) : (
            <h3 style={{ fontFamily: SERIF_FAMILY }} className="m-0 text-[19px] font-bold leading-[1.3] tracking-[-0.01em] text-foreground">
              {item.title}
            </h3>
          )}
        </div>

        {/* 2-line clamped excerpt (falls back to summary/whatItMeans). */}
        {(item.excerpt || item.summary) && (
          <p className="mb-2.5 line-clamp-2 text-sm text-muted-foreground">
            {item.excerpt || item.summary}
            {item.excerpt && !item.hasSummary && (
              <span className="ml-1 text-xs italic text-muted-foreground/70">· from the article</span>
            )}
          </p>
        )}

        {/* Meta row: pillar pill · source · relative time · status flags */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-[color:var(--pulse-faint)]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[#131b30] px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            {categoryLabel}
          </span>
          <span className="text-muted-foreground">{item.sourceName || '1 source'}</span>
          <span aria-hidden="true">·</span>
          <span>{relativeTime(item.publishedAt)}</span>
          <PublishStatusBadge status={item.publishStatus} />
          <NonEnglishBadge language={item.language} />
          {item.reviewStatus && item.reviewStatus !== 'new' && (
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {item.reviewStatus === 'accepted' ? 'Accepted' : 'Dismissed'}
            </span>
          )}
        </div>

        {/* Fits: which news-derived sections this story can feed. */}
        <FitsRow functions={item.functions} />

        {/* The step AFTER triage: accepted events either need writing (Canvas) or
            are ready to attach (Front Page). Nothing else is created by Accept. */}
        <AcceptedNextStep item={item} onWrite={onWrite} />
      </div>
    </article>
  );
}

// ── Detail panel (local component) ────────────────────────────────────────────
function DetailPanel({ selectedId, detail, detailLoading, detailError, detailErr, busy, onApproveDraft, onRejectDraft, onEditDraft, onDraftF7, drafting, onCreateEditorial }) {
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

  // The detail endpoint returns the full sources array, so we can be precise here.
  const sourceCount = detail.sources?.length ?? 0;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{detail.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {sourceCount} source{sourceCount === 1 ? '' : 's'}
          {detail.publishedAt && <> · {relativeTime(detail.publishedAt)}</>}
          {detail.eventType && <> · {detail.eventType}</>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
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
        {detail.reviewStatus === 'accepted' && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => onCreateEditorial(detail.id)}
          >
            <SquarePen className="h-3.5 w-3.5" />
            Create editorial item
          </Button>
        )}
      </div>

      <div>
        <ExpandableText text={detail.excerpt} lines={3} />
        {detail.excerpt && !detail.hasSummary && (
          <p className="text-xs italic text-muted-foreground/70">from the article</p>
        )}
      </div>

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
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Fits</h3>
          <FitsRow functions={detail.functions} />
        </div>
      )}

      <div className="border-t border-border pt-3">
        <h3 className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Publish draft
          <InfoTip content="Approving, editing and rejecting operate on the real F7 publish draft. Review status (Accept/Dismiss) is persisted from the action bar on the list." />
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

// ── Segmented control (the Wire / AI Review tabs) ─────────────────────────────
// A single-choice toggle rendered as a group of buttons (keyboard-operable via
// native tab + Enter/Space). `count` renders as a trailing "(n)" on the label.
function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-full border border-border bg-secondary p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={
              'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
              (active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')
            }
          >
            {opt.label}
            {typeof opt.count === 'number' && (
              <span className="ml-1 text-muted-foreground">({opt.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── AI review queue ───────────────────────────────────────────────────────────
// The second Wire mode. Shows the pending AI judgements (dedup, etc.) for
// human accept/reject. Kept a child component so the news-feed hooks above do
// not run while this mode is off (toggle switches the data source).
function AiReviewQueue() {
  const { data, isLoading, isError, error, refetch, isFetching } = useAiJudgements({ outcome: 'pending' });
  const accept = useAcceptJudgement();
  const reject = useRejectJudgement();

  const judgements = useMemo(() => data ?? [], [data]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[760px] space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-16 text-center">
        <p className="mb-3 text-sm text-destructive">Could not load AI judgements: {error?.message}</p>
        <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Try again
        </Button>
      </div>
    );
  }

  if (judgements.length === 0) {
    return (
      <EmptyState
        icon={<Check className="h-10 w-10" />}
        title="No AI decisions awaiting review"
        description="Every AI judgement has been adjudicated. New decisions appear here as the AI runs."
      />
    );
  }

  return (
    <div className="mx-auto max-w-[760px] space-y-3">
      {judgements.map((j) => (
        <AiJudgementCard
          key={j.id}
          judgement={j}
          onAccept={accept.mutateAsync}
          onReject={reject.mutateAsync}
          acceptPending={accept.isPending}
          rejectPending={reject.isPending}
        />
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PulseReview() {
  const navigate = useNavigate();
  // Mode: "news" is THE WIRE (the day-filtered reader feed); "ai" is the queue
  // of pending AI judgements awaiting accept/reject. Defaults to News.
  const [mode, setMode] = useState('news');
  const [dayKey, setDayKey] = useState(lagosTodayKey);
  const [query, setQuery] = useState('');
  // Filters are independent; each control owns its own state and all selected
  // values are forwarded together to usePulseEvents (server ANDs them). Any two
  // (or more) can be combined: Pillar + Region, Region + Review status, etc.
  const [pillar, setPillar] = useState('');
  const [region, setRegion] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [language, setLanguage] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // Checkbox selection: UI-only state, keyed by event id. Triage is applied to
  // all checked items from the bottom action bar.
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The events API has no `date` param: fetch a wide page and filter to the
  // selected Lagos day client-side (see dayKey derivation above).
  const { data, isLoading, isError, error, refetch, isFetching } = usePulseEvents({
    pageSize: 100,
    q: query.trim() || undefined,
    function: pillar || undefined,
    region: region || undefined,
    reviewStatus: reviewStatus || undefined,
    language: language || undefined,
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  // Pending AI judgement count for the "AI Review (n)" tab. Same query key as
  // the AI Review list, so this shares one fetch (no extra request when the tab
  // is open, negligible cost when it is not).
  const { data: pendingJudgements } = useAiJudgements({ outcome: 'pending' });
  const pendingCount = pendingJudgements?.length ?? 0;

  const dayItems = useMemo(() => {
    return items
      .filter((e) => e.publishedAt && lagosDayKey(e.publishedAt) === dayKey)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }, [items, dayKey]);

  const { data: detail, isLoading: detailLoading, isError: detailError, error: detailErr } = usePulseEvent(selectedId);

  // "Needs write-up": accepted events on this day that have no editorial item
  // yet. Computed entirely client-side from the list DTO, which already carries
  // `publishItemId` per event (see backend publishDraftOf) — so no extra request.
  const needsWriteUp = useMemo(
    () => dayItems.filter((it) => it.reviewStatus === 'accepted' && !it.publishItemId).length,
    [dayItems],
  );

  const acceptedCount = useMemo(
    () => dayItems.filter((it) => it.reviewStatus === 'accepted').length,
    [dayItems],
  );

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

  const toggleChecked = (id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearChecked = () => setCheckedIds(new Set());

  // "Review" opens the first selected item's detail — it is a navigation, not a
  // mutation. Checkbox selection stays as-is so the reviewer can keep working.
  const onReviewSelected = () => {
    const first = dayItems.find((it) => checkedIds.has(it.id));
    if (first) setSelectedId(first.id);
  };

  // Dismiss writes the existing review PATCH once per selected item — there is
  // no bulk endpoint, so we run N sequential calls and clear selection on success.
  // Accept uses the same PATCH with status 'accepted' (bulk = N sequential calls).
  const onReviewStatusSelected = async (status) => {
    setActionError(null);
    setNotice(null);
    const verb = status === 'accepted' ? 'Accepted' : 'Dismissed';
    const targets = dayItems.filter((it) => checkedIds.has(it.id));
    let done = 0;
    for (const it of targets) {
      try {
        await review.mutateAsync({ id: it.id, status });
        done += 1;
      } catch (err) {
        setActionError(`${verb} ${done} of ${targets.length}. ${err.message}`);
        clearChecked();
        return;
      }
    }
    setNotice(`${verb} ${done} item${done === 1 ? '' : 's'}.`);
    clearChecked();
  };

  const onAcceptSelected = () => onReviewStatusSelected('accepted');
  const onDismissSelected = () => onReviewStatusSelected('dismissed');

  // "Write piece" — open the Editorial Canvas for the first checked event to
  // write an editorial item from it. Read-only navigation; nothing is created.
  const onWrite = (id) => navigate(`/pulse/inbox/${id}/canvas`);
  const onWriteSelected = () => {
    const first = dayItems.find((it) => checkedIds.has(it.id));
    if (first) onWrite(first.id);
  };

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

  const selectedCount = checkedIds.size;
  const filtersActive = Boolean(pillar || region || reviewStatus || language);
  const editionDate = dayLabel(dayKey);

  return (
    <div className="min-h-screen pb-28">
      {/* ── Wire header ─────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1180px] px-7 pt-9">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/pulse"
            className="-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-[color:var(--pulse-faint)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            The Front Page
          </Link>
          <PipelineStepper active="wire" />
        </div>

        <h1 className="m-0 text-[34px] font-extrabold tracking-[-0.02em] text-foreground">The Wire</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          <b className="font-semibold text-foreground">{dayItems.length} {dayItems.length === 1 ? 'story' : 'stories'}</b> collected · {editionDate} · raw material for the {editionDate} edition
        </p>
      </div>

      {/* ── Toolbar: mode tab + day nav + filters + search ──────────────── */}
      <div className="mx-auto mt-5 flex max-w-[1180px] flex-wrap items-center gap-2 px-7">
        <SegmentedControl
          ariaLabel="The Wire mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'news', label: 'News' },
            { value: 'ai', label: 'AI Review', count: pendingCount },
          ]}
        />

        <div className="ml-auto flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => setDayKey((k) => shiftDayKey(k, -1))} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="min-w-[180px] text-center text-sm font-medium tabular-nums text-foreground"
            aria-live="polite"
          >
            {isToday ? `Today · ${editionDate}` : editionDate}
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
          placeholder="Search the wire…"
          aria-label="Search the wire by title"
          className="max-w-xs"
        />
        <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh the wire">
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {mode === 'ai' ? (
        <div className="mx-auto mt-5 max-w-[1180px] px-7">
          <AiReviewQueue />
        </div>
      ) : (
        <>
          {/* ── Filter chips ───────────────────────────────────────────── */}
          <div className="mx-auto mt-3 max-w-[1180px] px-7">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={filtersOpen}
                aria-pressed={filtersActive}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters{filtersActive ? ' ·' : ''}
              </Button>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={() => { setPillar(''); setRegion(''); setReviewStatus(''); setLanguage(''); }}>
                  Clear
                </Button>
              )}
              {/* Quick-access chip: the triage state the team works in most. */}
              <PillButton
                active={reviewStatus === 'accepted'}
                aria-pressed={reviewStatus === 'accepted'}
                onClick={() => setReviewStatus(reviewStatus === 'accepted' ? '' : 'accepted')}
              >
                Accepted{acceptedCount > 0 ? ` (${acceptedCount})` : ''}
              </PillButton>
              {/* Needs-write-up hint: accepted events still without an editorial
                  item. Clicking narrows the list to Accepted so the team can act. */}
              {needsWriteUp > 0 && (
                <button
                  type="button"
                  onClick={() => setReviewStatus('accepted')}
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Accepted events with no briefing item written yet"
                >
                  <SquarePen className="h-3 w-3" />
                  {needsWriteUp} need{needsWriteUp === 1 ? 's' : ''} write-up
                </button>
              )}
            </div>

            {filtersOpen && (
              <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter the wire">
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
                <span className="mx-1 h-5 w-px bg-border" />
                <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by language">
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <PillButton
                      key={opt.value || 'all'}
                      active={language === opt.value}
                      aria-pressed={language === opt.value}
                      onClick={() => setLanguage(opt.value)}
                    >
                      {opt.label}
                    </PillButton>
                  ))}
                </div>
              </div>
            )}
          </div>

          {(actionError || notice) && (
            <div className="mx-auto mt-4 max-w-[1180px] px-7">
              {actionError && (
                <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError}</p>
              )}
              {notice && (
                <p className="mt-2 rounded-md bg-secondary px-4 py-3 text-sm text-muted-foreground">{notice}</p>
              )}
            </div>
          )}

          {/* ── The feed: one centred readable column ──────────────────── */}
          {isLoading ? (
            <div className="mx-auto max-w-[760px] space-y-3.5 px-7 py-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-[18px] rounded-xl border border-border bg-card px-5 py-5">
                  <Skeleton className="h-[58px] w-[58px] shrink-0 rounded-[10px]" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="py-16 text-center">
              <p className="mb-3 text-sm text-destructive">Could not load the wire: {error?.message}</p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
            </div>
          ) : dayItems.length === 0 ? (
            <EmptyState
              icon={<Radio className="h-10 w-10" />}
              title="Nothing on the wire for this day"
              description="Nothing matches this day and filter set. Try another day, clear a filter, or refresh."
            />
          ) : (
            <>
              <div className="mx-auto max-w-[760px] space-y-3.5 px-7 py-5">
                {dayItems.map((item) => (
                  <StoryCard
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    checked={checkedIds.has(item.id)}
                    onToggleChecked={toggleChecked}
                    onSelect={setSelectedId}
                    onWrite={onWrite}
                  />
                ))}
              </div>

              {/* Detail panel — opens when a story is clicked. */}
              {selectedId && (
                <div className="mx-auto mt-2 max-w-[760px] px-7">
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
                    onCreateEditorial={onWrite}
                  />
                </div>
              )}
            </>
          )}

          <p className="mx-auto mt-6 flex max-w-[760px] items-center justify-center gap-1 px-7 text-xs text-[color:var(--pulse-faint)]">
            <Activity className="h-3 w-3" />
            The wire filtered by Lagos calendar day · {dayItems.length} item{dayItems.length === 1 ? '' : 's'}
          </p>
        </>
      )}

      {/* ── Bottom action bar: appears only when stories are checked ────── */}
      {mode === 'news' && selectedCount > 0 && (
        <div
          role="region"
          aria-label="Selected story actions"
          className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#2c5aa8] bg-[#16203a] px-5 py-2.5 shadow-[0_14px_40px_rgba(0,0,0,0.5),0_0_26px_rgba(59,130,246,0.18)]"
        >
          <span className="text-sm font-bold text-foreground">
            <span className="text-primary">{selectedCount}</span> selected
          </span>
          <span className="h-5 w-px bg-border" />
          <Button variant="ghost" size="sm" onClick={onReviewSelected} disabled={review.isPending}>
            Review
          </Button>
          <Button variant="primary" size="sm" disabled={review.isPending} onClick={onAcceptSelected}>
            {review.isPending ? 'Working…' : 'Accept'}
          </Button>
          <Button variant="ghost" size="sm" disabled={review.isPending} onClick={onDismissSelected}>
            Dismiss
          </Button>
          <Button variant="secondary" size="sm" onClick={onWriteSelected} disabled={review.isPending}>
            Write piece →
          </Button>
          <Button variant="ghost" size="sm" onClick={clearChecked} disabled={review.isPending}>
            Clear
          </Button>
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
    </div>
  );
}

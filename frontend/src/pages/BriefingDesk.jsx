import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Eye, Plus, RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label,
  PageHeader, Skeleton,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import BriefingSectionCard from '../components/pulse/BriefingSectionCard';
import {
  useBriefing, useBriefings, useCreateBriefing, useUpdateBriefing,
  useSupportingEvents, useSupportingOpportunities, useSupportingForumTopics,
  useCreateSupporting, useDeleteSupporting,
} from '../hooks/briefingQueries';

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

// Briefing lifecycle status → readable label + Badge token (all seven states).
const BRIEFING_STATUS_LABELS = {
  not_started: 'Not started',
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
};
const BRIEFING_STATUS_TOKENS = {
  not_started: 'DRAFT',
  draft: 'DRAFT',
  in_review: 'SCHEDULED',
  approved: 'READY',
  scheduled: 'SCHEDULED',
  published: 'SENT',
  archived: 'ARCHIVED',
};

// The three lifecycle states the desk may set here (publish is out of scope).
const SETTABLE_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
];

function BriefingStatusBadge({ status }) {
  if (!status) return null;
  return (
    <Badge status={BRIEFING_STATUS_TOKENS[status] || 'DRAFT'}>
      {BRIEFING_STATUS_LABELS[status] || status}
    </Badge>
  );
}

// ── Supporting records panel ──────────────────────────────────────────────────
// Three kinds, each with a list and a minimal create form. Wired to the
// `/briefings/supporting/{events|opportunities|forum-topics}` CRUD endpoints.

const SUPPORTING_TABS = [
  { key: 'events', label: 'Events' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'forum-topics', label: 'Forum Topics' },
];

/** The fields each kind's create form collects (matching the server schemas). */
const SUPPORTING_FIELDS = {
  events: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'organiser', label: 'Organiser', type: 'text', required: true },
    { name: 'startsAt', label: 'Starts at', type: 'date', required: true },
  ],
  opportunities: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'kind', label: 'Kind', type: 'select', required: true, options: ['scholarship', 'course', 'programme', 'other'] },
  ],
  'forum-topics': [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
  ],
};

function SupportingList({ kind }) {
  const events = useSupportingEvents();
  const opportunities = useSupportingOpportunities();
  const forumTopics = useSupportingForumTopics();
  const queries = { events, opportunities, 'forum-topics': forumTopics };
  const { data = [], isLoading, isError, error, refetch } = queries[kind];

  const del = useDeleteSupporting(kind);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="py-6 text-center">
        <p className="mb-2 text-sm text-destructive">Could not load {kind}: {error?.message}</p>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList className="h-8 w-8" />}
        title={`No ${kind.replace('-', ' ')} yet`}
        description="Records you add here feed the related briefing sections."
      />
    );
  }

  const primary = (item) => item.title || item.prompt || item.id;
  const secondary = (item) => item.organiser || item.provider || item.kind || '';

  return (
    <ul className="space-y-2">
      {data.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{primary(item)}</p>
            {secondary(item) && <p className="truncate text-xs text-muted-foreground">{secondary(item)}</p>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={del.isPending}
            onClick={() => del.mutate(item.id)}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

function SupportingCreateForm({ kind }) {
  const fields = SUPPORTING_FIELDS[kind];
  const create = useCreateSupporting(kind);
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);

  const setField = (name, value) => setValues((v) => ({ ...v, [name]: value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const body = {};
    for (const f of fields) {
      const raw = values[f.name];
      if (raw === undefined || raw === '') {
        if (f.required) {
          setError(`${f.label} is required.`);
          return;
        }
        continue;
      }
      body[f.name] = raw;
    }
    try {
      await create.mutateAsync(body);
      setValues({});
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      {fields.map((f) => (
        <div key={f.name}>
          <Label htmlFor={`sup-${kind}-${f.name}`}>{f.label}</Label>
          {f.type === 'textarea' ? (
            <textarea
              id={`sup-${kind}-${f.name}`}
              rows={3}
              value={values[f.name] ?? ''}
              onChange={(e) => setField(f.name, e.target.value)}
              className="input mt-1 w-full text-sm"
            />
          ) : f.type === 'select' ? (
            <select
              id={`sup-${kind}-${f.name}`}
              value={values[f.name] ?? ''}
              onChange={(e) => setField(f.name, e.target.value)}
              className="input mt-1 w-full text-sm"
            >
              <option value="">Select…</option>
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <Input
              id={`sup-${kind}-${f.name}`}
              type={f.type === 'date' ? 'date' : 'text'}
              className="mt-1"
              value={values[f.name] ?? ''}
              onChange={(e) => setField(f.name, e.target.value)}
            />
          )}
        </div>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={create.isPending}>
        <Plus className="h-4 w-4" />
        {create.isPending ? 'Adding…' : 'Add record'}
      </Button>
    </form>
  );
}

function SupportingPanel({ open, onToggle }) {
  const [tab, setTab] = useState('events');
  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={open}
          onClick={onToggle}
        >
          <CardTitle>Supporting records</CardTitle>
          {open ? <ChevronLeft className="-rotate-90 h-4 w-4 text-muted-foreground" /> : <ChevronRight className="rotate-90 h-4 w-4 text-muted-foreground" />}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Supporting record kind">
            {SUPPORTING_TABS.map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant={tab === t.key ? 'primary' : 'secondary'}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SupportingList kind={tab} />
            <SupportingCreateForm kind={tab} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Read-only preview modal ───────────────────────────────────────────────────
function PreviewModal({ open, onClose, briefing }) {
  if (!briefing) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={briefing.title || `Briefing · ${briefing.briefingDate?.slice(0, 10)}`}
      description="Read-only preview of the composed briefing."
      className="max-w-3xl"
    >
      <div className="space-y-5">
        {briefing.sections.map((section, i) => (
          <div key={section.id}>
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              {String(i + 1).padStart(2, '0')} · {section.label}
            </h3>
            {section.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items.</p>
            ) : (
              <ul className="space-y-2">
                {section.items.map((item) => (
                  <li key={item.id} className="rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                    {item.publishItem?.bodyPreview || 'No preview available.'}
                  </li>
                ))}
              </ul>
            )}
            {section.note && (
              <p className="mt-1 text-xs text-muted-foreground">Note: {section.note}</p>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BriefingDesk() {
  const [dayKey, setDayKey] = useState(lagosTodayKey);
  const [actionError, setActionError] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [supportingOpen, setSupportingOpen] = useState(false);

  // List briefings around the selected day, then pick the exact-date match.
  // The list endpoint filters by a date range, so a one-day window is precise.
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

  const [title, setTitle] = useState('');
  useEffect(() => {
    setTitle(detail?.title ?? '');
  }, [detail?.title]);

  const isToday = dayKey === lagosTodayKey();

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

  const onSaveTitle = async () => {
    setActionError(null);
    try {
      await update.mutateAsync({ id: briefing.id, body: { title } });
    } catch (err) {
      setActionError(err.message);
    }
  };

  // Progress: ready sections out of the total the API returned (never fabricated).
  const sections = detail?.sections ?? [];
  const readyCount = sections.filter((s) => s.state === 'ready').length;
  const totalSections = sections.length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-8">
      <PageHeader
        title="Briefing Desk"
        description="Compose the day's briefing — eight sections, one per pillar."
        actions={
          <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {/* Date navigation */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
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
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="desk-date" className="sr-only">Briefing date</Label>
          <Input
            id="desk-date"
            type="date"
            value={dayKey}
            onChange={(e) => { if (e.target.value) setDayKey(e.target.value); }}
            className="w-40"
          />
          <CalendarDays className="hidden h-4 w-4 text-muted-foreground md:block" />
        </div>
      </div>

      {actionError && (
        <p className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError}</p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="py-16 text-center">
          <p className="mb-3 text-sm text-destructive">Could not load briefings: {error?.message}</p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      ) : !briefing ? (
        <EmptyState
          icon={<ClipboardList className="h-10 w-10" />}
          title="No briefing for this date"
          description="Create one to start composing the day's eight sections."
          action={
            <Button onClick={onCreate} disabled={create.isPending}>
              <Plus className="h-4 w-4" />
              {create.isPending ? 'Creating…' : 'Create briefing'}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Header: status, progress, actions */}
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BriefingStatusBadge status={briefing.status} />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {readyCount} of {totalSections} sections ready
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setPreviewOpen(true)} disabled={!detail}>
                    <Eye className="h-4 w-4" />
                    Preview
                  </Button>
                </div>
              </div>

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
              </div>

              <div>
                <Label htmlFor="desk-title">Title</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    id="desk-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Briefing title (optional)…"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={update.isPending || title === (detail?.title ?? '')}
                    onClick={onSaveTitle}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sections 01–08 */}
          {detail ? (
            detail.sections.map((section, i) => (
              <BriefingSectionCard
                key={section.id}
                briefingId={detail.id}
                section={section}
                index={i}
                onError={setActionError}
              />
            ))
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}

          {/* Supporting records */}
          <SupportingPanel open={supportingOpen} onToggle={() => setSupportingOpen((v) => !v)} />
        </div>
      )}

      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} briefing={detail} />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Info, Mail, Plus, RefreshCw } from 'lucide-react';
import { Badge, Button, EmptyState, InfoTip, Input, Label, Skeleton } from '../ui';
import { Modal } from '../ui/Modal';
import { usePreviewBriefing } from '../../hooks/briefingQueries';
import {
  useSupportingEvents, useSupportingOpportunities, useSupportingForumTopics,
  useCreateSupporting, useDeleteSupporting,
} from '../../hooks/briefingQueries';
// ── Rendered-email preview modal ──────────────────────────────────────────────
// The server renders the assembled briefing through the email template and
// returns full HTML; we show it in a SANDBOXED iframe (`sandbox=""` blocks
// scripts, forms, popups, top-navigation and same-origin access, so untrusted
// article text cannot execute or reach the app).
export function PulsePreviewModal({ open, onClose, briefing }) {
  const briefingId = briefing?.id;
  const preview = usePreviewBriefing(briefingId);
  const { mutate: runPreview, reset } = preview;

  useEffect(() => {
    if (open && briefingId) runPreview();
    if (!open) reset();
  }, [open, briefingId, runPreview, reset]);

  if (!briefing) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={briefing.title || `Briefing · ${briefing.briefingDate?.slice(0, 10)}`}
      description="Preview of the rendered briefing email."
      className="max-w-3xl"
    >
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Rendered email
        </p>

        {preview.isPending ? (
          <div className="flex h-[60vh] items-center justify-center rounded border border-border bg-background">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : preview.isError ? (
          <div className="rounded border border-border bg-background p-4 text-sm text-destructive">
            Could not render the preview: {preview.error?.message || 'Unknown error'}
          </div>
        ) : preview.data ? (
          <iframe
            title="Rendered briefing email"
            srcDoc={preview.data}
            sandbox=""
            className="h-[60vh] w-full rounded border border-border bg-white"
          />
        ) : (
          <div className="flex h-[60vh] items-center justify-center rounded border border-border bg-background text-sm text-muted-foreground">
            Nothing to preview yet.
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Final review panel ────────────────────────────────────────────────────────
// The checklist items derive from real briefing data where available (sections
// included, editorial review, sources, approval). Email is the only intended
// channel — Website and PDF are deferred ("Later"). Publish is DISABLED:
// "Publishing arrives next" — the send endpoint is not built yet.
export function PulseFinalReviewPanel({ open, onClose, briefing, sections }) {
  if (!briefing) return null;

  const total = sections.length;
  const included = sections.filter((s) => s.itemCount > 0).length;
  const allIncluded = total > 0 && included === total;
  const reviewed = sections.some((s) => s.state === 'ready' || s.state === 'no_updates');
  const approved = briefing.status === 'approved';
  const sourcesVerified = included > 0;

  const checklist = [
    { label: 'All sections included', detail: `${included} of ${total} sections have content`, done: allIncluded },
    { label: 'Editorial review', detail: reviewed ? 'At least one section marked ready or no-updates' : 'No section signed off yet', done: reviewed },
    { label: 'Sources verified', detail: sourcesVerified ? 'Items are attached from reviewed intel' : 'No items attached yet', done: sourcesVerified },
    { label: 'Approval recorded', detail: approved ? 'Briefing status is Approved' : 'Set status to Approved to record sign-off', done: approved },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Final review"
      description="Confirm the briefing before it goes out."
      className="max-w-lg"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <p className="text-sm text-foreground">
            {briefing.title || `Briefing · ${briefing.briefingDate?.slice(0, 10)}`}
          </p>
        </div>

        <ul className="space-y-2">
          {checklist.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-sm">
              <CheckCircle2
                className={'mt-0.5 h-4 w-4 shrink-0 ' + (c.done ? 'text-success' : 'text-muted-foreground/40')}
                aria-hidden="true"
              />
              <span>
                <span className="font-medium text-foreground">{c.label}</span>
                <span className="ml-1 text-muted-foreground">· {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Channels</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled>
              <Mail className="h-4 w-4" />
              Email
            </Button>
            <span className="inline-flex items-center gap-1">
              <Button size="sm" variant="secondary" disabled>Website</Button>
              <Badge status="DRAFT">Later</Badge>
            </span>
            <span className="inline-flex items-center gap-1">
              <Button size="sm" variant="secondary" disabled>PDF</Button>
              <Badge status="DRAFT">Later</Badge>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Info className="h-3 w-3" />
            Publishing arrives next
            <InfoTip content="Publishing arrives next — the send endpoint is not built yet. Email is the intended first channel; Website and PDF are deferred." />
          </span>
          <Button disabled>Publish</Button>
        </div>
      </div>
    </Modal>
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

/** Collapsible supporting-records drawer, ported from the old Briefing Desk. */
export function PulseSupportingPanel({ open, onToggle }) {
  const [tab, setTab] = useState('events');
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="text-[15px] font-semibold tracking-tight text-foreground">Supporting records</span>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-5 py-4">
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
        </div>
      )}
    </div>
  );
}

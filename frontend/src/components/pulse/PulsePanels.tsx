import EditionReview from './EditionReview';
import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Info, Loader2, Mail, Plus, RefreshCw, Send } from '../ui/icons';
import { Badge, Button, EmptyState, InfoTip, Input, Label, Skeleton } from '../ui';
import { Modal } from '../ui/Modal';
import { usePreviewBriefing, usePublishBriefing } from '../../hooks/briefingQueries';
import { useSegments } from '../../hooks/queries';
import {
  useSupportingEvents, useSupportingOpportunities, useSupportingForumTopics,
  useCreateSupporting, useDeleteSupporting,
} from '../../hooks/briefingQueries';
export function PulsePreviewModal({ open, onClose, briefing, publishMode = false, onPublished }) {
  const briefingId = briefing?.id;
  const preview = usePreviewBriefing(briefingId);
  const publish = usePublishBriefing(briefingId);
  const { mutate: runPreview, reset } = preview;
  const { data: segments = [] } = useSegments();

  const [testEmail, setTestEmail] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [errorText, setErrorText] = useState(null);

  useEffect(() => {
    if (open && briefingId) runPreview();
    if (!open) reset();
  }, [open, briefingId, runPreview, reset]);

  // Reset the publish state every time the modal (re)opens or its briefing changes.
  useEffect(() => {
    setConfirmOpen(false);
    setTestEmail('');
    setSegmentId('');
    setResult(null);
    setErrorText(null);
  }, [open, briefingId]);

  if (!briefing) return null;

  const segmentConfigured = briefing.publishSegmentConfigured !== false;
  const hasContent = (briefing.itemCount ?? 0) > 0;
  const alreadyPublished = briefing.status === 'published';

  // The detail exposes whether a default segment is configured, but not its id,
  // so default the reviewer to the first available segment (or force an explicit
  // pick when there are none — the send stays disabled either way until chosen).
  const selectedSegmentId = segmentId || segments[0]?.id || '';
  const selectedSegmentName =
    segments.find((s) => s.id === selectedSegmentId)?.name || 'subscribers';
  const hasSegments = segments.length > 0;

  const onSendTest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorText(null);
    setResult(null);
    const email = testEmail.trim();
    try {
      const res = await publish.mutateAsync(email ? { test: true, email } : { test: true });
      setResult({ kind: 'test', to: res?.to });
    } catch (err) {
      setErrorText(err?.message || 'Could not send the test email.');
    }
  };

  const onSendProduction = async () => {
    setErrorText(null);
    setResult(null);
    try {
      const res = await publish.mutateAsync({ segments: [selectedSegmentId] });
      setResult({ kind: 'production', segments: res?.segments ?? [] });
      setConfirmOpen(false);
      onPublished?.(res);
      // The briefing's status is now 'published' server-side; refetch the
      // preview-adjacent detail via the caller's invalidation (onPublished).
    } catch (err) {
      setErrorText(err?.message || 'Could not send the briefing.');
      setConfirmOpen(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={briefing.title || `Briefing · ${briefing.briefingDate?.slice(0, 10)}`}
      description={publishMode ? 'Preview the rendered briefing email, then choose how to send it.' : 'Preview of the rendered briefing email.'}
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

      {publishMode && !alreadyPublished && <EditionReview briefingId={briefing.id} sections={briefing.sections || []} onChange={()=>runPreview()}/>}
      {publishMode && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          {result?.kind === 'test' && (
            <p role="status" className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-[13px] text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Test sent to {result.to}
            </p>
          )}
          {result?.kind === 'production' && (
            <p role="status" className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-[13px] text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              The briefing has been sent to {selectedSegmentName}.
            </p>
          )}
          {errorText && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {errorText}
            </p>
          )}

          {alreadyPublished && !result && (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              This edition has been sent.
            </p>
          )}

          {!hasContent && (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              Nothing to publish — add at least one piece to today&apos;s email first.
            </p>
          )}

          {confirmOpen ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
              <span className="text-[13px] text-foreground">
                Send this briefing to {selectedSegmentName}? This emails real subscribers.
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)} disabled={publish.isPending}>
                  Cancel
                </Button>
                <Button size="sm" onClick={onSendProduction} disabled={publish.isPending}>
                  {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {publish.isPending ? 'Sending…' : 'Confirm send'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <form onSubmit={onSendTest} className="flex flex-wrap items-end gap-2">
                <Label htmlFor="briefing-test-address" className="grid gap-1">
                  Test recipient
                  <Input id="briefing-test-address" type="email" autoComplete="email"
                    placeholder="Defaults to your staff email" value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)} disabled={publish.isPending} />
                </Label>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={!hasContent || publish.isPending}
              >
                {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send test email
              </Button>
              </form>
              <Label htmlFor="briefing-target-segment" className="grid gap-1">
                Send to
                <select
                  id="briefing-target-segment"
                  className="input w-full text-sm"
                  value={selectedSegmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  disabled={!hasSegments || publish.isPending}
                >
                  {!hasSegments && <option value="">No segments available</option>}
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Label>
              <span className="inline-flex items-center gap-1">
                <Button
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!hasContent || !selectedSegmentId || !segmentConfigured || !briefing.reviewComplete || alreadyPublished || publish.isPending}
                >
                  <Send className="h-4 w-4" />
                  Send to {selectedSegmentName}
                </Button>
                {!segmentConfigured && (
                  <InfoTip content="Select a newsletter audience in the delivery settings." label="No segment configured" />
                )}
                {segmentConfigured && !hasSegments && (
                  <InfoTip content="No segments are available. Configure a newsletter audience in the delivery settings." label="No segments available" />
                )}
              </span>
            </div>
          )}
        </div>
      )}
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

/** Collapsible supporting-records drawer, ported from the old Briefing surface. */
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

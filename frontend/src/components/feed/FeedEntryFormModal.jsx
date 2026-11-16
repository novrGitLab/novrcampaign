import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button, Input, Label } from '../ui';
import { prefillFromUrl } from './prefill';

const SOURCE_TYPES = [
  { value: 'x', label: 'X / Twitter' },
  { value: 'news', label: 'News' },
  { value: 'regulator', label: 'Regulator' },
  { value: 'other', label: 'Other' },
];

const STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'archived', label: 'Archived' },
];

// datetime-local value (YYYY-MM-DDTHH:mm) from an ISO string, rendered in
// Africa/Lagos (UTC+1, no DST) so capture matches the Lagos week model.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

function toLagosInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() + LAGOS_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

// Interpret a Lagos-local datetime-local value as a UTC instant.
function lagosInputToIso(value) {
  if (!value) return '';
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart || '00:00').split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - LAGOS_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

const emptyForm = () => ({
  url: '',
  sourceType: 'news',
  sourceName: '',
  author: '',
  publishedAt: toLagosInput(new Date().toISOString()),
  title: '',
  summary: '',
  status: 'draft',
});

/**
 * Capture / edit a feed entry. Built on the shared Modal + ui primitives.
 * @param {{ open, onClose, entry, onSubmit, saving, error }} props
 */
export default function FeedEntryFormModal({ open, onClose, entry, onSubmit, saving, error }) {
  const [form, setForm] = useState(emptyForm);
  const [touchedType, setTouchedType] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setForm({
        url: entry.url ?? '',
        sourceType: entry.sourceType ?? 'news',
        sourceName: entry.sourceName ?? '',
        author: entry.author ?? '',
        publishedAt: toLagosInput(entry.publishedAt),
        title: entry.title ?? '',
        summary: entry.summary ?? '',
        status: entry.status ?? 'draft',
      });
      setTouchedType(true);
    } else {
      setForm(emptyForm());
      setTouchedType(false);
    }
  }, [open, entry]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onUrlChange = (e) => {
    const url = e.target.value;
    setForm((f) => {
      const next = { ...f, url };
      // Prefill sourceType/sourceName from the hostname unless the user has
      // already overridden the type on an edit.
      if (!entry && !touchedType) {
        const pre = prefillFromUrl(url);
        if (pre) {
          if (pre.sourceType) next.sourceType = pre.sourceType;
          if (pre.sourceName) next.sourceName = pre.sourceName;
        }
      }
      return next;
    });
  };

  const submit = (e) => {
    e.preventDefault();
    const payload = {
      url: form.url.trim(),
      sourceType: form.sourceType,
      sourceName: form.sourceName.trim(),
      author: form.author.trim() || null,
      publishedAt: form.publishedAt ? lagosInputToIso(form.publishedAt) : '',
      title: form.title.trim(),
      summary: form.summary.trim(),
      status: form.status,
    };
    onSubmit(payload);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? 'Edit update' : "Add this week's update"}
      description="Write your own summary and link the source. Keep it in your words."
      className="max-w-2xl"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="feed-url">Source URL</Label>
          <Input
            id="feed-url"
            value={form.url}
            onChange={onUrlChange}
            placeholder="https://…"
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="feed-sourceType">Source type</Label>
            <select
              id="feed-sourceType"
              value={form.sourceType}
              onChange={(e) => { setTouchedType(true); set('sourceType')(e); }}
              className="input"
            >
              {SOURCE_TYPES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="feed-sourceName">Source name</Label>
            <Input id="feed-sourceName" value={form.sourceName} onChange={set('sourceName')} placeholder="NCC" required />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="feed-author">Author (optional)</Label>
            <Input id="feed-author" value={form.author} onChange={set('author')} placeholder="@handle or reporter" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="feed-publishedAt">Published at</Label>
            <Input id="feed-publishedAt" type="datetime-local" value={form.publishedAt} onChange={set('publishedAt')} required />
            <p className="text-xs text-muted-foreground">Africa/Lagos time — drives which week this update shows in.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="feed-title">Title</Label>
          <Input id="feed-title" value={form.title} onChange={set('title')} placeholder="Short headline" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="feed-summary">Summary</Label>
          <textarea
            id="feed-summary"
            value={form.summary}
            onChange={set('summary')}
            rows={4}
            className="input min-h-[96px] resize-y"
            placeholder="Your own words — what happened and why it matters."
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="feed-status">Status</Label>
          <select id="feed-status" value={form.status} onChange={set('status')} className="input">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : entry ? 'Save changes' : 'Add update'}</Button>
        </div>
      </form>
    </Modal>
  );
}

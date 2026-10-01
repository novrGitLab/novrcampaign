import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Search, Users, ChevronRight, ChevronLeft, CheckCircle2, XCircle, UserPlus, ClipboardList } from 'lucide-react';
import { useContacts, useSegments } from '../hooks/queries';
import { useBulkContactAction, useCreateContact, useImportContacts } from '../hooks/mutations';
import api from '../lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { formatNumber } from '../lib/utils';

const PAGE_SIZE = 25;

export default function Contacts() {
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [cursor, setCursor] = useState(undefined);
  const [cursors, setCursors] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const { data, isLoading, isFetching } = useContacts({
    limit: PAGE_SIZE,
    cursor,
    search: activeSearch || undefined,
  });

  const importContacts = useImportContacts();
  const bulkAction = useBulkContactAction();

  const contacts = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasMore = Boolean(data?.hasMore);

  const onSearch = (e) => {
    e.preventDefault();
    setActiveSearch(search);
    setCursor(undefined);
    setCursors([]);
    setSelected(new Set());
  };

  const nextPage = () => {
    if (!data?.cursor) return;
    setCursors((c) => [...c, cursor]);
    setCursor(data.cursor);
    setSelected(new Set());
  };

  const prevPage = () => {
    const prev = cursors[cursors.length - 1];
    setCursors((c) => c.slice(0, -1));
    setCursor(prev);
    setSelected(new Set());
  };

  const toggleAll = () => {
    if (contacts.every((c) => selected.has(c.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(contacts.map((c) => c.id)));
    }
  };

  const toggleOne = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onBulk = async (action) => {
    if (!selected.size) return;
    try {
      await bulkAction.mutateAsync({ action, ids: [...selected] });
      setSelected(new Set());
    } catch (err) {
      alert(err.message);
    }
  };

  const allChecked = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  return (
    <div className="mx-auto max-w-[1400px] p-6 sm:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatNumber(total)} contacts in your Plunk project
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add contact
          </Button>
          <Button variant="secondary" onClick={() => setPasteOpen(true)}>
            <ClipboardList className="h-4 w-4" />
            Paste a list
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
        </div>
      </div>

      <form onSubmit={onSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email…"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>All contacts</CardTitle>
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <Button variant="secondary" size="sm" onClick={() => onBulk('unsubscribe')}>
                Unsubscribe
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="text-destructive"
                onClick={() => onBulk('delete')}
              >
                Delete
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading contacts…</p>
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="No contacts found"
              description={activeSearch ? 'Try a different search term.' : 'Add one manually, paste a list, or import a CSV.'}
              action={
                !activeSearch && (
                  <Button onClick={() => setUploadOpen(true)}>
                    <Upload className="h-4 w-4" />
                    Import CSV
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead className="border-b">
                  <tr>
                    <th className="w-10">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
                    </th>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Subscribed</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          aria-label={`Select ${c.email}`}
                        />
                      </td>
                      <td className="font-medium">{c.email}</td>
                      <td className="text-muted-foreground">
                        {[c.data?.firstName, c.data?.lastName].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td>
                        {c.subscribed ? (
                          <Badge status="SUBSCRIBED">Subscribed</Badge>
                        ) : (
                          <Badge status="UNSUBSCRIBED">Unsubscribed</Badge>
                        )}
                      </td>
                      <td className="text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {(contacts.length > 0 || cursors.length > 0) && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {isFetching ? 'Loading…' : `Showing ${contacts.length} of ${formatNumber(total)}`}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={prevPage} disabled={cursors.length === 0}>
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button variant="secondary" size="sm" onClick={nextPage} disabled={!hasMore}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} importContacts={importContacts} />
      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
      <PasteListModal open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </div>
  );
}

function UploadModal({ open, onClose, importContacts }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [checkMx, setCheckMx] = useState(true);

  const onDrop = (accepted) => {
    setFile(accepted[0] ?? null);
    setResult(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
  });

  const onUpload = async () => {
    if (!file) return;
    try {
      const res = await importContacts.mutateAsync({ file, checkMx });
      setResult(res);
    } catch (err) {
      setResult({ error: err.message });
    }
  };

  const close = () => {
    setFile(null);
    setResult(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import contacts from CSV"
      description="First column must be `email`; other columns become contact fields. Max 5 MB."
    >
      {!result ? (
        <div className="space-y-4">
          <div
            {...getRootProps()}
            className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-input bg-secondary/30 p-8 text-center transition-colors hover:bg-secondary/60"
          >
            <input {...getInputProps()} />
            <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-sm font-medium">Drop the CSV here…</p>
            ) : (
              <p className="text-sm font-medium">
                {file ? file.name : 'Drag & drop a CSV, or click to browse'}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={checkMx} onChange={(e) => setCheckMx(e.target.checked)} />
            Validate MX records before import (recommended)
          </label>

          <Button className="w-full" onClick={onUpload} disabled={!file || importContacts.isPending}>
            {importContacts.isPending ? 'Validating & uploading…' : 'Import contacts'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {result.error ? (
            <div className="flex gap-3 rounded-md bg-destructive/10 p-4 text-sm text-destructive">
              <XCircle className="h-5 w-5 shrink-0" />
              <p>{result.error}</p>
            </div>
          ) : (
            <>
              <div className="flex gap-3 rounded-md bg-emerald-50 p-4 text-sm text-emerald-800">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <p>Import queued. {result.message}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-secondary/60 p-3">
                  <p className="text-muted-foreground">Total rows</p>
                  <p className="text-lg font-semibold">{formatNumber(result.report.total)}</p>
                </div>
                <div className="rounded-md bg-emerald-50 p-3">
                  <p className="text-emerald-700">Valid</p>
                  <p className="text-lg font-semibold text-emerald-800">{formatNumber(result.report.valid)}</p>
                </div>
                <div className="rounded-md bg-amber-50 p-3">
                  <p className="text-amber-700">Rejected</p>
                  <p className="text-lg font-semibold text-amber-800">
                    {formatNumber(result.report.invalid.length)}
                  </p>
                </div>
                <div className="rounded-md bg-secondary/60 p-3">
                  <p className="text-muted-foreground">Duplicates</p>
                  <p className="text-lg font-semibold">{formatNumber(result.report.duplicates)}</p>
                </div>
              </div>

              {result.report.invalid.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Rejected addresses</p>
                  <ul className="space-y-1 text-xs">
                    {result.report.invalid.slice(0, 50).map((row, i) => (
                      <li key={`${row.email}-${i}`} className="flex justify-between gap-2">
                        <span className="truncate">{row.email}</span>
                        <span className="shrink-0 text-muted-foreground">{row.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Job ID: <code className="font-mono">{result.jobId}</code> — processing happens in Plunk.
              </p>
            </>
          )}

          <div className="flex gap-2">
            {result.error ? (
              <Button className="w-full" onClick={() => setResult(null)}>
                Try again
              </Button>
            ) : (
              <Button className="w-full" onClick={close}>
                Done
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function AddContactModal({ open, onClose }) {
  const createContact = useCreateContact();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [subscribed, setSubscribed] = useState(true);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  const close = () => {
    setEmail('');
    setFirstName('');
    setLastName('');
    setSubscribed(true);
    setError(null);
    setSaved(null);
    onClose();
  };

  const onSave = async () => {
    setError(null);
    try {
      const data = {};
      if (firstName.trim()) data.firstName = firstName.trim();
      if (lastName.trim()) data.lastName = lastName.trim();
      const contact = await createContact.mutateAsync({
        email: email.trim(),
        subscribed,
        ...(Object.keys(data).length > 0 ? { data } : {}),
      });
      setSaved(contact);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Add contact" description="Create or update a single contact in Plunk.">
      {saved ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-md bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <p>
              {saved.isNew === false ? 'Updated existing contact' : 'Contact created'}: {saved.email}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setSaved(null);
                setEmail('');
                setFirstName('');
                setLastName('');
              }}
            >
              Add another
            </Button>
            <Button className="w-full" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
          <div className="space-y-2">
            <Label htmlFor="add-email">Email</Label>
            <Input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@cybernovr.com" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="add-first">First name</Label>
              <Input id="add-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Ada" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-last">Last name</Label>
              <Input id="add-last" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Lovelace" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={subscribed} onChange={(e) => setSubscribed(e.target.checked)} />
            Subscribed to marketing emails
          </label>
          <Button className="w-full" onClick={onSave} disabled={!email.trim() || createContact.isPending}>
            {createContact.isPending ? 'Saving…' : 'Save contact'}
          </Button>
        </div>
      )}
    </Modal>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PasteListModal({ open, onClose }) {
  const { data: segments = [] } = useSegments();
  const staticSegments = segments.filter((s) => s.type === 'STATIC');
  const [text, setText] = useState('');
  const [subscribed, setSubscribed] = useState(true);
  const [segmentId, setSegmentId] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);

  const close = () => {
    setText('');
    setSegmentId('');
    setProgress(null);
    setReport(null);
    onClose();
  };

  const onAdd = async () => {
    const lines = text.split(/[\n,;]+/).map((l) => l.trim().toLowerCase()).filter(Boolean);
    const unique = [...new Set(lines)];
    const valid = unique.filter((e) => EMAIL_RE.test(e));
    const invalid = unique.filter((e) => !EMAIL_RE.test(e)).map((email) => ({ email, reason: 'Invalid format' }));

    setRunning(true);
    setProgress({ done: 0, total: valid.length });
    setReport(null);

    let created = 0;
    let updated = 0;
    const failed = [];
    const upserted = [];

    // Small concurrency pool so we stay inside the Plunk rate budget
    const CONCURRENCY = 5;
    for (let i = 0; i < valid.length; i += CONCURRENCY) {
      const batch = valid.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((email) => api('/contacts', { method: 'POST', body: { email, subscribed } })),
      );
      results.forEach((r, j) => {
        if (r.status === 'fulfilled') {
          if (r.value?.isNew === false) updated += 1;
          else created += 1;
          upserted.push(batch[j]);
        } else {
          failed.push({ email: batch[j], reason: r.reason?.message ?? 'Request failed' });
        }
      });
      setProgress({ done: Math.min(i + CONCURRENCY, valid.length), total: valid.length });
    }

    let segmentResult = null;
    if (segmentId && upserted.length > 0) {
      try {
        segmentResult = await api(`/segments/${segmentId}/members`, {
          method: 'POST',
          body: { emails: upserted, createMissing: true },
        });
      } catch (err) {
        segmentResult = { error: err.message };
      }
    }

    setRunning(false);
    setReport({ created, updated, invalid, failed, segmentResult, total: unique.length });
  };

  const segmentName = segments.find((s) => s.id === segmentId)?.name;

  return (
    <Modal open={open} onClose={close} title="Paste a list" description="One email per line (commas and semicolons work too). Duplicates are removed automatically.">
      {!report ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="paste-emails">Emails</Label>
            <textarea
              id="paste-emails"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={running}
              className="input min-h-[160px] resize-y font-mono text-xs"
              placeholder={'ada@cybernovr.com\nlovelace@example.com'}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="paste-segment">Add to segment (optional)</Label>
              <select id="paste-segment" value={segmentId} onChange={(e) => setSegmentId(e.target.value)} disabled={running} className="input">
                <option value="">No segment — contacts only</option>
                {staticSegments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {segments.length > 0 && staticSegments.length === 0 && (
                <p className="text-xs text-amber-600">Only STATIC segments accept manual members.</p>
              )}
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={subscribed} onChange={(e) => setSubscribed(e.target.checked)} disabled={running} />
                Subscribed to marketing
              </label>
            </div>
          </div>
          {running && progress && (
            <p className="text-sm text-muted-foreground">
              Adding {progress.done} of {progress.total}…
            </p>
          )}
          <Button className="w-full" onClick={onAdd} disabled={!text.trim() || running}>
            {running ? 'Adding…' : 'Add contacts'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-emerald-50 p-3">
              <p className="text-emerald-700">Created</p>
              <p className="text-lg font-semibold text-emerald-800">{report.created}</p>
            </div>
            <div className="rounded-md bg-secondary/60 p-3">
              <p className="text-muted-foreground">Updated</p>
              <p className="text-lg font-semibold">{report.updated}</p>
            </div>
            <div className="rounded-md bg-amber-50 p-3">
              <p className="text-amber-700">Invalid</p>
              <p className="text-lg font-semibold text-amber-800">{report.invalid.length}</p>
            </div>
            <div className="rounded-md bg-destructive/10 p-3">
              <p className="text-destructive">Failed</p>
              <p className="text-lg font-semibold text-destructive">{report.failed.length}</p>
            </div>
          </div>

          {report.segmentResult && (
            <p className="rounded-md bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
              {report.segmentResult.error
                ? `Could not add to “${segmentName}”: ${report.segmentResult.error}`
                : `Added to segment “${segmentName}”.`}
            </p>
          )}

          {(report.invalid.length > 0 || report.failed.length > 0) && (
            <div className="max-h-40 overflow-y-auto rounded-md border p-3">
              <ul className="space-y-1 text-xs">
                {[...report.invalid, ...report.failed].slice(0, 50).map((row, i) => (
                  <li key={`${row.email}-${i}`} className="flex justify-between gap-2">
                    <span className="truncate">{row.email}</span>
                    <span className="shrink-0 text-muted-foreground">{row.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" className="w-full" onClick={() => { setReport(null); setText(''); }}>
              Add more
            </Button>
            <Button className="w-full" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

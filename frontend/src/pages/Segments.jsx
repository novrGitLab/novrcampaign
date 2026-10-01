import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, Trash2 } from 'lucide-react';
import { useSegments } from '../hooks/queries';
import { useCreateSegment, useDeleteSegment } from '../hooks/mutations';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import ConditionBuilder, { emptyCondition, serializeCondition, CONDITION_PRESETS } from '../components/ConditionBuilder';

const freshForm = () => ({ name: '', description: '', type: 'STATIC', condition: emptyCondition(), trackMembership: false });

export default function Segments() {
  const { data: segments = [], isLoading } = useSegments();
  const createSegment = useCreateSegment();
  const deleteSegment = useDeleteSegment();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(freshForm());

  const onCreate = async () => {
    setError(null);
    try {
      const payload = { name: form.name, description: form.description, type: form.type };
      if (form.type === 'DYNAMIC') {
        payload.condition = serializeCondition(form.condition);
        if (form.trackMembership) payload.trackMembership = true;
      }
      await createSegment.mutateAsync(payload);
      setOpen(false);
      setForm(freshForm());
    } catch (err) {
      setError(err.message);
    }
  };

  const onDelete = async (segment) => {
    if (!confirm(`Delete "${segment.name}"?`)) return;
    try {
      await deleteSegment.mutateAsync(segment.id);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 sm:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Segments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Named audiences from Plunk — target them from the campaign builder.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New segment
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All segments {segments.length > 0 && `(${segments.length})`}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading segments…</p>
          ) : segments.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="No segments yet"
              description="Create a STATIC list (manual members), or a DYNAMIC segment with the visual filter builder."
              action={
                <Button onClick={() => setOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New segment
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead className="border-b">
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="text-right">Members</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {segments.map((s) => (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td>
                        <Link to={`/segments/${s.id}`} className="font-medium hover:underline">
                          {s.name}
                        </Link>
                        {s.description && (
                          <p className="max-w-xs truncate text-xs text-muted-foreground">{s.description}</p>
                        )}
                      </td>
                      <td>
                        <Badge status={s.type}>{s.type}</Badge>
                      </td>
                      <td className="text-right tabular-nums">{s.memberCount ?? '—'}</td>
                      <td>
                        <button
                          onClick={() => onDelete(s)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Delete segment"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New segment" description="STATIC lists take manual members. DYNAMIC segments compute membership from filters." className="max-w-2xl">
        <div className="space-y-4">
          {error && <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="seg-name">Name</Label>
              <Input id="seg-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Beta testers" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seg-type">Type</Label>
              <select id="seg-type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="input">
                <option value="STATIC">Static — manual members</option>
                <option value="DYNAMIC">Dynamic — filter condition</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="seg-desc">Description</Label>
            <Input id="seg-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional" />
          </div>

          {form.type === 'DYNAMIC' && (
            <>
              <div className="space-y-2">
                <Label>Start from a preset</Label>
                <div className="flex flex-wrap gap-2">
                  {CONDITION_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, condition: p.build() }))}
                      className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              <ConditionBuilder value={form.condition} onChange={(condition) => setForm((f) => ({ ...f, condition }))} />
              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.trackMembership}
                  onChange={(e) => setForm((f) => ({ ...f, trackMembership: e.target.checked }))}
                  className="mt-1"
                />
                <span>
                  Track membership changes — fires <code className="font-mono text-xs">segment.&lt;slug&gt;.entry/exit</code> events
                  for workflows and webhooks.
                </span>
              </label>
            </>
          )}

          <Button className="w-full" onClick={onCreate} disabled={!form.name.trim() || createSegment.isPending}>
            {createSegment.isPending ? 'Creating…' : 'Create segment'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

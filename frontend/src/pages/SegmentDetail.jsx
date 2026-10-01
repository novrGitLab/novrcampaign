import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { UserPlus, UserMinus, RefreshCw } from 'lucide-react';
import { useSegment, useSegmentContacts, toArray } from '../hooks/queries';
import { useSegmentMembers } from '../hooks/mutations';
import api from '../lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '../components/ui';

export default function SegmentDetail() {
  const { id } = useParams();
  const { data: segment } = useSegment(id);
  const [page, setPage] = useState(1);
  const { data: members, isLoading, refetch } = useSegmentContacts(id, { page, pageSize: 25 });
  const { add, remove } = useSegmentMembers(id);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);

  const rows = toArray(members?.contacts ?? members?.data);

  const onAdd = async () => {
    setError(null);
    try {
      await add.mutateAsync({ emails: [email], createMissing: true });
      setEmail('');
    } catch (err) {
      setError(err.message);
    }
  };

  const onRemove = async (memberEmail) => {
    if (!confirm(`Remove ${memberEmail}?`)) return;
    try {
      await remove.mutateAsync([memberEmail]);
    } catch (err) {
      alert(err.message);
    }
  };

  const onRefresh = async (kind) => {
    try {
      await api(`/segments/${id}/${kind}`, { method: 'POST' });
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 sm:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{segment?.name ?? 'Segment'}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {segment?.type && <Badge status={segment.type}>{segment.type}</Badge>}
            {segment?.memberCount !== undefined && segment?.memberCount !== null && <span>{segment.memberCount} members</span>}
            {segment?.description && <span>· {segment.description}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => onRefresh('refresh')}>
            <RefreshCw className="h-4 w-4" />
            Refresh count
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onRefresh('compute')}>
            Recompute
          </Button>
        </div>
      </div>

      {error && <p className="mb-6 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {segment?.type === 'STATIC' && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Add members</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 space-y-2">
              <Label htmlFor="member-email">Email</Label>
              <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@cybernovr.com" />
            </div>
            <div className="flex items-end">
              <Button onClick={onAdd} disabled={!email || add.isPending}>
                <UserPlus className="h-4 w-4" />
                {add.isPending ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading members…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No members on this page.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead className="border-b">
                  <tr>
                    <th>Email</th>
                    <th>Subscribed</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id ?? m.email} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="font-medium">{m.email}</td>
                      <td>
                        <Badge status={m.subscribed ? 'SUBSCRIBED' : 'UNSUBSCRIBED'}>
                          {m.subscribed ? 'Subscribed' : 'Unsubscribed'}
                        </Badge>
                      </td>
                      <td>
                        {segment?.type === 'STATIC' && (
                          <button
                            onClick={() => onRemove(m.email)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Remove ${m.email}`}
                            title="Remove"
                          >
                            <UserMinus className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between border-t p-4">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">Page {page}</span>
            <Button variant="ghost" size="sm" disabled={rows.length < 25} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

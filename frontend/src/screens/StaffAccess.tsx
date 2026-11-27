import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, PageHeader } from '@/components/ui';
import { DataTable, FilterTabs, Pagination } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { roles, type AccessRequest, type ReviewStatus, type StaffRole } from '@/lib/staffAccess';

const tabs = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'DECLINED', label: 'Declined' },
] as const;
const roleOptions = Object.entries(roles).map(([key, label]) => ({ key: key as StaffRole, label }));
const permissions = {
  ADMIN: 'Can review staff access, manage the newsroom and send editions.',
  SENDER: 'Can edit and send editions.',
  VIEWER: 'Can read the editorial desk.',
};
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
interface AccessPage {
  items: AccessRequest[];
  total: number;
  pages: number;
}

export default function StaffAccess() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [status, setStatus] = useState<ReviewStatus>('PENDING');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AccessRequest | null>(null);
  const [role, setRole] = useState<StaffRole>('ADMIN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const entries = useQuery<AccessPage>({
    queryKey: ['staff-access', status, page],
    queryFn: ({ signal }) => api('/staff-access', { query: { status, page }, signal }),
    enabled: user?.role === 'ADMIN',
  });
  async function decide(action: 'approve' | 'decline') {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/staff-access/' + selected.id + '/decision', {
        method: 'POST',
        body: action === 'approve' ? { action, role } : { action },
      });
      setMessage(
        selected.email +
          (action === 'approve'
            ? ' was granted ' + roles[role].toLowerCase() + ' access.'
            : ' was declined.'),
      );
      setSelected(null);
      setPage(1);
      await cache.invalidateQueries({ queryKey: ['staff-access'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The decision could not be saved.');
      await cache.invalidateQueries({ queryKey: ['staff-access'] });
    } finally {
      setBusy(false);
    }
  }
  if (user?.role !== 'ADMIN')
    return <p className="p-8">Administrator access is required to review staff requests.</p>;
  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <PageHeader title="Staff access" description="Review newsroom requests and assign a role." />
      <FilterTabs
        options={tabs}
        value={status}
        onChange={(key) => {
          setStatus(key);
          setPage(1);
          setMessage('');
        }}
        label="Request status"
      />
      {message && <p role="status">{message}</p>}
      {entries.isLoading && <p role="status">Loading requests…</p>}
      {entries.isError && (
        <p role="alert">
          Requests could not be loaded.{' '}
          <Button variant="ghost" onClick={() => entries.refetch()}>
            Try again
          </Button>
        </p>
      )}
      {entries.data && (
        <Card>
          {entries.data.items.length === 0 ? (
            <p className="p-6 text-muted-foreground">No {status.toLowerCase()} requests.</p>
          ) : (
            <DataTable label="Staff access requests">
              <thead>
                <tr>
                  <th scope="col">Staff member</th>
                  <th scope="col">Requested</th>
                  <th scope="col">{status === 'PENDING' ? 'Action' : 'Decision'}</th>
                </tr>
              </thead>
              <tbody>
                {entries.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <span className="block text-sm text-muted-foreground">{item.email}</span>
                    </td>
                    <td>{date(item.requestedAt)}</td>
                    <td>
                      {status === 'PENDING' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setSelected(item);
                            setRole('ADMIN');
                            setError('');
                          }}
                        >
                          Review
                        </Button>
                      ) : (
                        <>
                          {item.role && <strong className="block">{roles[item.role]}</strong>}
                          {date(item.decidedAt)}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {entries.data.pages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-4">
              <span>
                Page {page} of {entries.data.pages}
              </span>
              <Pagination
                label="Access request pages"
                canPrevious={page > 1}
                canNext={page < entries.data.pages}
                previous={() => setPage(page - 1)}
                next={() => setPage(page + 1)}
              />
            </div>
          )}
        </Card>
      )}
      <Modal
        open={!!selected}
        title="Review newsroom access"
        description={selected?.email}
        onClose={() => {
          if (!busy) setSelected(null);
        }}
      >
        <fieldset disabled={busy} className="space-y-3">
          <legend className="mb-2 font-semibold">Newsroom role</legend>
          <FilterTabs<StaffRole>
            options={roleOptions}
            value={role}
            onChange={setRole}
            label="Newsroom role"
          />
          <p className="text-sm text-muted-foreground">{permissions[role]}</p>
        </fieldset>
        {error && (
          <p role="alert" className="mt-3">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => decide('decline')}>
            Decline request
          </Button>
          <Button disabled={busy} onClick={() => decide('approve')}>
            Grant access
          </Button>
        </div>
      </Modal>
    </section>
  );
}

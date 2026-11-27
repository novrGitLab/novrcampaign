'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Input, PageHeader } from '@/components/ui';
import { Pagination } from '@/components/ui/DataTable';
import { EditionChoice, editions } from '@/components/ui/EditionChoice';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';

const decisions: Record<string, string> = {
  outside_scope: 'Screened out as outside cybersecurity coverage.',
  low_confidence: 'The verdict fell below the 70% confidence threshold.',
  missing_confidence: 'The screening verdict had no valid confidence score.',
  missing_reason: 'The screening verdict included no supporting reason.',
  legacy: 'Earlier screening recorded only the outcome.',
};
type Row = {
  id: string; title: string; source: string | null; publishedAt: string | null; version: number;
  dismissed: boolean; decision: string | null; reason: string | null; confidence: number | null; restriction: string | null;
};

export default function RejectedStories() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(['']);
  const [selected, setSelected] = useState('');
  const [edition, setEdition] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState<{ id: string; title: string; edition: string } | null>(null);
  const after = pages.at(-1);
  const { data, isPending, isError, refetch } = useQuery<{ items: Row[]; next: string | null }>({
    queryKey: ['rejected-stories', search, after],
    queryFn: () => api('/articles/rejected', { query: { ...(after && { after }), ...(search && { search }) } }),
    enabled: user?.role === 'ADMIN',
  });
  function choose(id: string) {
    setSelected(id);
    setEdition('');
    setError('');
  }
  async function restore(row: Row) {
    if (saving || !edition) return;
    setSaving(true);
    setError('');
    try {
      await api('/articles/' + row.id + '/restore', { method: 'POST', body: { version: row.version, region: edition } });
      setRestored({ id: row.id, title: row.title, edition: editions.find((item) => item.key === edition)!.label });
      choose('');
      setPages(['']);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['rejected-stories'] }),
        cache.invalidateQueries({ queryKey: ['article-queue'] }),
        cache.invalidateQueries({ queryKey: ['review-record', row.id] }),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The story could not be restored.');
      await refetch();
    } finally {
      setSaving(false);
    }
  }
  if (user?.role !== 'ADMIN') return <p className="p-6">Administrator access required.</p>;
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <PageHeader title="Rejected stories" description="Review the decision, choose an edition and return a story to article review."
        actions={<Link className="btn-secondary" href="/articles">Article review</Link>} />
      <form className="flex items-end gap-2" onSubmit={(event) => {
        event.preventDefault(); choose(''); setPages(['']); setSearch(term.trim());
      }}>
        <label className="label flex-1" htmlFor="rejected-search">Find a headline
          <Input id="rejected-search" maxLength={120} value={term} onChange={(event) => setTerm(event.target.value)} />
        </label>
        <Button variant="secondary">Search</Button>
      </form>
      {restored && <p role="status">Restored to {restored.edition} for review. <Link className="underline" href={'/articles/' + restored.id}>Open “{restored.title}”</Link></p>}
      {isPending && <p role="status">Loading stories…</p>}
      {isError && <Button variant="secondary" onClick={() => refetch()}>Retry loading stories</Button>}
      {data?.items.length === 0 && <EmptyState title={search ? 'No matching rejected stories' : 'No rejected stories in this queue'} />}
      {data && <>
        <ul className="divide-y divide-border">
          {data.items.map((row) => <li key={row.id} className="space-y-2 py-5">
            <p className="text-sm text-muted-foreground">{[row.source, row.publishedAt && new Date(row.publishedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })].filter(Boolean).join(' · ')}</p>
            <h2 className="text-lg font-semibold">{row.title}</h2>
            {row.dismissed && <p>Dismissed by the newsroom.</p>}
            {row.decision && <p>{decisions[row.decision] || decisions.legacy}</p>}
            {row.reason && <p className="text-sm text-muted-foreground">{row.reason}</p>}
            {row.confidence !== null && <p className="text-sm text-muted-foreground">Screening confidence {Math.round(row.confidence * 100)}%</p>}
            {row.restriction ? <p className="text-sm font-medium">{row.restriction}</p> : selected === row.id ? (
              <fieldset className="space-y-3" disabled={saving}>
                <EditionChoice value={edition} onChange={setEdition} />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!edition || saving} onClick={() => restore(row)}>{saving ? 'Restoring…' : 'Restore to review'}</Button>
                  <Button variant="secondary" onClick={() => choose('')}>Cancel</Button>
                </div>
              </fieldset>
            ) : <Button size="sm" variant="secondary" disabled={saving} onClick={() => choose(row.id)}>Choose edition</Button>}
          </li>)}
        </ul>
        {error && <p role="alert">{error}</p>}
        <Pagination label="Rejected stories pages" canPrevious={pages.length > 1 && !saving} canNext={Boolean(data.next) && !saving}
          previous={() => { choose(''); setPages((old) => old.slice(0, -1)); }}
          next={() => { choose(''); setPages((old) => [...old, data.next!]); }} />
      </>}
    </div>
  );
}

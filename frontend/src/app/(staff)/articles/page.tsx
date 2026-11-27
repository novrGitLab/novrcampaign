'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button, EmptyState, Input, PageHeader } from '@/components/ui';

type Row = { id: string; title: string; articleVersion: number; articleApprovedAt: string | null };
export default function Articles() {
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState<string[]>(['']);
  const after = pages.at(-1);
  const { data, isPending, isError, refetch } = useQuery<{ items: Row[]; next: string | null }>({
    queryKey: ['article-queue', search, after],
    queryFn: () => api('/articles', { query: { ...(search && { search }), ...(after && { after }) } }),
  });
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <PageHeader
        title="Article review"
        description="Prepare, edit and approve stories for the public edition."
      />
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPages(['']);
          setSearch(term.trim());
        }}
      >
        <div className="flex-1">
          <label className="label" htmlFor="article-search">
            Find a headline
          </label>
          <Input id="article-search" maxLength={120} value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <Button variant="secondary">Search</Button>
      </form>
      {isPending && <p role="status">Loading stories…</p>}
      {isError && <Button onClick={() => refetch()}>Retry loading stories</Button>}
      {data && !data.items.length && <EmptyState title="No matching stories" />}
      {data && (
        <>
          <ul className="divide-y divide-border">
            {data.items.map((row) => (
              <li key={row.id}>
                <Link className="review-row" href={'/articles/' + row.id}>
                  <span>{row.title}</span>
                  <small>
                    {row.articleApprovedAt ? 'Published' : row.articleVersion ? 'Draft' : 'Awaiting draft'}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
          <nav aria-label="Review pages" className="flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={pages.length === 1}
              onClick={() => setPages((p) => p.slice(0, -1))}
            >
              Previous
            </Button>
            <span>Page {pages.length}</span>
            <Button
              variant="secondary"
              disabled={!data.next}
              onClick={() => setPages((p) => [...p, data.next!])}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}

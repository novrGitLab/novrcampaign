'use client';
import { use, useEffect, useState } from 'react';
import { StoryPhotos, type StoryPhoto } from '@/components/ui/StoryPhotos';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button, Input, PageHeader } from '@/components/ui';
import { EditionChoice } from '@/components/ui/EditionChoice';
import { useAuth } from '@/hooks/useAuth';

type Article = {
  headline: string;
  standfirst: string;
  sections: { heading: string; paragraphs: string[] }[];
};
type Review = {
  photos: StoryPhoto[];
  id: string;
  title: string;
  version: number;
  draft: Article | null;
  approvedAt: string | null;
  region: string | null;
  evidence: string | null;
  sourceUrl: string | null;
  source: string | null;
};
export default function StoryEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const path = '/articles/' + encodeURIComponent(id);
  const { data, isPending, isError, refetch } = useQuery<Review>({
    queryKey: ['review-record', id],
    queryFn: () => api(path),
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState<Article | null>(null);
  const [photos, setPhotos] = useState<StoryPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [region, setRegion] = useState('');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (data) {
      setDraft(data.draft);
      setPhotos(data.photos || []);
      setRegion(data.region ?? '');
      setVersion(data.version);
    }
  }, [data]);
  async function submit(action: 'generate' | 'save' | 'publish' | 'photos') {
    setBusy(true);
    setMessage('');
    try {
      const result = await api(path + (action === 'save' ? '' : '/' + action), {
        method: action === 'photos' || action === 'save' ? 'PUT' : 'POST',
        body: {
          version,
          ...(action !== 'generate' && {
            photos,
            ...(action !== 'photos' && { article: draft }),
            ...(region && { region }),
          }),
        },
      });
      setVersion(result.version);
      await refetch();
      setMessage(
        action === 'publish'
          ? 'Published to the public edition.'
          : action === 'generate'
            ? 'Draft ready for review.'
            : action === 'photos'
              ? 'Photographs saved.'
              : 'Draft saved.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  const canEdit = user?.role === 'ADMIN' || user?.role === 'SENDER';
  const sectionChange = (i: number, patch: Partial<Article['sections'][number]>) =>
    setDraft((a) => a && { ...a, sections: a.sections.map((s, j) => (i === j ? { ...s, ...patch } : s)) });
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <Link href="/articles" className="text-highlight underline">
        Article review
      </Link>
      {isPending && <p role="status">Loading story…</p>}
      {isError && <Button onClick={() => refetch()}>Retry loading story</Button>}
      {data && (
        <>
          <PageHeader title={data.title} />
          {data.sourceUrl && (
            <a className="text-highlight underline" href={data.sourceUrl} target="_blank" rel="noreferrer">
              Source reporting · {data.source}
            </a>
          )}
          {data.evidence && (
            <details className="article-evidence">
              <summary>Read source material</summary>
              <p>{data.evidence}</p>
            </details>
          )}
          <fieldset disabled={!canEdit || busy}>
            <StoryPhotos
              value={photos}
              onChange={setPhotos}
              title={draft?.headline || data.title}
              summary={draft?.standfirst}
              onBusy={setPhotoBusy}
            />
            {!draft && canEdit && (
              <Button
                variant="secondary"
                disabled={busy || photoBusy || photos.some((p) => !p.alt.trim())}
                onClick={() => submit('photos')}
              >
                Save photographs
              </Button>
            )}
          </fieldset>
          {!draft && (
            <div>
              {canEdit && (
                <Button
                  disabled={busy || photoBusy || JSON.stringify(photos) !== JSON.stringify(data.photos || [])}
                  onClick={() => submit('generate')}
                >
                  {busy ? 'Preparing draft…' : 'Prepare draft'}
                </Button>
              )}
            </div>
          )}
          {draft && (
            <fieldset disabled={!canEdit || busy} className="review-fields">
              <EditionChoice value={region} onChange={setRegion} />
              <label className="label">
                Headline
                <Input
                  value={draft.headline}
                  maxLength={220}
                  onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
                />
              </label>
              <label className="label">
                Standfirst
                <textarea
                  className="input"
                  value={draft.standfirst}
                  maxLength={650}
                  onChange={(e) => setDraft({ ...draft, standfirst: e.target.value })}
                />
              </label>
              {draft.sections.map((s, i) => (
                <div key={i} className="review-section">
                  <label className="label">
                    Section {i + 1} heading
                    <Input
                      value={s.heading}
                      maxLength={110}
                      onChange={(e) => sectionChange(i, { heading: e.target.value })}
                    />
                  </label>
                  <label className="label">
                    Paragraphs
                    <textarea
                      className="input"
                      rows={7}
                      value={s.paragraphs.join('\n\n')}
                      onChange={(e) => sectionChange(i, { paragraphs: e.target.value.split(/\n\s*\n/) })}
                    />
                  </label>
                  {draft.sections.length > 2 && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setDraft({ ...draft, sections: draft.sections.filter((_, j) => i !== j) })
                      }
                    >
                      Remove section {i + 1}
                    </Button>
                  )}
                </div>
              ))}
              {draft.sections.length < 6 && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setDraft({ ...draft, sections: [...draft.sections, { heading: '', paragraphs: [''] }] })
                  }
                >
                  Add section
                </Button>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={photoBusy || photos.some((p) => !p.alt.trim())}
                  onClick={() => submit('save')}
                >
                  Save draft
                </Button>
                {user?.role === 'ADMIN' && (
                  <Button
                    disabled={photoBusy || photos.some((p) => !p.alt.trim())}
                    onClick={() => submit('publish')}
                  >
                    Approve and publish
                  </Button>
                )}
              </div>
            </fieldset>
          )}
          {data.approvedAt && (
            <Link className="text-highlight underline" href={'/news/' + id}>
              View published article
            </Link>
          )}
        </>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}

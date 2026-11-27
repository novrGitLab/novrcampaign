import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { Button, Input, Label } from '../ui';

type ImageFields = { imageUrl: string | null; imageAlt: string | null; imageCredit: string | null };
type SectionItem = ImageFields & { id: string; publishItem: { bodyPreview: string } };
type Section = { id: string; functionId: number; label: string; state: string; items: SectionItem[] };
type Photo = { url: string; thumb: string; alt: string; credit: string; page: string };
function ItemPhoto({ item, path, onChange }: { item: SectionItem; path: string; onChange: () => void }) {
  const [url, setUrl] = useState(item.imageUrl || ''),
    [alt, setAlt] = useState(item.imageAlt || ''),
    [credit, setCredit] = useState(item.imageCredit || '');
  const [query, setQuery] = useState(''),
    [photos, setPhotos] = useState<Photo[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Image update failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="border-t py-3">
      <summary className="cursor-pointer text-sm font-medium">
        {item.publishItem.bodyPreview} · Photograph
      </summary>
      <div className="mt-3 grid gap-3">
        {url && (
          <img src={url} alt={alt || 'Selected photograph'} className="max-h-36 rounded-lg object-contain" />
        )}
        <Label>
          Upload a photograph
          <Input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void act(async () => {
                  const form = new FormData();
                  form.append('image', file);
                  const result = await api('/media/upload', { method: 'POST', formData: form });
                  setUrl(result.url);
                });
            }}
          />
        </Label>
        <div>
          <Label htmlFor={'search-' + item.id}>Search Pexels</Label>
          <div className="flex gap-2">
            <Input id={'search-' + item.id} value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || query.trim().length < 2}
              onClick={() =>
                act(async () => {
                  const data = await api('/media/photos', { query: { q: query } });
                  setPhotos(data.photos);
                  if (!data.photos.length) setMessage('No matching photographs.');
                })
              }
            >
              Search
            </Button>
          </div>
          <a className="text-xs underline" href="https://www.pexels.com/">
            Photos provided by Pexels
          </a>
        </div>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <div key={photo.url}>
                <button
                  type="button"
                  onClick={() => {
                    setUrl(photo.url);
                    setAlt(photo.alt);
                    setCredit(photo.credit);
                  }}
                >
                  <img src={photo.thumb} alt={photo.alt || photo.credit} />
                </button>
                <a className="text-xs" href={photo.page}>
                  {photo.credit}
                </a>
              </div>
            ))}
          </div>
        )}
        {url && (
          <>
            <Label>
              Image description
              <Input value={alt} maxLength={250} onChange={(e) => setAlt(e.target.value)} />
            </Label>
            <Label>
              Photo credit
              <Input value={credit} maxLength={160} onChange={(e) => setCredit(e.target.value)} />
            </Label>
          </>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || Boolean(url && !alt.trim())}
            onClick={() =>
              act(async () => {
                await api(path, {
                  method: 'PATCH',
                  body: {
                    imageUrl: url || null,
                    imageAlt: url ? alt : null,
                    imageCredit: url ? credit : null,
                  },
                });
                onChange();
                setMessage('Photograph saved. Review the section before sending.');
              })
            }
          >
            Save photograph
          </Button>
          {url && (
            <Button size="sm" variant="ghost" onClick={() => setUrl('')}>
              Remove
            </Button>
          )}
        </div>
        <p role="status">{message}</p>
      </div>
    </details>
  );
}
export default function EditionReview({
  briefingId,
  sections,
  onChange,
}: {
  briefingId: string;
  sections: Section[];
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const done = (s: Section) => (s.items.length ? s.state === 'ready' : s.state === 'no_updates');
  function refresh() {
    qc.invalidateQueries({ queryKey: ['briefing', briefingId] });
    onChange();
  }
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-semibold">
        Section review · {sections.filter(done).length} / {sections.length}
      </summary>
      <div className="mt-3 divide-y">
        {sections.map((s) => (
          <section className="py-3" key={s.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3>{s.label}</h3>
              <Button
                size="sm"
                variant={done(s) ? 'ghost' : 'secondary'}
                disabled={!!busy}
                onClick={async () => {
                  setBusy(s.id);
                  setError('');
                  try {
                    await api('/briefings/' + briefingId + '/sections/' + s.functionId, {
                      method: 'PATCH',
                      body: { state: done(s) ? 'awaiting' : s.items.length ? 'ready' : 'no_updates' },
                    });
                    refresh();
                  } catch {
                    setError('Could not update the section.');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                {done(s) ? 'Reviewed · reopen' : s.items.length ? 'Mark ready' : 'Confirm no updates'}
              </Button>
            </div>
            {s.items.map((item) => (
              <ItemPhoto
                key={item.id}
                item={item}
                path={
                  '/briefings/' + briefingId + '/sections/' + s.functionId + '/items/' + item.id + '/photo'
                }
                onChange={refresh}
              />
            ))}
          </section>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

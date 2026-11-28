import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { Button } from '../ui';

import { StoryPhotos, type StoryPhoto } from '@/components/ui/StoryPhotos';
type SectionItem = { id: string; photos: StoryPhoto[]; publishItem: { bodyPreview: string; body: string } };
type Section = { id: string; functionId: number; label: string; state: string; items: SectionItem[] };
function ItemPhoto({ item, path, onChange }: { item: SectionItem; path: string; onChange: () => void }) {
  const [photos, setPhotos] = useState<StoryPhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    setBusy(true);
    try {
      await api(path, { method: 'PATCH', body: { photos } });
      onChange();
      setMessage('Photographs saved. Review this section before sending.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save photographs.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="border-t py-3">
      <summary className="cursor-pointer text-sm font-medium">
        {item.publishItem.bodyPreview} · Photographs
      </summary>
      <fieldset disabled={busy}>
        <StoryPhotos
          value={photos ?? item.photos ?? []}
          onChange={setPhotos}
          onBusy={setUploading}
          title={item.publishItem.bodyPreview}
          summary={item.publishItem.body}
        />
        <Button
          size="sm"
          disabled={!photos || busy || uploading || photos.some((p) => !p.alt.trim())}
          onClick={save}
        >
          Save photographs
        </Button>
      </fieldset>
      <p role="status">{message}</p>
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

'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button, Input, Label } from './index';

export type StoryPhoto = { url: string; alt: string; credit?: string | null; page?: string };
type Result = StoryPhoto & { thumb: string };
type Props = {
  value?: StoryPhoto[] | null;
  onChange: (photos: StoryPhoto[]) => void;
  title?: string;
  summary?: string;
  eventId?: string;
  itemId?: string;
  onBusy?: (busy: boolean) => void;
};

export function StoryPhotos({ value, onChange, title = '', summary = '', eventId, itemId, onBusy }: Props) {
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [terms, setTerms] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const { data, isLoading, isError, refetch } = useQuery<{ photos: StoryPhoto[] }>({
    queryKey: ['story-photos', eventId, itemId],
    queryFn: () => api('/media/story', { query: itemId ? { itemId } : { eventId } }),
    enabled: !value && Boolean(eventId || itemId),
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
  const photos = value ?? data?.photos ?? [];
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  const waiting = !value && Boolean(eventId || itemId);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load photographs. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function edit(i: number, patch: Partial<StoryPhoto>) {
    onChange(photos.map((photo, index) => (index === i ? { ...photo, ...patch } : photo)));
  }
  function move(i: number, target: number) {
    const next = [...photos];
    next.splice(target, 0, ...next.splice(i, 1));
    onChange(next);
  }
  async function upload(files: File[]) {
    if (photos.length + files.length > 12) throw new Error('Choose up to 12 photographs per story.');
    if (
      files.some(
        (f) => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024,
      )
    )
      throw new Error('Choose JPEG, PNG or WebP files of 5 MB or less each.');
    const next = [...photos];
    for (const file of files) {
      const form = new FormData();
      form.append('image', file);
      const { url } = await api('/media/upload', { method: 'POST', formData: form });
      if (!next.some((photo) => new URL(photo.url, location.origin).pathname === url)) {
        next.push({ url, alt: '', credit: '' });
        onChange([...next]);
      }
    }
    setMessage('Upload complete. Describe each photograph before saving.');
  }
  async function search(term?: string) {
    const response = term
      ? await api('/media/photos', { query: { q: term } })
      : await api('/media/suggest', {
          method: 'POST',
          body: { title: title.slice(0, 300), summary: summary.slice(0, 1200) },
        });
    if (response.terms) setTerms(response.terms);
    setQuery(term || response.terms[0]);
    setResults(response.photos);
    setMessage(response.photos.length ? '' : 'No photographs found. Try another search.');
  }
  if (waiting && isLoading) return <p role="status">Loading photographs…</p>;
  if (waiting && isError)
    return (
      <Button type="button" variant="secondary" onClick={() => refetch()}>
        Retry loading photographs
      </Button>
    );
  return (
    <fieldset className="photo-desk" disabled={busy} aria-busy={busy}>
      <legend>Story photographs</legend>
      <div className="photo-desk-intro">
        <p>The first photograph leads the story.</p>
        <span>{photos.length} / 12</span>
      </div>
      {photos.length > 0 && (
        <ol className="photo-sequence">
          {photos.map((photo, i) => (
            <li key={photo.url}>
              <div className="photo-frame">
                <img src={photo.url} alt={photo.alt || 'Selected photograph'} />
                <span>{i === 0 ? 'Lead photo' : 'Photo ' + (i + 1)}</span>
              </div>
              <div className="photo-fields">
                <Label htmlFor={id + 'alt' + i}>Image description</Label>
                <Input
                  id={id + 'alt' + i}
                  value={photo.alt}
                  maxLength={250}
                  placeholder="Describe what is visible"
                  onChange={(e) => edit(i, { alt: e.target.value })}
                />
                <Label htmlFor={id + 'credit' + i}>Photo credit</Label>
                <Input
                  id={id + 'credit' + i}
                  value={photo.credit || ''}
                  maxLength={160}
                  onChange={(e) => edit(i, { credit: e.target.value })}
                />
                <div className="photo-actions">
                  {i > 0 && (
                    <Button type="button" size="sm" variant="secondary" onClick={() => move(i, i - 1)}>
                      Move earlier
                    </Button>
                  )}
                  {i < photos.length - 1 && (
                    <Button type="button" size="sm" variant="secondary" onClick={() => move(i, i + 1)}>
                      Move later
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={'Remove photo ' + (i + 1)}
                    onClick={() => onChange(photos.filter((_, n) => n !== i))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {photos.length < 12 && (
        <>
          <input
            hidden
            ref={picker}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files || []);
              e.currentTarget.value = '';
              if (files.length) void run(() => upload(files));
            }}
          />
          <button
            type="button"
            className="photo-drop"
            data-active={dragging}
            onClick={() => picker.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length) void run(() => upload(files));
            }}
          >
            <strong>Choose photos or drop them here</strong>
            <span>JPEG, PNG or WebP · 5 MB each</span>
          </button>
          <div className="photo-library">
            <div className="photo-library-heading">
              <h3>Photo library</h3>
              <a href="https://www.pexels.com/" target="_blank" rel="noreferrer">
                Photos by Pexels
              </a>
            </div>
            <div className="photo-actions">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!title.trim() && !summary.trim()}
                onClick={() => void run(() => search())}
              >
                Suggest photos for this story
              </Button>
            </div>
            <Label htmlFor={id + 'search'}>Search Pexels</Label>
            <div className="photo-search">
              <Input
                id={id + 'search'}
                value={query}
                maxLength={80}
                placeholder="Subject or location"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (query.trim().length >= 2) void run(() => search(query.trim()));
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={query.trim().length < 2}
                onClick={() => void run(() => search(query.trim()))}
              >
                Search
              </Button>
            </div>
            {terms.length > 1 && (
              <div className="photo-actions">
                {terms.map((term) => (
                  <Button
                    key={term}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void run(() => search(term))}
                  >
                    {term}
                  </Button>
                ))}
              </div>
            )}
            {!!results.length && (
              <ul className="photo-results">
                {results.map((photo) => {
                  const selected = photos.some((p) => p.url === photo.url);
                  return (
                    <li key={photo.url}>
                      <button
                        type="button"
                        disabled={selected}
                        onClick={() =>
                          onChange([
                            ...photos,
                            {
                              url: photo.url,
                              alt: (photo.alt || '').slice(0, 250),
                              credit: photo.credit,
                              page: photo.page,
                            },
                          ])
                        }
                      >
                        <img src={photo.thumb} alt={photo.alt || 'Stock photograph'} />
                        <span>{selected ? 'Added' : 'Add photo'}</span>
                      </button>
                      <a href={photo.page} target="_blank" rel="noreferrer">
                        {photo.credit}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
      {(busy || message) && (
        <p role="status" className="photo-status">
          {busy ? 'Loading photographs…' : message}
        </p>
      )}
    </fieldset>
  );
}

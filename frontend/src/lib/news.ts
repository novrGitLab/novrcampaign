import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

export interface Story {
  id: string;
  title: string;
  summary: string;
  context: string | null;
  format: "article" | "brief";
  sections: {heading:string; paragraphs:string[]}[];
  updatedAt: string | null;
  publishedAt: string;
  href: string;
  image: { url: string; alt: string; credit: string | null } | null;
  source: string;
  sourceUrl: string;
  region: string | null;
  desk: string;
  presentation: { tone: 'primary' | 'secondary' | 'neutral'; emphasis: 'italic' | 'roman' };
}
export type Edition = { items: Story[]; next: string | null };
export const site = (process.env.PUBLIC_SITE_URL || 'https://pulse.cybernovr.com').replace(/\/$/, '');
const origin = process.env.INTERNAL_API_ORIGIN || 'http://127.0.0.1:4000';
export const description = 'Cybersecurity news from Nigeria, Africa and around the world.';
async function news<T>(path: string): Promise<T> {
  const client = (await headers()).get('x-forwarded-for')?.split(',').at(-1)?.trim();
  const response = await fetch(origin + '/api/public/news' + path, {
    cache: 'no-store',
    headers: client ? { 'x-forwarded-for': client } : {},
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 404 || response.status === 400) notFound();
  if (!response.ok) throw new Error('News service unavailable');
  return response.json();
}
export const getStory = cache((id: string) =>
  news<{ story: Story; related: Story[] }>('/' + encodeURIComponent(id)),
);
export const getEdition = cache((desk: string, after: string) =>
  news<Edition>('?' + new URLSearchParams({ ...(desk && { desk }), ...(after && { after }) })),
);
export function newsDate(value: string | Date, long = false) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: 'numeric',
    ...(long ? { weekday: 'long' } : {}),
  }).format(new Date(value));
}
export function editionMeta(title: string, path: string, summary = description) {
  return {
    title,
    description: summary,
    alternates: { canonical: site + path },
    openGraph: {
      title,
      description: summary,
      url: site + path,
      siteName: 'NovrPulse',
      images: [site + '/press/network.jpg'],
    },
    twitter: { card: 'summary_large_image' as const, title, description: summary },
  };
}

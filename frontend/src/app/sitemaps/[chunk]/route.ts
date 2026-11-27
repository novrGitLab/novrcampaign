import { sitemapResponse } from '@/lib/sitemap';
export async function GET(_request: Request, { params }: { params: Promise<{ chunk: string }> }) {
  const { chunk } = await params;
  if (!/^\d{1,8}\.xml$/.test(chunk)) return new Response(null, { status: 404 });
  return sitemapResponse('/' + chunk.slice(0, -4));
}

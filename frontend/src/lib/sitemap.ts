export async function sitemapResponse(suffix: string) {
  const origin = process.env.INTERNAL_API_ORIGIN || 'http://127.0.0.1:4000';
  const response = await fetch(origin + '/api/public/sitemap' + suffix, {
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(15000),
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': response.ok ? 'public, max-age=300' : 'no-store',
    },
  });
}

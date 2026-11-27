import { site } from '@/lib/news';
export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin',
        '/login',
        '/pulse',
        '/contacts',
        '/campaigns',
        '/analytics',
        '/segments',
        '/suppressions',
        '/templates',
        '/feed',
        '/subscribe/confirm',
      ],
    },
    sitemap: site + '/sitemap.xml',
  };
}

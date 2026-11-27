import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === 'development';
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'" + (dev ? " 'unsafe-eval'" : ''),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'" + (dev ? ' ws: wss:' : ''),
    "frame-src 'self' blob: about:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', policy);
  headers.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}
export const config = { matcher: ['/((?!api/|_next/|press/|.*\\.(?:png|jpg|ico|xml|txt)$).*)'] };

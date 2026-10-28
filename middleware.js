// Vercel Routing Middleware: every page and static file needs a valid
// tom_session cookie (set by /api/auth). API routes check auth themselves
// (session cookie, bot key, or CRON_SECRET), the same way Rankify Hub does.
export const config = {
  matcher: ['/((?!api/|login|privacy|favicon\\.ico|icon|wallpaper\\.jpg|manifest\\.json).*)'],
};

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function validSession(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    if (header.alg !== 'HS256') return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)tom_session=([^;]+)/);
  if (await validSession(m && m[1], process.env.TOM_JWT_SECRET)) return;
  const url = new URL(request.url);
  const next = url.pathname + url.search;
  const login = new URL('/login', url.origin);
  if (next && next !== '/') login.searchParams.set('next', next);
  return new Response(null, { status: 302, headers: { Location: login.toString(), 'Cache-Control': 'no-store' } });
}

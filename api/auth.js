// Server-side login, modelled on Rankify Hub's api/auth.js.
// PIN is checked against a bcrypt hash (TOM_PIN_HASH); success sets an
// HttpOnly, Secure, SameSite=Strict JWT cookie (tom_session).
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { kvGet, kvSetEx, kvDel } = require('./db');

const JWT_SECRET = process.env.TOM_JWT_SECRET || '';
const SESSION_HOURS = parseInt(process.env.TOM_SESSION_HOURS || '24', 10);
const MAX_ATTEMPTS = 5;            // per IP, same as Rankify Hub
const LOCKOUT_SECONDS = 900;       // 15 minutes, same as Rankify Hub
const GLOBAL_MAX_ATTEMPTS = 20;    // extra: all IPs combined, per 15 minutes
const COOKIE = 'tom_session';

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k] = v.join('=');
  });
  return cookies;
}

function verifySession(req) {
  if (!JWT_SECRET) return null;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

async function lockedOut(key, max) {
  const attempts = await kvGet(key) || { count: 0, first: Date.now() };
  if (attempts.count >= max) {
    const elapsed = Math.floor((Date.now() - attempts.first) / 1000);
    const remaining = LOCKOUT_SECONDS - elapsed;
    if (remaining > 0) return { locked: true, remaining, attempts };
    await kvDel(key);
    return { locked: false, attempts: { count: 0, first: Date.now() } };
  }
  return { locked: false, attempts };
}

async function bump(key, attempts) {
  attempts.count += 1;
  if (attempts.count === 1) attempts.first = Date.now();
  await kvSetEx(key, LOCKOUT_SECONDS, attempts);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const session = verifySession(req);
    return res.status(200).json({ authenticated: !!session });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'login') {
      const pin = String((req.body || {}).pin || '');
      const hash = process.env.TOM_PIN_HASH;
      if (!hash || !JWT_SECRET) return res.status(500).json({ error: 'Login not configured' });

      const ip = getClientIP(req);
      const rateKey = `tom_ratelimit:${ip}`;
      const globalKey = 'tom_ratelimit:global';
      const perIp = await lockedOut(rateKey, MAX_ATTEMPTS);
      const global = await lockedOut(globalKey, GLOBAL_MAX_ATTEMPTS);
      const block = perIp.locked ? perIp : (global.locked ? global : null);
      if (block) {
        return res.status(429).json({
          error: 'Too many attempts',
          retryAfter: block.remaining,
          message: `Locked out. Try again in ${Math.ceil(block.remaining / 60)} minutes.`
        });
      }

      const valid = pin.length > 0 && await bcrypt.compare(pin, hash);

      if (!valid) {
        await bump(rateKey, perIp.attempts);
        await bump(globalKey, global.attempts);
        const left = MAX_ATTEMPTS - perIp.attempts.count;
        return res.status(401).json({
          error: 'Invalid PIN',
          attemptsRemaining: Math.max(0, left),
          message: left > 0 ? `${left} attempt${left !== 1 ? 's' : ''} remaining` : `Locked out for ${LOCKOUT_SECONDS / 60} minutes`
        });
      }

      await kvDel(rateKey);

      const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: `${SESSION_HOURS}h` });
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
      return res.status(200).json({ success: true });
    }

    if (action === 'logout') {
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

module.exports.verifySession = verifySession;

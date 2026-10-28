// Same model as Rankify Hub (rankify-crm lib/http-auth.js):
// - dashboard: tom_session cookie (JWT, set by /api/auth after a server-checked PIN)
// - bots: Authorization: Bearer ROUTINE_SECRET
// - Vercel cron: Authorization: Bearer CRON_SECRET (Vercel sends it automatically)
const { verifySession } = require('../api/auth');
const { safeEqual } = require('./safe-equal');

function bearer(req) {
  return String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
}

function authorised(req) {
  const secret = process.env.ROUTINE_SECRET;
  const token = bearer(req);
  if (secret && token && safeEqual(token, secret)) return true;
  try {
    return !!verifySession(req);
  } catch {
    return false;
  }
}

function cronAuthorised(req) {
  const secret = process.env.CRON_SECRET;
  const token = bearer(req);
  if (!secret || !token) return false;
  return safeEqual(token, secret);
}

module.exports = { authorised, cronAuthorised, bearer };

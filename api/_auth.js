const { authorised, cronAuthorised } = require('../lib/http-auth');

function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

// Dashboard session cookie OR bot bearer key (ROUTINE_SECRET).
function requireAuth(req, res) {
  if (authorised(req)) return true;
  res.status(401).json({ error: 'Not authenticated' });
  return false;
}

// Vercel cron (Bearer CRON_SECRET), or a signed-in session / bot key.
function requireCronOrAuth(req, res) {
  if (cronAuthorised(req) || authorised(req)) return true;
  res.status(401).json({ error: 'Not authenticated' });
  return false;
}

module.exports = { handleCors, requireAuth, requireCronOrAuth };

function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

function requireAuth(req, res) {
  const secret = process.env.ROUTINE_SECRET;
  if (!secret) { res.status(503).json({ error: 'ROUTINE_SECRET not configured' }); return false; }
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (auth !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

module.exports = { handleCors, requireAuth };

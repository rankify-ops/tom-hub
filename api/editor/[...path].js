// Hub-side GET-only proxy to CRM editor API.
// Holds ADMIN_API_KEY server-side so bots/editor never need the admin key.
// Only GET requests are proxied; everything else is rejected.

const { handleCors, requireAuth } = require('../_auth');

const CRM_BASE = 'https://rankify-crm.vercel.app';

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Editor proxy is read-only (GET only)' });
  }

  if (!requireAuth(req, res)) return;

  const adminKey = process.env.CRM_ADMIN_API_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: 'CRM_ADMIN_API_KEY not configured on Hub' });
  }

  const pathSegments = req.query.path || [];
  const downstream = '/api/' + pathSegments.join('/');
  const url = new URL(downstream, CRM_BASE);
  const qs = new URL(req.url, 'http://localhost').searchParams;
  for (const [k, v] of qs) {
    if (k !== 'path') url.searchParams.set(k, v);
  }

  try {
    const upstream = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + adminKey,
        'Accept': 'application/json',
      },
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.end(body);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream error: ' + err.message });
  }
};

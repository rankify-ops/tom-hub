// /api/editor/inbox — Recognise editor-client senders for inbox routing.
// Given a sender email, checks if they match a CRM client with editorOrgSlug.
// PARKED: which email address clients use for editor comms (Thomas's call).

const { handleCors, requireAuth } = require('../_auth');
const { kvGet, kvSet } = require('../db');

const CACHE_KEY = 'tom_editor_client_emails';
const CACHE_TTL_MS = 3600000; // 1 hour

async function refreshClientCache() {
  const crmKey = process.env.HUB_SHARED_KEY || process.env.CRM_ADMIN_API_KEY;
  if (!crmKey) return null;

  try {
    const resp = await fetch('https://rankify-crm.vercel.app/api/editor-sync', {
      headers: { 'Authorization': 'Bearer ' + crmKey },
    });
    if (!resp.ok) return null;
    const { clients } = await resp.json();
    const cache = {
      clients: (clients || []).map(c => ({
        id: c.id,
        company: c.company,
        editorOrgSlug: c.editorOrgSlug,
      })),
      refreshedAt: new Date().toISOString(),
    };
    await kvSet(CACHE_KEY, cache);
    return cache;
  } catch (_) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const sender = (url.searchParams.get('sender') || '').toLowerCase().trim();
      if (!sender) return res.status(400).json({ error: 'sender query param required' });

      // Try cache first
      let cache = await kvGet(CACHE_KEY);
      if (!cache || !cache.refreshedAt || (Date.now() - new Date(cache.refreshedAt).getTime() > CACHE_TTL_MS)) {
        cache = await refreshClientCache() || cache;
      }
      if (!cache || !cache.clients) {
        return res.status(503).json({ error: 'Client cache not available' });
      }

      // Match: check sender domain against editorOrgSlug patterns
      // For now, simple email-contains-slug matching or exact email matching
      const matches = cache.clients.filter(c => {
        if (!c.editorOrgSlug) return false;
        const slug = c.editorOrgSlug.toLowerCase();
        return sender.includes(slug) || sender.endsWith('@' + slug + '.com') || sender.endsWith('@' + slug + '.com.au');
      });

      return res.status(200).json({
        sender,
        matched: matches.length > 0,
        clients: matches,
        cacheAge: cache.refreshedAt,
      });
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'refresh_cache') {
        const cache = await refreshClientCache();
        if (!cache) return res.status(503).json({ error: 'Could not refresh from CRM' });
        return res.status(200).json({ success: true, clients: cache.clients.length, refreshedAt: cache.refreshedAt });
      }

      return res.status(400).json({ error: 'Unknown action. Supported: refresh_cache' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('editor inbox error:', err);
    return res.status(500).json({ error: err.message });
  }
};

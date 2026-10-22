// /api/editor/contacts — Drafts queue for editor contacts.
// Syncs people from the editor app into a drafts KV store.
// Thomas presses "Send" in the Hub UI, which calls POST /api/admin/people server-side.
// Nothing is sent to the editor until Thomas approves.

const { handleCors, requireAuth } = require('../_auth');
const { kvGet, kvSet } = require('../db');

const DRAFTS_KEY = 'tom_editor_contact_drafts';

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const data = await kvGet(DRAFTS_KEY) || { drafts: [] };
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'add_draft') {
        const { contact } = req.body;
        if (!contact || !contact.email) return res.status(400).json({ error: 'contact.email required' });

        const data = await kvGet(DRAFTS_KEY) || { drafts: [] };
        const existing = data.drafts.find(d => d.email === contact.email);
        if (existing) {
          Object.assign(existing, contact, { modified: new Date().toISOString() });
        } else {
          data.drafts.unshift({
            id: 'cd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            ...contact,
            status: 'draft',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          });
        }
        data.updated = new Date().toISOString();
        await kvSet(DRAFTS_KEY, data);
        return res.status(200).json({ success: true, drafts: data.drafts.length });
      }

      if (action === 'bulk_add') {
        const { contacts } = req.body;
        if (!Array.isArray(contacts)) return res.status(400).json({ error: 'contacts array required' });

        const data = await kvGet(DRAFTS_KEY) || { drafts: [] };
        const now = new Date().toISOString();
        let added = 0;
        for (const c of contacts) {
          if (!c.email) continue;
          const existing = data.drafts.find(d => d.email === c.email);
          if (existing) {
            Object.assign(existing, c, { modified: now });
          } else {
            data.drafts.unshift({
              id: 'cd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              ...c,
              status: 'draft',
              created: now,
              modified: now,
            });
            added++;
          }
        }
        data.updated = now;
        await kvSet(DRAFTS_KEY, data);
        return res.status(200).json({ success: true, added, total: data.drafts.length });
      }

      // Thomas presses Send: this calls POST /api/admin/people on the editor
      if (action === 'send') {
        const { draftId } = req.body;
        if (!draftId) return res.status(400).json({ error: 'draftId required' });

        const data = await kvGet(DRAFTS_KEY) || { drafts: [] };
        const draft = data.drafts.find(d => d.id === draftId);
        if (!draft) return res.status(404).json({ error: 'Draft not found' });

        const adminKey = process.env.EDITOR_ADMIN_API_KEY;
        const editorBase = process.env.EDITOR_BASE_URL;
        if (!adminKey || !editorBase) {
          return res.status(503).json({ error: 'EDITOR_ADMIN_API_KEY or EDITOR_BASE_URL not configured' });
        }

        const resp = await fetch(editorBase + '/api/admin/people', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + adminKey,
          },
          body: JSON.stringify({
            email: draft.email,
            name: draft.name || '',
            orgSlug: draft.orgSlug || '',
            metadata: draft.metadata || {},
          }),
        });

        if (!resp.ok) {
          const err = await resp.text().catch(() => 'unknown');
          return res.status(resp.status).json({ error: 'Editor API error: ' + err });
        }

        draft.status = 'sent';
        draft.sentAt = new Date().toISOString();
        data.updated = new Date().toISOString();
        await kvSet(DRAFTS_KEY, data);

        return res.status(200).json({ success: true, draft });
      }

      if (action === 'delete_draft') {
        const { draftId } = req.body;
        if (!draftId) return res.status(400).json({ error: 'draftId required' });
        const data = await kvGet(DRAFTS_KEY) || { drafts: [] };
        data.drafts = data.drafts.filter(d => d.id !== draftId);
        data.updated = new Date().toISOString();
        await kvSet(DRAFTS_KEY, data);
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action. Supported: add_draft, bulk_add, send, delete_draft' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('editor contacts error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// /api/editor/tickets — Read-only mirror of editor support tickets.
// Tickets are synced from the editor app; replies are drafted here,
// Thomas approves, then they're sent back via the editor admin API.
// Ticket text is untrusted — never eval or render as HTML.

const { handleCors, requireAuth } = require('../_auth');
const { kvGet, kvSet } = require('../db');

const TICKETS_KEY = 'tom_editor_tickets';

function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '');
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const data = await kvGet(TICKETS_KEY) || { tickets: [] };
      const url = new URL(req.url, 'http://localhost');
      const status = url.searchParams.get('status');
      let tickets = data.tickets;
      if (status) tickets = tickets.filter(t => t.status === status);
      return res.status(200).json({ tickets, total: data.tickets.length });
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      // Ingest tickets from the editor app
      if (action === 'sync_tickets') {
        const { tickets } = req.body;
        if (!Array.isArray(tickets)) return res.status(400).json({ error: 'tickets array required' });

        const data = await kvGet(TICKETS_KEY) || { tickets: [] };
        const now = new Date().toISOString();
        let added = 0, updated = 0;
        for (const t of tickets) {
          if (!t.id) continue;
          const existing = data.tickets.find(e => e.editorTicketId === t.id);
          if (existing) {
            existing.subject = sanitizeText(t.subject || '');
            existing.body = sanitizeText(t.body || '');
            existing.status = t.status || existing.status;
            existing.orgSlug = t.orgSlug || existing.orgSlug;
            existing.userEmail = sanitizeText(t.userEmail || '');
            existing.updatedAt = t.updatedAt || now;
            existing.messages = (t.messages || []).map(m => ({
              ...m,
              body: sanitizeText(m.body || ''),
              sender: sanitizeText(m.sender || ''),
            }));
            updated++;
          } else {
            data.tickets.unshift({
              id: 'tk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              editorTicketId: t.id,
              subject: sanitizeText(t.subject || ''),
              body: sanitizeText(t.body || ''),
              status: t.status || 'open',
              orgSlug: t.orgSlug || '',
              userEmail: sanitizeText(t.userEmail || ''),
              createdAt: t.createdAt || now,
              updatedAt: t.updatedAt || now,
              messages: (t.messages || []).map(m => ({
                ...m,
                body: sanitizeText(m.body || ''),
                sender: sanitizeText(m.sender || ''),
              })),
              draftReply: null,
            });
            added++;
          }
        }
        data.updated = now;
        await kvSet(TICKETS_KEY, data);
        return res.status(200).json({ success: true, added, updated, total: data.tickets.length });
      }

      // Draft a reply (doesn't send — Thomas presses Send)
      if (action === 'draft_reply') {
        const { ticketId, body } = req.body;
        if (!ticketId || !body) return res.status(400).json({ error: 'ticketId and body required' });

        const data = await kvGet(TICKETS_KEY) || { tickets: [] };
        const ticket = data.tickets.find(t => t.id === ticketId);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        ticket.draftReply = { body: sanitizeText(body), draftedAt: new Date().toISOString() };
        data.updated = new Date().toISOString();
        await kvSet(TICKETS_KEY, data);
        return res.status(200).json({ success: true });
      }

      // Send the drafted reply
      if (action === 'send_reply') {
        const { ticketId } = req.body;
        if (!ticketId) return res.status(400).json({ error: 'ticketId required' });

        const data = await kvGet(TICKETS_KEY) || { tickets: [] };
        const ticket = data.tickets.find(t => t.id === ticketId);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
        if (!ticket.draftReply) return res.status(400).json({ error: 'No draft reply to send' });

        const adminKey = process.env.EDITOR_ADMIN_API_KEY;
        const editorBase = process.env.EDITOR_BASE_URL;
        if (!adminKey || !editorBase) {
          return res.status(503).json({ error: 'EDITOR_ADMIN_API_KEY or EDITOR_BASE_URL not configured' });
        }

        const resp = await fetch(editorBase + '/api/admin/tickets/' + ticket.editorTicketId + '/reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + adminKey,
          },
          body: JSON.stringify({ body: ticket.draftReply.body }),
        });

        if (!resp.ok) {
          const err = await resp.text().catch(() => 'unknown');
          return res.status(resp.status).json({ error: 'Editor API error: ' + err });
        }

        ticket.messages = ticket.messages || [];
        ticket.messages.push({
          sender: 'Thomas (Rankify)',
          body: ticket.draftReply.body,
          sentAt: new Date().toISOString(),
        });
        ticket.draftReply = null;
        data.updated = new Date().toISOString();
        await kvSet(TICKETS_KEY, data);

        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action. Supported: sync_tickets, draft_reply, send_reply' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('editor tickets error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// Daily self-log. Thomas writes it from /daily-log (signed-in session only).
// Bots (ROUTINE_SECRET) can READ it here or via /api/routine space 'daily_log',
// but can never write. No reminders or notifications are ever sent from here.
const { kvGet, kvSet } = require('./db');
const { authorised } = require('../lib/http-auth');
const { verifySession } = require('./auth');
const { KV_KEY, HEALING, brisbaneDate, normaliseEntry, upsert, removeDate, summarise } = require('../lib/daily-log');

function hasSession(req) {
  try { return !!verifySession(req); } catch { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorised(req)) return res.status(401).json({ error: 'Not authenticated' });
  try {
    if (req.method === 'GET') {
      const data = await kvGet(KV_KEY) || { entries: [] };
      const today = brisbaneDate();
      return res.status(200).json({
        today,
        healingOptions: HEALING,
        entries: data.entries || [],
        updated: data.updated || null,
        summary: { d14: summarise(data.entries, 14, today), d30: summarise(data.entries, 30, today) },
      });
    }

    if (req.method === 'POST') {
      if (!hasSession(req)) return res.status(403).json({ error: 'Daily log is read-only for bots' });
      const body = req.body || {};
      const data = await kvGet(KV_KEY) || { entries: [] };
      if (body.action === 'save') {
        const { entry, error } = normaliseEntry(body.entry);
        if (error) return res.status(400).json({ error });
        const next = upsert(data, entry);
        await kvSet(KV_KEY, next);
        return res.status(200).json({ success: true, entry: next.entries.find(e => e.date === entry.date) });
      }
      if (body.action === 'delete') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ''))) return res.status(400).json({ error: 'date required' });
        await kvSet(KV_KEY, removeDate(data, body.date));
        return res.status(200).json({ success: true });
      }
      return res.status(400).json({ error: 'Unknown action. Available: save, delete' });
    }

    return res.status(405).json({ error: 'GET or POST' });
  } catch (err) {
    console.error('daily-log error:', err);
    return res.status(500).json({ error: 'Daily log error' });
  }
};

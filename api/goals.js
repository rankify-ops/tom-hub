const { kvGet, kvSet } = require('./db');

const KV_KEY = 'tom_goals';

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const data = await kvGet(KV_KEY) || { goals: [] };
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'save') {
        const { goals } = req.body;
        const existing = await kvGet(KV_KEY) || {};
        await kvSet(KV_KEY, { ...existing, goals, updated: new Date().toISOString() });
        return res.status(200).json({ success: true });
      }

      if (action === 'save_2026') {
        const { statuses } = req.body;
        const existing = await kvGet(KV_KEY) || {};
        await kvSet(KV_KEY, { ...existing, statuses_2026: statuses, updated: new Date().toISOString() });
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'GET or POST' });
  } catch (err) {
    console.error('goals error:', err);
    return res.status(500).json({ error: err.message });
  }
};

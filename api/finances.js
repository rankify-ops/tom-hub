const { kvGet, kvSet } = require('./db');

const KV_KEY = 'tom_finances';
const KV_COSTS = 'tom_cost_tracking';

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [data, costs] = await Promise.all([
        kvGet(KV_KEY),
        kvGet(KV_COSTS),
      ]);
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json({
        entries: data?.entries || [],
        updated: data?.updated || null,
        costTracking: costs?.items || null,
        weeklyIncome: costs?.weeklyIncome ?? null,
        costsVersion: costs?.version || 0,
        costsUpdated: costs?.updated || null,
      });
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'save') {
        const { entries } = req.body;
        await kvSet(KV_KEY, { entries, updated: new Date().toISOString() });
        return res.status(200).json({ success: true });
      }

      if (action === 'save_costs') {
        const { items, weeklyIncome, version } = req.body;
        await kvSet(KV_COSTS, { items, weeklyIncome, version: version || 1, updated: new Date().toISOString() });
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'GET or POST' });
  } catch (err) {
    console.error('finances error:', err);
    return res.status(500).json({ error: err.message });
  }
};

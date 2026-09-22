const { kvGet, kvSet } = require('./db');

const KV_KEY = 'tom_calories';

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const data = await kvGet(KV_KEY) || { savedFoods: [], logs: {}, settings: { height: 186, weight: 88, age: 31, activityMultiplier: 1.55, deficitGoal: 500, proteinGoal: 180 } };
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'save') {
        const { savedFoods, logs, settings } = req.body;
        await kvSet(KV_KEY, { savedFoods, logs, settings, updated: new Date().toISOString() });
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'GET or POST' });
  } catch (err) {
    console.error('calories error:', err);
    return res.status(500).json({ error: err.message });
  }
};

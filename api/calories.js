async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['GET', key]),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV not configured');
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', key, value]),
  });
}

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
        await kvSet(KV_KEY, JSON.stringify({ savedFoods, logs, settings, updated: new Date().toISOString() }));
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

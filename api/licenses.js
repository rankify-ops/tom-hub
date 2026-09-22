const { kvGet, kvSet } = require('./db');

const KV_KEY = 'tom_licenses';

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const data = await kvGet(KV_KEY) || { licenses: [] };
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'save') {
        const { licenses } = req.body;
        await kvSet(KV_KEY, { licenses, updated: new Date().toISOString() });
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'GET or POST' });
  } catch (err) {
    console.error('licenses error:', err);
    return res.status(500).json({ error: err.message });
  }
};

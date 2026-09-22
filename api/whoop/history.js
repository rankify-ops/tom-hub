const { kvGet } = require('../db');

module.exports = async function handler(req, res) {
  try {
    const [history, meta] = await Promise.all([
      kvGet('tom_whoop_history'),
      kvGet('tom_whoop_sync_meta'),
    ]);

    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({
      history: history || {},
      meta: meta || null,
    });
  } catch (err) {
    console.error('Whoop history error:', err);
    return res.status(500).json({ error: err.message });
  }
};

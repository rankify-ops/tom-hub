async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['GET', key]),
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

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

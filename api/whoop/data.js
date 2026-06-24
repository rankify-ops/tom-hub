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

async function refreshTokens(tokens) {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;

  const res = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) return null;
  const data = await res.json();

  const updated = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000),
    updated: new Date().toISOString(),
  };
  await kvSet('tom_whoop_tokens', JSON.stringify(updated));
  return updated;
}

async function whoopGet(path, accessToken) {
  const res = await fetch('https://api.prod.whoop.com/developer' + path, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('Whoop API error', res.status, path, errBody);
    return null;
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  try {
    let tokens = await kvGet('tom_whoop_tokens');
    if (!tokens) {
      return res.status(200).json({ connected: false });
    }

    // Refresh if expired or about to expire (5 min buffer)
    if (Date.now() > tokens.expires_at - 300000) {
      tokens = await refreshTokens(tokens);
      if (!tokens) {
        return res.status(200).json({ connected: false, error: 'refresh_failed' });
      }
    }

    const at = tokens.access_token;

    // Fetch all data in parallel
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();

    const [profile, recoveryRes, cycleRes, sleepRes, workoutRes, bodyRes] = await Promise.all([
      whoopGet('/v1/user/profile/basic', at),
      whoopGet('/v1/recovery?start=' + encodeURIComponent(thirtyDaysAgo) + '&end=' + encodeURIComponent(now.toISOString()) + '&limit=30', at),
      whoopGet('/v1/cycle?start=' + encodeURIComponent(thirtyDaysAgo) + '&end=' + encodeURIComponent(now.toISOString()) + '&limit=30', at),
      whoopGet('/v1/activity/sleep?start=' + encodeURIComponent(thirtyDaysAgo) + '&end=' + encodeURIComponent(now.toISOString()) + '&limit=30', at),
      whoopGet('/v1/activity/workout?start=' + encodeURIComponent(sevenDaysAgo) + '&end=' + encodeURIComponent(now.toISOString()) + '&limit=25', at),
      whoopGet('/v1/user/measurement/body', at),
    ]);

    // Debug mode: ?debug=1 returns raw API responses
    if (req.query.debug === '1') {
      return res.status(200).json({ profile, recoveryRes, cycleRes, sleepRes, workoutRes, bodyRes });
    }

    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({
      connected: true,
      updated: new Date().toISOString(),
      profile,
      recovery: recoveryRes?.records || [],
      cycles: cycleRes?.records || [],
      sleep: sleepRes?.records || [],
      workouts: workoutRes?.records || [],
      body: bodyRes,
    });
  } catch (err) {
    console.error('Whoop data error:', err);
    return res.status(500).json({ error: err.message });
  }
};

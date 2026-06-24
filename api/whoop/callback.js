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

module.exports = async function handler(req, res) {
  try {
    const { code, error } = req.query;

    if (error) {
      return res.redirect('/?whoop=error&msg=' + encodeURIComponent(error));
    }

    if (!code) {
      return res.redirect('/?whoop=error&msg=no_code');
    }

    const clientId = process.env.WHOOP_CLIENT_ID;
    const clientSecret = process.env.WHOOP_CLIENT_SECRET;
    const redirectUri = 'https://tom-hub.vercel.app/api/whoop/callback';

    const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Whoop token error:', errText);
      return res.redirect('/?whoop=error&msg=token_failed');
    }

    const tokens = await tokenRes.json();

    await kvSet('tom_whoop_tokens', JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000),
      updated: new Date().toISOString(),
    }));

    res.redirect('/?whoop=connected');
  } catch (err) {
    console.error('Whoop callback error:', err);
    res.redirect('/?whoop=error&msg=' + encodeURIComponent(err.message));
  }
};

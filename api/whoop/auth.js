const crypto = require('crypto');
const { requireAuth } = require('../_auth');
const { kvSetEx } = require('../db');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAuth(req, res)) return;
  const clientId = process.env.WHOOP_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'WHOOP_CLIENT_ID not configured' });

  // One-time OAuth state, checked by /api/whoop/callback (the Whoop redirect is
  // cross-site, so the SameSite=Strict session cookie is not sent there).
  const state = crypto.randomBytes(24).toString('hex');
  await kvSetEx('tom_whoop_oauth_state:' + state, 600, { created: Date.now() });

  const redirectUri = 'https://tom-hub.vercel.app/api/whoop/callback';
  const scopes = 'offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';

  const authUrl = 'https://api.prod.whoop.com/oauth/oauth2/auth'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&scope=' + encodeURIComponent(scopes)
    + '&state=' + encodeURIComponent(state);

  res.writeHead(302, { Location: authUrl });
  res.end();
};

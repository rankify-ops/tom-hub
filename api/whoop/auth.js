module.exports = async function handler(req, res) {
  const clientId = process.env.WHOOP_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'WHOOP_CLIENT_ID not configured' });

  const redirectUri = 'https://tom-hub.vercel.app/api/whoop/callback';
  const scopes = 'read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';

  const authUrl = 'https://api.prod.whoop.com/oauth/oauth2/auth'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&scope=' + encodeURIComponent(scopes)
    + '&state=tomhub';

  res.writeHead(302, { Location: authUrl });
  res.end();
};

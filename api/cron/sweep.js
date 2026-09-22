const { kvGet, fireWebhook } = require('../db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}` && !req.headers['x-vercel-cron']) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const webhookUrl = process.env.GROKBOT_WEBHOOK_URL;
  const webhookKey = process.env.GROKBOT_WEBHOOK_KEY;
  if (!webhookUrl || !webhookKey) {
    return res.status(200).json({ skipped: true, reason: 'webhook not configured' });
  }

  const today = new Date().toISOString().split('T')[0];
  const todayMs = Date.now();
  const alerts = [];

  const licenses = await kvGet('tom_licenses');
  if (licenses && Array.isArray(licenses.licenses)) {
    for (const lic of licenses.licenses) {
      if (!lic.expiryDate) continue;
      const expiryMs = new Date(lic.expiryDate + 'T00:00:00Z').getTime();
      const daysUntil = Math.floor((expiryMs - todayMs) / 86400000);
      const thresholds = Array.isArray(lic.alertDays) ? lic.alertDays : [30, 14, 7];

      if (daysUntil <= 0) {
        alerts.push({
          event: 'license_expired',
          data: { licenseId: lic.id, name: lic.name, expiryDate: lic.expiryDate, daysExpired: Math.abs(daysUntil) },
        });
      } else if (thresholds.some(d => daysUntil <= d)) {
        alerts.push({
          event: 'license_expiring',
          data: { licenseId: lic.id, name: lic.name, expiryDate: lic.expiryDate, daysUntil },
        });
      }
    }
  }

  const costs = await kvGet('tom_cost_tracking');
  if (costs && Array.isArray(costs.items)) {
    for (const item of costs.items) {
      if (!item.renewalDate) continue;
      const renewMs = new Date(item.renewalDate + 'T00:00:00Z').getTime();
      const daysUntil = Math.floor((renewMs - todayMs) / 86400000);
      if (daysUntil >= 0 && daysUntil <= 7) {
        alerts.push({
          event: 'cost_renewal_soon',
          data: { itemId: item.id, name: item.name || item.service || item.id, renewalDate: item.renewalDate, daysUntil, amount: item.amount || 0 },
        });
      }
    }
  }

  const calories = await kvGet('tom_calories');
  if (calories && calories.logs) {
    const yesterday = new Date(todayMs - 86400000).toISOString().split('T')[0];
    if (!calories.logs[today] && !calories.logs[yesterday]) {
      const lastDate = Object.keys(calories.logs).sort().pop();
      if (lastDate) {
        const daysSince = Math.floor((todayMs - new Date(lastDate + 'T00:00:00Z').getTime()) / 86400000);
        if (daysSince >= 3 && daysSince <= 7) {
          alerts.push({
            event: 'calories_stale',
            data: { lastLogDate: lastDate, daysSince },
          });
        }
      }
    }
  }

  if (!alerts.length) {
    return res.status(200).json({ success: true, alerts: 0, message: 'all clear' });
  }

  const results = [];
  for (const alert of alerts) {
    try {
      await fireWebhook(alert.event, alert.data);
      results.push({ event: alert.event, sent: true });
    } catch (e) {
      results.push({ event: alert.event, error: e.message });
    }
  }

  return res.status(200).json({ success: true, alerts: alerts.length, results });
};

const { kvGet, kvSet, fireWebhook } = require('../db');

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

  // Poll CRM project health — flag at-risk and late projects
  const crmKey = process.env.HUB_SHARED_KEY || process.env.ROUTINE_SECRET;
  if (crmKey) {
    try {
      const pRes = await fetch('https://rankify-crm.vercel.app/api/projects', {
        headers: { 'Authorization': 'Bearer ' + crmKey },
      });
      if (pRes.ok) {
        const { projects } = await pRes.json();
        const now = new Date();
        for (const p of (projects || [])) {
          if (p.status === 'complete' || p.status === 'cancelled') continue;
          let health = p.health || 'on_track';
          if (p.deadlineAt) {
            const daysLeft = Math.floor((new Date(p.deadlineAt + 'T00:00:00Z') - now) / 86400000);
            if (daysLeft < 0 && !p.siteDeliveredAt) health = 'late';
            else if (daysLeft <= 3 && !p.siteDeliveredAt) health = 'at_risk';
          }
          if (health === 'late') {
            alerts.push({ event: 'project_late', data: { projectId: p.id, name: p.name, deadline: p.deadlineAt, status: p.status } });
          } else if (health === 'at_risk') {
            alerts.push({ event: 'project_at_risk', data: { projectId: p.id, name: p.name, deadline: p.deadlineAt, status: p.status } });
          }
          // Check 30-day care ending within 7 days
          if (p.careEndAt || p.postLaunchCareEnd) {
            const careEnd = p.careEndAt || p.postLaunchCareEnd;
            const daysUntilCareEnd = Math.floor((new Date(careEnd + 'T00:00:00Z') - now) / 86400000);
            if (daysUntilCareEnd >= 0 && daysUntilCareEnd <= 7) {
              alerts.push({ event: 'care_period_ending', data: { projectId: p.id, name: p.name, careEndAt: careEnd, daysLeft: daysUntilCareEnd } });
            }
          }
        }
        await kvSet('tom_crm_projects', { tracks: projects, fetchedAt: now.toISOString() });
      }
    } catch (_) {}
  }

  // C7: Poll CRM flow-health once per sweep
  const crmHealthKey = process.env.HUB_SHARED_KEY || process.env.ROUTINE_SECRET;
  if (crmHealthKey) {
    try {
      const hRes = await fetch('https://rankify-crm.vercel.app/api/health', {
        headers: { 'Authorization': 'Bearer ' + crmHealthKey },
      });
      if (hRes.ok) {
        const health = await hRes.json();
        if (!health.ok) {
          alerts.push({
            event: 'crm_flow_health_alert',
            data: { counts: health.counts, checkedAt: health.checkedAt },
          });
        }
        await kvSet('tom_crm_flow_health', { ...health, polledAt: new Date().toISOString() });
      }
    } catch (_) {}
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

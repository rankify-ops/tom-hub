// /api/projects — Project timeline view for the Hub dashboard.
// Fetches all projects from CRM, computes timeline tracks with milestones,
// and returns data for the all-projects timeline visualization.
// Caches in KV for 15 minutes to avoid hammering CRM.

const { handleCors, requireAuth } = require('./_auth');
const { kvGet, kvSet } = require('./db');

const CACHE_KEY = 'tom_crm_projects';
const CACHE_TTL_MS = 900000; // 15 minutes

const MILESTONE_ORDER = [
  { key: 'deposit_paid', label: 'Deposit Paid', field: 'depositPaidAt' },
  { key: 'build_started', label: 'Build', field: 'buildStartedAt' },
  { key: 'first_revisions_sent', label: 'First Revisions', field: 'revisionsSentAt' },
  { key: 'feedback_received', label: 'Feedback', field: 'revisionsReceivedAt' },
  { key: 'site_delivered', label: 'Delivery', field: 'siteDeliveredAt' },
  { key: 'final_invoice_sent', label: 'Final Invoice', field: 'finalInvoiceSentAt' },
  { key: 'go_live', label: 'Go-Live', field: 'goLiveAt' },
  { key: 'care_end', label: '30-Day Care End', field: 'careEndAt' },
];

function computeHealth(project) {
  if (project.health && project.health !== 'on_track') return project.health;

  const now = new Date();
  if (project.deadlineAt) {
    const deadline = new Date(project.deadlineAt + 'T00:00:00Z');
    const daysLeft = Math.floor((deadline - now) / 86400000);
    if (daysLeft < 0) return 'late';
    if (daysLeft <= 3) return 'at_risk';
  }

  if (project.turnaroundDays && project.depositPaidAt) {
    const start = new Date(project.depositPaidAt + 'T00:00:00Z');
    const expected = new Date(start.getTime() + project.turnaroundDays * 86400000);
    const daysOver = Math.floor((now - expected) / 86400000);
    if (daysOver > 0 && !project.siteDeliveredAt) return 'late';
    if (daysOver > -3 && !project.siteDeliveredAt) return 'at_risk';
  }

  return 'on_track';
}

function buildTimeline(project) {
  const milestones = [];
  for (const m of MILESTONE_ORDER) {
    const dateFromField = project[m.field];
    const dateFromMilestones = project.milestones && project.milestones[m.key];
    const date = dateFromField || dateFromMilestones || null;
    milestones.push({
      key: m.key,
      label: m.label,
      date,
      done: !!date,
    });
  }
  return milestones;
}

async function fetchProjects() {
  const crmKey = process.env.HUB_SHARED_KEY || process.env.CRM_ADMIN_API_KEY;
  if (!crmKey) return null;

  try {
    const resp = await fetch('https://rankify-crm.vercel.app/api/projects', {
      headers: { 'Authorization': 'Bearer ' + crmKey },
    });
    if (!resp.ok) return null;
    const { projects } = await resp.json();
    return projects || [];
  } catch (_) {
    return null;
  }
}

async function fetchClients() {
  const crmKey = process.env.HUB_SHARED_KEY || process.env.CRM_ADMIN_API_KEY;
  if (!crmKey) return {};

  try {
    const resp = await fetch('https://rankify-crm.vercel.app/api/routine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + crmKey },
      body: JSON.stringify({ action: 'list_clients' }),
    });
    if (!resp.ok) return {};
    const { clients } = await resp.json();
    const map = {};
    for (const c of (clients || [])) map[c.id] = { company: c.company, contact: c.contact };
    return map;
  } catch (_) {
    return {};
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const forceRefresh = url.searchParams.get('refresh') === '1';

      let cache = await kvGet(CACHE_KEY);
      const cacheAge = cache && cache.fetchedAt ? Date.now() - new Date(cache.fetchedAt).getTime() : Infinity;

      if (!cache || cacheAge > CACHE_TTL_MS || forceRefresh) {
        const [projects, clientMap] = await Promise.all([fetchProjects(), fetchClients()]);
        if (projects) {
          const tracks = projects.map(p => {
            const client = clientMap[p.clientId] || {};
            return {
              id: p.id,
              name: p.name,
              clientId: p.clientId,
              clientName: client.company || 'Unknown',
              contact: client.contact || '',
              status: p.status,
              health: computeHealth(p),
              healthReason: p.healthReason || '',
              website: p.website || '',
              productType: p.productType || '',
              estimatedDealValue: p.estimatedDealValue || 0,
              milestones: buildTimeline(p),
              created: p.created,
            };
          });

          cache = { tracks, fetchedAt: new Date().toISOString() };
          await kvSet(CACHE_KEY, cache);
        }
      }

      if (!cache || !cache.tracks) {
        return res.status(503).json({ error: 'Project data not available' });
      }

      const statusFilter = url.searchParams.get('status');
      const healthFilter = url.searchParams.get('health');
      let tracks = cache.tracks;
      if (statusFilter) tracks = tracks.filter(t => t.status === statusFilter);
      if (healthFilter) tracks = tracks.filter(t => t.health === healthFilter);

      const summary = {
        total: cache.tracks.length,
        onTrack: cache.tracks.filter(t => t.health === 'on_track').length,
        atRisk: cache.tracks.filter(t => t.health === 'at_risk').length,
        late: cache.tracks.filter(t => t.health === 'late').length,
        byStatus: {},
      };
      for (const t of cache.tracks) {
        summary.byStatus[t.status] = (summary.byStatus[t.status] || 0) + 1;
      }

      return res.status(200).json({
        tracks,
        summary,
        cacheAge: cache.fetchedAt,
        milestoneLabels: MILESTONE_ORDER.map(m => ({ key: m.key, label: m.label })),
      });
    }

    return res.status(405).json({ error: 'GET only' });
  } catch (err) {
    console.error('projects timeline error:', err);
    return res.status(500).json({ error: err.message });
  }
};

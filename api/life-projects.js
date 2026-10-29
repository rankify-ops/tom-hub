// GET /api/life-projects — read-only Life Projects board.
// Pulls LIVE from each area's own hub, server-side only:
//   Rankify  → Rankify CRM   (RANKIFY_CRM_READ_KEY, falls back to CRM_ADMIN_API_KEY)
//   Hiatus   → Hiatus Hub    (HIATUS_HUB_READ_KEY)
//   ITM      → ITM Command Centre (ITM_COMMAND_CENTRE_KEY)
//   Personal → Tom Hub's own KV
// Keys never leave the server and are never echoed. Only GET/list calls are made;
// nothing is written to any hub. Each lane fails on its own and reports why.
const { requireAuth } = require('./_auth');
const { kvGet } = require('./db');
const LP = require('../lib/life-projects');

const TIMEOUT_MS = 12000;
const CACHE_MS = 60000;
let memo = null; // per-instance cache only; never written to shared KV

const RANKIFY_BASE = process.env.RANKIFY_CRM_URL || 'https://rankify-crm.vercel.app';
const HIATUS_BASE = process.env.HIATUS_HUB_URL || 'https://hiatus-hub.vercel.app';
const ITM_BASE = process.env.ITM_COMMAND_CENTRE_URL || 'https://personal-dashboard-itm-tools.vercel.app';

function authHeader(key) {
  const k = String(key || '').trim();
  return /^Bearer\s/i.test(k) ? k : 'Bearer ' + k;
}

class LaneError extends Error {
  constructor(state, message) { super(message); this.state = state; }
}

async function getJSON(url, key, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: authHeader(key), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (resp.status === 401 || resp.status === 403) throw new LaneError('needs_key', `Key rejected (HTTP ${resp.status})`);
    if (resp.status === 404) throw new LaneError('needs_endpoint', 'Endpoint not found (HTTP 404)');
    if (!resp.ok) throw new LaneError('error', `Hub returned HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    if (e instanceof LaneError) throw e;
    throw new LaneError('error', e.name === 'AbortError' ? 'Hub timed out' : 'Hub unreachable');
  } finally {
    clearTimeout(timer);
  }
}

async function rankifyLane(now) {
  const key = process.env.RANKIFY_CRM_READ_KEY || process.env.CRM_ADMIN_API_KEY;
  if (!key) throw new LaneError('needs_key', 'Add RANKIFY_CRM_READ_KEY to Tom Hub env');
  const routine = RANKIFY_BASE + '/api/routine';
  const missed = [];
  const soft = (label, p, empty) => p.catch(e => { missed.push(`${label} (${e.message})`); return empty; });
  const [proj, clients, todos, space] = await Promise.all([
    getJSON(RANKIFY_BASE + '/api/projects', key),
    soft('clients', getJSON(routine, key, { action: 'list_clients', limit: 200 }), { clients: [] }),
    soft('to-dos', getJSON(routine, key, { action: 'list_space', space: 'todos' }), { items: [] }),
    soft('projects space', getJSON(routine, key, { action: 'list_space', space: 'projects' }), { items: [] }),
  ]);
  const cards = LP.rankifyCards({
    projects: proj.projects || [], clients: clients.clients || [],
    todos: todos.items || [], spaceItems: space.items || [],
  }, now);
  return { cards, note: missed.length ? 'Showing client builds only. Not loaded: ' + missed.join(', ') + '.' : '' };
}

async function hiatusLane(now) {
  const key = process.env.HIATUS_HUB_READ_KEY;
  if (!key) throw new LaneError('needs_key', 'Add HIATUS_HUB_READ_KEY to Tom Hub env');
  const d = await getJSON(HIATUS_BASE + '/api/agent?sections=tasks,projects&period=all', key);
  const cards = LP.hiatusCards({ tasks: d.tasks || [], projects: d.projects || [] }, now);
  const note = Array.isArray(d.projects) ? '' : 'Hiatus Hub has no projects section yet, so only Hub tasks show here.';
  return { cards, note };
}

async function itmLane(now) {
  const key = process.env.ITM_COMMAND_CENTRE_KEY;
  if (!key) throw new LaneError('needs_key', 'Add ITM_COMMAND_CENTRE_KEY to Tom Hub env');
  const d = await getJSON(ITM_BASE + '/api/bot', key, { action: 'list_businesses' });
  const businesses = Array.isArray(d) ? d : (d.businesses || d.data || []);
  return LP.itmCards(businesses, now);
}

async function personalLane(now) {
  const [todos, brain, goals, projects] = await Promise.all([
    kvGet('tom_todos'), kvGet('tom_brain'), kvGet('tom_goals'), kvGet('tom_projects'),
  ]);
  return LP.personalCards({
    todos: (todos && todos.todos) || [], brain: brain || {}, goals: goals || {},
    projects: (projects && projects.projects) || [],
  }, now);
}

async function runLane(area, fn, now) {
  const started = Date.now();
  try {
    const r = await fn(now);
    const cards = Array.isArray(r) ? r : r.cards;
    return { area, state: 'live', note: (r && r.note) || '', fetchedAt: new Date().toISOString(), ms: Date.now() - started, cards: LP.sortCards(cards) };
  } catch (e) {
    return { area, state: e.state || 'error', note: e.state ? e.message : 'Could not load this lane', fetchedAt: new Date().toISOString(), ms: Date.now() - started, cards: [] };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAuth(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const refresh = /[?&]refresh=1/.test(req.url || '');
  if (!refresh && memo && Date.now() - memo.at < CACHE_MS) return res.status(200).json(memo.body);
  const now = Date.now();
  const lanes = await Promise.all([
    runLane('Rankify', rankifyLane, now),
    runLane('Personal', personalLane, now),
    runLane('ITM', itmLane, now),
    runLane('Hiatus', hiatusLane, now),
  ]);
  const body = { generatedAt: new Date(now).toISOString(), today: LP.todayISO(now), lanes };
  memo = { at: Date.now(), body };
  return res.status(200).json(body);
};

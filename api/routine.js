const { kvGet, kvSet, fireWebhook } = require('./db');
const { handleCors, requireAuth } = require('./_auth');

const SPACES = {
  goals:      { key: 'tom_goals',         default: { goals: [], statuses_2026: {} } },
  notes:      { key: 'tom_notes',         default: { notes: [] } },
  checklists: { key: 'tom_checklists',    default: { lists: [] } },
  calories:   { key: 'tom_calories',      default: { savedFoods: [], logs: {}, settings: {} } },
  finances:   { key: 'tom_finances',      default: { entries: [] } },
  costs:      { key: 'tom_cost_tracking', default: { items: [], weeklyIncome: 0 } },
  weight:     { key: 'tom_weight',        default: { logs: [] } },
  training:   { key: 'tom_training',      default: { templates: [], logs: [] } },
  licenses:   { key: 'tom_licenses',      default: { licenses: [] } },
  properties: { key: 'tom_properties',    default: { properties: [], valueLog: [] } },
};

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const spaces = {};
      for (const [name, cfg] of Object.entries(SPACES)) {
        spaces[name] = await kvGet(cfg.key) || { ...cfg.default };
      }
      return res.status(200).json({ source: 'tom-hub', spaces });
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'ping') {
        return res.status(200).json({ source: 'tom-hub', status: 'ok', timestamp: new Date().toISOString() });
      }

      if (action === 'list_spaces') {
        return res.status(200).json({ spaces: Object.keys(SPACES) });
      }

      if (action === 'get_space') {
        const { space } = req.body;
        if (!space || !SPACES[space]) return res.status(400).json({ error: `Unknown space. Available: ${Object.keys(SPACES).join(', ')}` });
        const data = await kvGet(SPACES[space].key) || { ...SPACES[space].default };
        return res.status(200).json({ space, data });
      }

      if (action === 'set_space') {
        const { space, data } = req.body;
        if (!space || !SPACES[space]) return res.status(400).json({ error: `Unknown space. Available: ${Object.keys(SPACES).join(', ')}` });
        if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data object required' });
        data.updated = new Date().toISOString();
        await kvSet(SPACES[space].key, data);
        fireWebhook('space_updated', { space, summary: Object.keys(data).join(', ') });
        return res.status(200).json({ success: true, space });
      }

      // ── Array-level CRUD for spaces that store items in arrays ──

      if (action === 'add_item') {
        const { space, arrayKey, item } = req.body;
        if (!space || !SPACES[space]) return res.status(400).json({ error: `Unknown space` });
        if (!arrayKey || !item) return res.status(400).json({ error: 'arrayKey and item required' });
        const data = await kvGet(SPACES[space].key) || { ...SPACES[space].default };
        if (!Array.isArray(data[arrayKey])) return res.status(400).json({ error: `${arrayKey} is not an array in ${space}` });
        item.id = item.id || Date.now().toString();
        item.created = item.created || new Date().toISOString();
        item.modified = new Date().toISOString();
        data[arrayKey].unshift(item);
        data.updated = new Date().toISOString();
        await kvSet(SPACES[space].key, data);
        fireWebhook('item_added', { space, itemId: item.id });
        return res.status(200).json({ success: true, item });
      }

      if (action === 'update_item') {
        const { space, arrayKey, id, updates } = req.body;
        if (!space || !SPACES[space]) return res.status(400).json({ error: `Unknown space` });
        if (!arrayKey || !id || !updates) return res.status(400).json({ error: 'arrayKey, id, and updates required' });
        const data = await kvGet(SPACES[space].key) || { ...SPACES[space].default };
        if (!Array.isArray(data[arrayKey])) return res.status(400).json({ error: `${arrayKey} is not an array in ${space}` });
        const idx = data[arrayKey].findIndex(i => i.id === id);
        if (idx < 0) return res.status(404).json({ error: 'Item not found' });
        Object.assign(data[arrayKey][idx], updates, { modified: new Date().toISOString() });
        data.updated = new Date().toISOString();
        await kvSet(SPACES[space].key, data);
        fireWebhook('item_updated', { space, itemId: id });
        return res.status(200).json({ success: true, item: data[arrayKey][idx] });
      }

      if (action === 'delete_item') {
        const { space, arrayKey, id } = req.body;
        if (!space || !SPACES[space]) return res.status(400).json({ error: `Unknown space` });
        if (!arrayKey || !id) return res.status(400).json({ error: 'arrayKey and id required' });
        const data = await kvGet(SPACES[space].key) || { ...SPACES[space].default };
        if (!Array.isArray(data[arrayKey])) return res.status(400).json({ error: `${arrayKey} is not an array in ${space}` });
        data[arrayKey] = data[arrayKey].filter(i => i.id !== id);
        data.updated = new Date().toISOString();
        await kvSet(SPACES[space].key, data);
        fireWebhook('item_deleted', { space, itemId: id });
        return res.status(200).json({ success: true });
      }

      // ── Test webhook ──

      if (action === 'test_webhook') {
        await fireWebhook('test', { message: 'Webhook test from tom-hub' });
        return res.status(200).json({ success: true, message: 'Test webhook fired' });
      }

      // ── Calories: special log-by-date structure ──

      if (action === 'log_calories') {
        const { date, entries } = req.body;
        if (!date || !entries) return res.status(400).json({ error: 'date and entries required' });
        const data = await kvGet(SPACES.calories.key) || { ...SPACES.calories.default };
        if (!data.logs) data.logs = {};
        data.logs[date] = entries;
        data.updated = new Date().toISOString();
        await kvSet(SPACES.calories.key, data);
        return res.status(200).json({ success: true, date });
      }

      // ── Weight: append log entry ──

      if (action === 'log_weight') {
        const { date, weight, notes } = req.body;
        if (!date || weight === undefined) return res.status(400).json({ error: 'date and weight required' });
        const data = await kvGet(SPACES.weight.key) || { ...SPACES.weight.default };
        const existing = data.logs.findIndex(l => l.date === date);
        const entry = { date, weight: Number(weight), notes: notes || '', modified: new Date().toISOString() };
        if (existing >= 0) data.logs[existing] = entry;
        else data.logs.push(entry);
        data.logs.sort((a, b) => b.date.localeCompare(a.date));
        data.updated = new Date().toISOString();
        await kvSet(SPACES.weight.key, data);
        return res.status(200).json({ success: true, entry });
      }

      // ── Training: log a session ──

      if (action === 'log_training') {
        const { session } = req.body;
        if (!session || !session.date) return res.status(400).json({ error: 'session with date required' });
        const data = await kvGet(SPACES.training.key) || { ...SPACES.training.default };
        session.id = session.id || Date.now().toString();
        session.created = new Date().toISOString();
        data.logs.unshift(session);
        data.updated = new Date().toISOString();
        await kvSet(SPACES.training.key, data);
        return res.status(200).json({ success: true, session });
      }

      // ── Whoop: read-only summary ──

      if (action === 'get_whoop') {
        const { days } = req.body;
        const history = await kvGet('tom_whoop_history') || {};
        const dates = Object.keys(history).sort().reverse().slice(0, days || 7);
        const entries = {};
        for (const d of dates) entries[d] = history[d];
        const meta = await kvGet('tom_whoop_sync_meta') || {};
        return res.status(200).json({ entries, meta, daysReturned: dates.length });
      }

      // ── PocketSmith: read-only ──

      if (action === 'get_banking') {
        const data = await kvGet('tom_pocketsmith') || { accounts: [], transactions: [] };
        const { limit } = req.body;
        if (limit) data.transactions = data.transactions.slice(0, limit);
        return res.status(200).json(data);
      }

      return res.status(400).json({ error: 'Unknown action. Available: ping, list_spaces, get_space, set_space, add_item, update_item, delete_item, test_webhook, log_calories, log_weight, log_training, get_whoop, get_banking' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('routine error:', err);
    return res.status(500).json({ error: err.message });
  }
};

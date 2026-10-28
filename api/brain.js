const { requireAuth } = require('./_auth');
const { kvGet, kvSet } = require('./db');

// Personal Brain + To-do. Personal only: never stores Rankify, ITM or Hiatus data.
const TODO_KEY = 'tom_todos';
const BRAIN_KEY = 'tom_brain';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === 'GET') {
      const [todos, brain] = await Promise.all([kvGet(TODO_KEY), kvGet(BRAIN_KEY)]);
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json({
        todos: (todos && todos.todos) || [],
        todosUpdated: todos && todos.updated,
        brain: brain || { sops: [], flows: [], runs: [], queue: [], shared: [] },
      });
    }
    if (req.method === 'POST') {
      const { action } = req.body || {};
      if (action === 'save_todos') {
        const { todos } = req.body;
        if (!Array.isArray(todos)) return res.status(400).json({ error: 'todos array required' });
        await kvSet(TODO_KEY, { todos, updated: new Date().toISOString() });
        return res.status(200).json({ success: true });
      }
      if (action === 'queue_decide') {
        const { id, decision } = req.body;
        if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });
        const brain = (await kvGet(BRAIN_KEY)) || { sops: [], flows: [], runs: [], queue: [], shared: [] };
        const item = (brain.queue || []).find(q => q.id === id);
        if (!item) return res.status(404).json({ error: 'queue item not found' });
        item.status = decision;
        item.decidedAt = new Date().toISOString();
        brain.runs = [{ id: 'run_' + Date.now(), at: item.decidedAt, flow: 'approval-queue', summary: `Thomas ${decision}: ${item.title}`, result: 'ok' }, ...(brain.runs || [])].slice(0, 200);
        brain.updated = item.decidedAt;
        await kvSet(BRAIN_KEY, brain);
        return res.status(200).json({ success: true, item });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'GET or POST' });
  } catch (err) {
    console.error('brain error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// Life Projects board: pure normalisers, no I/O.
// Each area's hub stays the source of truth. These functions only reshape a
// read-only response into one card format for display. Nothing is written back
// and nothing from one area is merged into another.

const AREAS = ['Rankify', 'Personal', 'ITM', 'Hiatus'];
const DAY = 86400000;

function todayISO(now) {
  // Brisbane date (UTC+10, no DST)
  return new Date((now || Date.now()) + 10 * 3600000).toISOString().slice(0, 10);
}

function daysUntil(date, now) {
  if (!date) return null;
  const d = Date.parse(String(date).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(d)) return null;
  const t = Date.parse(todayISO(now) + 'T00:00:00Z');
  return Math.round((d - t) / DAY);
}

function clean(s, max) {
  let t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (max && t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
  return t;
}

function earliest(dates) {
  const ok = dates.filter(Boolean).map(d => String(d).slice(0, 10)).sort();
  return ok[0] || null;
}

// status: late | at_risk | blocked | on_track | open (no date) | done
function statusFrom({ due, blocker, health, done, now }) {
  if (done) return 'done';
  const d = daysUntil(due, now);
  if (d != null && d < 0) return 'late';
  if (health === 'late') return 'late';
  if (blocker) return 'blocked';
  if (health === 'at_risk' || (d != null && d <= 3)) return 'at_risk';
  if (health === 'on_track' || d != null) return 'on_track';
  return 'open';
}

function card(base) {
  return {
    id: base.id,
    area: base.area,
    name: clean(base.name, 80),
    kind: base.kind || '',
    stages: base.stages || [],
    stageIndex: Number.isInteger(base.stageIndex) ? base.stageIndex : -1,
    where: clean(base.where, 140),
    next: clean(base.next, 220),
    implementNext: (base.implementNext || []).map(s => clean(s, 160)).filter(Boolean).slice(0, 3),
    due: base.due ? String(base.due).slice(0, 10) : null,
    blocker: clean(base.blocker, 200) || null,
    owner: clean(base.owner, 60),
    status: base.status,
    milestones: (base.milestones || []).filter(m => m && m.date).map(m => ({ date: String(m.date).slice(0, 10), label: clean(m.label, 40) })),
    source: base.source || '',
    link: base.link || '',
    openCount: base.openCount == null ? null : base.openCount,
    progress: typeof base.progress === 'number' ? Math.round(base.progress * 100) / 100 : null,
  };
}

// ---------- Rankify (Rankify CRM) ----------
const PRIORITY_RANK = { critical: 0, urgent: 0, high: 1, medium: 2, med: 2, low: 3 };
function byUrgency(a, b) {
  const da = a.due || '9999', db = b.due || '9999';
  if (da !== db) return da < db ? -1 : 1;
  return (PRIORITY_RANK[a.prio] ?? 2) - (PRIORITY_RANK[b.prio] ?? 2);
}
function stripTags(s) { return String(s || '').replace(/\s*\[[^\]]*\]\s*$/, ''); }

function rankifyCards({ projects, clients, todos, spaceItems }, now) {
  const out = [];
  const todosByClient = {};
  for (const t of todos || []) {
    if (t.done || !t.clientId) continue;
    (todosByClient[t.clientId] = todosByClient[t.clientId] || []).push({ text: stripTags(t.name), due: t.dueDate, prio: t.priority });
  }
  const projectClientIds = new Set();
  for (const p of projects || []) {
    projectClientIds.add(String(p.clientId));
    const tl = Array.isArray(p.timeline) ? p.timeline : [];
    const stages = tl.map(s => s.label);
    let idx = tl.findIndex(s => !s.done);
    if (idx < 0 && tl.length) idx = tl.length - 1;
    const open = (p.openTodos || []).map(t => ({ text: stripTags(t.name), due: t.dueDate, prio: t.priority }))
      .concat((todosByClient[p.clientId] || []))
      .filter((t, i, a) => a.findIndex(x => x.text === t.text) === i)
      .sort(byUrgency);
    const client = p.client || (clients || []).find(c => String(c.id) === String(p.clientId)) || {};
    const waiting = client.waitingOnClient || (tl[idx] && /waiting on client/i.test(tl[idx].label) ? 'Waiting on client' : '');
    const nextStageDue = tl.slice(Math.max(idx, 0)).map(s => s.due).find(Boolean);
    const due = earliest([open[0] && open[0].due, p.deadlineAt, nextStageDue]);
    const milestones = tl.filter(s => !s.done && s.due).map(s => ({ date: s.due, label: `${p.name}: ${s.label}` }));
    if (p.deadlineAt) milestones.push({ date: p.deadlineAt, label: `${p.name}: deadline` });
    out.push(card({
      id: 'rk_' + p.id, area: 'Rankify', name: p.name,
      kind: `Client build${p.productType ? ' · ' + p.productType : ''}`,
      stages, stageIndex: idx,
      where: idx >= 0 && stages[idx] ? `${stages[idx]} (stage ${idx + 1} of ${stages.length})` : (p.stage || p.status || ''),
      next: open[0] ? open[0].text : (idx >= 0 && stages[idx] ? stages[idx] : ''),
      implementNext: open.slice(1, 3).map(t => t.text).concat(open.length < 2 && p.notes ? [p.notes] : []),
      due, blocker: typeof waiting === 'string' ? waiting : (waiting ? 'Waiting on client' : ''),
      owner: 'Rankify CRM', health: p.health,
      status: statusFrom({ due, blocker: waiting, health: p.health, now }),
      milestones, source: 'Rankify CRM · projects', link: 'https://rankify-crm.vercel.app/',
      openCount: open.length,
    }));
  }
  // Active clients with no project card yet (e.g. ongoing change work)
  for (const c of clients || []) {
    if (c.status !== 'active' || projectClientIds.has(String(c.id))) continue;
    const open = (todosByClient[c.id] || []).sort(byUrgency);
    const due = earliest([open[0] && open[0].due]);
    const blocker = c.waitingOnClient ? (typeof c.waitingOnClient === 'string' ? c.waitingOnClient : 'Waiting on client') : '';
    out.push(card({
      id: 'rkc_' + c.id, area: 'Rankify', name: c.company || c.contact || 'Client',
      kind: 'Client work (no project card in CRM)', stages: [], stageIndex: -1,
      where: 'Active client · stage not tracked in CRM',
      next: open[0] ? open[0].text : 'No open CRM to-dos',
      implementNext: open.slice(1, 3).map(t => t.text),
      due, blocker, owner: 'Rankify CRM',
      status: statusFrom({ due, blocker, now }),
      milestones: due ? [{ date: due, label: c.company }] : [],
      source: 'Rankify CRM · clients + todos', link: 'https://rankify-crm.vercel.app/', openCount: open.length,
    }));
  }
  // Internal products/systems from the CRM 'projects' space
  for (const it of spaceItems || []) {
    if (it.archived || /archiv|done|complete|dropped/i.test(it.status || '')) continue;
    const due = it.due || it.dueDate || null;
    out.push(card({
      id: 'rks_' + it.id, area: 'Rankify', name: it.name, kind: it.type || 'Product / internal',
      stages: Array.isArray(it.stages) ? it.stages : [], stageIndex: Number.isInteger(it.stageIndex) ? it.stageIndex : -1,
      where: it.where || it.status || '', next: it.next || it.description || '',
      implementNext: Array.isArray(it.implementNext) ? it.implementNext : [],
      due, blocker: it.blocker || '', owner: it.owner || 'Rankify CRM',
      status: statusFrom({ due, blocker: it.blocker, now }),
      milestones: due ? [{ date: due, label: it.name }] : [],
      source: 'Rankify CRM · projects space', link: 'https://rankify-crm.vercel.app/',
    }));
  }
  return out;
}

// ---------- Hiatus (Hiatus Hub tasks; no projects section yet) ----------
function hiatusCards({ projects }, now) {
  const out = [];
  for (const p of projects || []) {
    const due = p.due || null;
    out.push(card({
      id: 'hi_' + p.id, area: 'Hiatus', name: p.name, kind: p.type || 'Project',
      stages: p.stages || [], stageIndex: Number.isInteger(p.stageIndex) ? p.stageIndex : -1,
      where: p.where || '', next: p.next || '', implementNext: p.implementNext || [],
      due, blocker: p.blocker || '', owner: p.owner || 'Hiatus Hub',
      status: statusFrom({ due, blocker: p.blocker, now }),
      milestones: due ? [{ date: due, label: p.name }] : [], source: 'Hiatus Hub · projects', link: 'https://hiatus-hub.vercel.app/',
    }));
  }
  // Hub tasks are a to-do list, not projects, so they stay in Hiatus Hub and
  // never show on the board (Thomas, 29 Oct 2026).
  return out;
}

// ---------- ITM (Command Centre: one card per business, lists as detail) ----------
const IMPORTANCE_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
function itmCards(businesses, now) {
  const out = [];
  for (const b of businesses || []) {
    const open = [];
    const perList = [];
    let total = 0;
    for (const s of b.sections || []) {
      const items = s.items || [];
      total += items.length;
      const o = items.filter(i => !i.done).map(i => ({
        text: i.text, list: s.title, due: i.dueDate, prio: String(i.importance || 'medium').toLowerCase(),
      }));
      if (o.length) perList.push(`${s.title} ${o.length}`);
      open.push(...o);
    }
    if (!open.length) continue;
    open.sort((a, c) => byUrgency(a, c) || (IMPORTANCE_RANK[a.prio] ?? 2) - (IMPORTANCE_RANK[c.prio] ?? 2));
    const due = earliest(open.map(o => o.due));
    const doneN = total - open.length;
    out.push(card({
      id: 'itm_' + b.id, area: 'ITM', name: b.name, kind: 'Command Centre workspace',
      stages: [], stageIndex: -1,
      where: `${open.length} open · ${perList.join(', ')}`,
      next: `${open[0].list}: ${open[0].text}`,
      implementNext: open.slice(1, 3).map(o => `${o.list}: ${o.text}`),
      due, blocker: '', owner: 'ITM Command Centre',
      status: statusFrom({ due, now }),
      milestones: open.filter(o => o.due).map(o => ({ date: o.due, label: `${b.name}: ${o.text}` })),
      source: 'ITM Command Centre · ' + b.name, link: '', openCount: open.length,
      progress: total ? doneN / total : null,
    }));
  }
  return out;
}

// ---------- Personal (Tom Hub's own KV) ----------
function personalCards({ projects }, now) {
  const out = [];
  for (const p of projects || []) {
    if (p.done) continue;
    const due = p.due || null;
    out.push(card({
      id: 'pp_' + p.id, area: 'Personal', name: p.name, kind: p.type || 'Personal project',
      stages: p.stages || [], stageIndex: Number.isInteger(p.stageIndex) ? p.stageIndex : -1,
      where: p.where || '', next: p.next || '', implementNext: p.implementNext || [],
      due, blocker: p.blocker || '', owner: p.owner || 'Thomas',
      status: statusFrom({ due, blocker: p.blocker, now }),
      milestones: due ? [{ date: due, label: p.name }] : [], source: 'Tom Hub · projects', link: '/',
    }));
  }
  // To-dos, the Brain approval queue and goals are not projects. They live on
  // the to-do list, /brain and the goals page, so the board leaves them out
  // (Thomas, 29 Oct 2026). Only the personal `projects` space shows here.
  return out;
}

const STATUS_ORDER = { late: 0, blocked: 1, at_risk: 2, on_track: 3, open: 4, done: 5 };
function sortCards(cards) {
  return cards.slice().sort((a, b) => {
    const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (s) return s;
    return (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0;
  });
}

module.exports = { AREAS, rankifyCards, hiatusCards, itmCards, personalCards, sortCards, statusFrom, daysUntil, todayISO };

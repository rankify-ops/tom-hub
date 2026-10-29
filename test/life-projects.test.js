const test = require('node:test');
const assert = require('node:assert');
const LP = require('../lib/life-projects');
const NOW = Date.parse('2026-10-29T05:00:00Z'); // 3pm Brisbane

test('status: overdue beats everything, blocked next, then due soon', () => {
  assert.equal(LP.statusFrom({ due: '2026-10-20', blocker: 'x', now: NOW }), 'late');
  assert.equal(LP.statusFrom({ blocker: 'Waiting on client', now: NOW }), 'blocked');
  assert.equal(LP.statusFrom({ due: '2026-10-31', now: NOW }), 'at_risk');
  assert.equal(LP.statusFrom({ due: '2026-12-01', now: NOW }), 'on_track');
  assert.equal(LP.statusFrom({ now: NOW }), 'open');
});

test('rankify: project card has stages, you-are-here, next step from open to-dos', () => {
  const cards = LP.rankifyCards({
    projects: [{ id: 'p1', clientId: 'c1', name: 'Acme', productType: 'Shopify', health: 'on_track',
      timeline: [{ label: 'Paid', done: true }, { label: 'Build', done: false, due: '2026-11-20' }, { label: 'Live', done: false }],
      openTodos: [{ name: 'Do the menu [client request]', dueDate: '2026-11-10' }, { name: 'Fix footer', dueDate: '2026-11-12' }] }],
    clients: [{ id: 'c1', status: 'active', company: 'Acme', waitingOnClient: false },
      { id: 'c2', status: 'active', company: 'Beta', waitingOnClient: true }, { id: 'c3', status: 'lead', company: 'Lead Co' }],
    todos: [{ clientId: 'c2', name: 'Beta change', dueDate: null }], spaceItems: [{ id: 's1', name: 'App', status: 'active' }, { id: 's2', name: 'Old', status: 'archived' }],
  }, NOW);
  assert.equal(cards.length, 3);
  const a = cards[0];
  assert.equal(a.stageIndex, 1);
  assert.equal(a.next, 'Do the menu');
  assert.deepEqual(a.implementNext, ['Fix footer']);
  assert.equal(a.status, 'on_track');
  const b = cards.find(c => c.name === 'Beta');
  assert.equal(b.status, 'blocked');
  assert.ok(!cards.find(c => c.name === 'Lead Co'));
});

test('itm: one card per business, highest-urgency item next, empty businesses skipped', () => {
  const cards = LP.itmCards([{ id: 'b1', name: 'Work Sharp', sections: [
    { id: 's1', title: 'Website', items: [{ text: 'A', done: false, dueDate: null }, { text: 'B', done: false, dueDate: '2026-10-20' }, { text: 'C', done: true }] }] },
    { id: 'b2', name: 'Empty', sections: [{ id: 's2', title: 'X', items: [{ text: 'z', done: true }] }] }], NOW);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].next, 'Website: B');
  assert.equal(cards[0].status, 'late');
});

test('personal: groups to-dos, surfaces approval queue as blocked', () => {
  const cards = LP.personalCards({
    todos: [{ text: 'Update address with Medicare', due: '2026-11-04' }, { text: 'Lodge FY tax return', due: '2026-10-31' }, { text: 'Buy milk', done: true }],
    brain: { queue: [{ title: 'Decide X', status: 'pending' }, { title: 'Old', status: 'approved' }] }, goals: {},
  }, NOW);
  const names = cards.map(c => c.name).sort();
  assert.deepEqual(names, ['Change of address', 'Decisions waiting on you', 'Tax return']);
  assert.equal(cards.find(c => c.name === 'Decisions waiting on you').status, 'blocked');
});

test('hiatus: open tasks only', () => {
  const cards = LP.hiatusCards({ tasks: [{ id: '1', name: 'Open', done: false, dueDate: '2026-09-30', priority: 'critical' }, { id: '2', name: 'Done', done: true }] }, NOW);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].status, 'late');
});

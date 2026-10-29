const test = require('node:test');
const assert = require('node:assert');
process.env.TOM_JWT_SECRET = 'test-secret-dl';
process.env.ROUTINE_SECRET = 'bot-key-dl';
const { normaliseEntry, upsert, removeDate, summarise, hoursBetween, brisbaneDate } = require('../lib/daily-log');

test('hours worked from start/stop, including past midnight', () => {
  assert.equal(hoursBetween('08:00', '17:30'), 9.5);
  assert.equal(hoursBetween('22:00', '01:00'), 3);
  assert.equal(hoursBetween('', '17:00'), null);
});

test('entry is validated and hours computed', () => {
  const { entry } = normaliseEntry({ date: '2026-10-29', start: '08:00', stop: '18:00', mood: 6, stress: 7, exerciseType: 'Gym', exerciseMinutes: 45, healing: ['Slow breathing', 'Slow breathing'], note: 'ok' });
  assert.equal(entry.hours, 10);
  assert.deepEqual(entry.healing, ['Slow breathing']);
  assert.equal(normaliseEntry({ date: '2026-10-29', hours: 6.5, start: '08:00', stop: '18:00' }).entry.hours, 6.5);
  assert.ok(normaliseEntry({ date: '29/10/2026' }).error);
  assert.ok(normaliseEntry({ date: '2026-10-29', mood: 11 }).error);
  assert.ok(normaliseEntry({ date: '2026-10-29', stress: 0 }).error);
  assert.ok(normaliseEntry({ date: '2026-10-29', stop: '25:00' }).error);
  assert.equal(normaliseEntry({ date: '2026-10-29' }).entry.mood, null);
});

test('one entry per date (upsert) and delete', () => {
  let d = upsert({ entries: [] }, normaliseEntry({ date: '2026-10-28', mood: 5 }).entry);
  d = upsert(d, normaliseEntry({ date: '2026-10-29', mood: 4 }).entry);
  d = upsert(d, normaliseEntry({ date: '2026-10-28', mood: 8 }).entry);
  assert.equal(d.entries.length, 2);
  assert.equal(d.entries[0].date, '2026-10-29');
  assert.equal(d.entries[1].mood, 8);
  assert.equal(removeDate(d, '2026-10-28').entries.length, 1);
});

test('summary over 14 days', () => {
  const e = [
    { date: '2026-10-29', hours: 10, stop: '19:00', mood: 4, stress: 8, exerciseMinutes: 0, healing: [] },
    { date: '2026-10-28', hours: 8, stop: '17:00', mood: 6, stress: 6, exerciseMinutes: 45, healing: ['Slow breathing'] },
    { date: '2026-09-01', hours: 12, stop: '23:00', mood: 1, stress: 10 },
  ];
  const s = summarise(e, 14, '2026-10-29');
  assert.equal(s.daysLogged, 2);
  assert.equal(s.avgHours, 9);
  assert.equal(s.avgStop, '18:00');
  assert.equal(s.stoppedBy6pm, 1);
  assert.equal(s.avgMood, 5);
  assert.equal(s.exerciseDays, 1);
  assert.equal(s.breathingDays, 1);
  assert.match(brisbaneDate(), /^\d{4}-\d{2}-\d{2}$/);
});

function mockRes() {
  return { code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
}

test('bots cannot write the daily log (api + routine)', async () => {
  const dl = require('../api/daily-log');
  const routine = require('../api/routine');
  const bot = { authorization: 'Bearer bot-key-dl' };
  let r = mockRes();
  await dl({ method: 'POST', headers: bot, body: { action: 'save', entry: { date: '2026-10-29' } } }, r);
  assert.equal(r.code, 403);
  for (const action of ['set_space', 'add_item', 'update_item', 'delete_item']) {
    r = mockRes();
    await routine({ method: 'POST', headers: bot, body: { action, space: 'daily_log', data: {}, arrayKey: 'entries', item: {}, id: 'x', updates: {} } }, r);
    assert.equal(r.code, 403, action);
  }
  r = mockRes();
  await dl({ method: 'GET', headers: {} }, r);
  assert.equal(r.code, 401);
});

test('bots can read the daily log', async () => {
  const dl = require('../api/daily-log');
  const routine = require('../api/routine');
  const bot = { authorization: 'Bearer bot-key-dl' };
  let r = mockRes();
  await dl({ method: 'GET', headers: bot }, r);
  assert.equal(r.code, 200);
  assert.ok(Array.isArray(r.body.entries));
  r = mockRes();
  await routine({ method: 'POST', headers: bot, body: { action: 'get_daily_log', days: 14 } }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.readOnly, true);
  assert.equal(r.body.summary.days, 14);
});

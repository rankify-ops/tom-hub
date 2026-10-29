// Daily self-log (Thomas logs it himself; nothing here ever reminds or notifies).
// One entry per Brisbane date. Pure helpers so they can be unit-tested.

const KV_KEY = 'tom_daily_log';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEALING = ['Slow breathing', 'Walk outside', 'Beach / ocean', 'Sauna / cold', 'Stretch / yoga', 'Reading', 'Nap / rest', 'Friends / family', 'Nature', 'Music', 'No screens'];

function brisbaneDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function toMin(t) {
  if (!t || !TIME_RE.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function hoursBetween(start, end) {
  const a = toMin(start), b = toMin(end);
  if (a === null || b === null) return null;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}

function intInRange(v, lo, hi) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(n);
  if (r < lo || r > hi) return undefined;
  return r;
}

function str(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max).trim();
}

// Returns { entry } or { error }.
function normaliseEntry(input) {
  if (!input || typeof input !== 'object') return { error: 'entry object required' };
  const date = str(input.date, 10);
  if (!DATE_RE.test(date)) return { error: 'date must be YYYY-MM-DD' };
  const start = str(input.start, 5) || '';
  const stop = str(input.stop, 5) || '';
  if (start && !TIME_RE.test(start)) return { error: 'start must be HH:MM' };
  if (stop && !TIME_RE.test(stop)) return { error: 'stop must be HH:MM' };

  let hours = null;
  if (input.hours !== null && input.hours !== undefined && input.hours !== '') {
    const h = Number(input.hours);
    if (!Number.isFinite(h) || h < 0 || h > 24) return { error: 'hours must be 0-24' };
    hours = Math.round(h * 100) / 100;
  } else if (start && stop) {
    hours = hoursBetween(start, stop);
  }

  const mood = intInRange(input.mood, 1, 10);
  if (mood === undefined) return { error: 'mood must be 1-10' };
  const stress = intInRange(input.stress, 1, 10);
  if (stress === undefined) return { error: 'stress must be 1-10' };
  const exerciseMinutes = intInRange(input.exerciseMinutes, 0, 600);
  if (exerciseMinutes === undefined) return { error: 'exerciseMinutes must be 0-600' };

  const healing = Array.isArray(input.healing)
    ? [...new Set(input.healing.map(h => str(h, 40)).filter(Boolean))].slice(0, 20)
    : [];

  return {
    entry: {
      date,
      start,
      stop,
      hours,
      mood,
      moodNote: str(input.moodNote, 500),
      stress,
      exerciseType: str(input.exerciseType, 40),
      exerciseMinutes,
      healing,
      note: str(input.note, 2000),
    },
  };
}

function upsert(data, entry) {
  const out = { entries: Array.isArray(data?.entries) ? data.entries.slice() : [] };
  const now = new Date().toISOString();
  const i = out.entries.findIndex(e => e.date === entry.date);
  if (i >= 0) out.entries[i] = { ...entry, created: out.entries[i].created || now, modified: now };
  else out.entries.push({ ...entry, created: now, modified: now });
  out.entries.sort((a, b) => b.date.localeCompare(a.date));
  out.updated = now;
  return out;
}

function removeDate(data, date) {
  const entries = (data?.entries || []).filter(e => e.date !== date);
  return { entries, updated: new Date().toISOString() };
}

function avg(nums) {
  const v = nums.filter(n => typeof n === 'number' && Number.isFinite(n));
  if (!v.length) return null;
  return Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 10) / 10;
}

function minToTime(m) {
  if (m === null) return null;
  const r = Math.round(m);
  return String(Math.floor(r / 60) % 24).padStart(2, '0') + ':' + String(r % 60).padStart(2, '0');
}

// Summary over the last `days` calendar days ending at `today` (Brisbane date).
function summarise(entries, days = 14, today = brisbaneDate()) {
  const end = new Date(today + 'T00:00:00Z');
  const startD = new Date(end); startD.setUTCDate(end.getUTCDate() - (days - 1));
  const from = startD.toISOString().slice(0, 10);
  const inRange = (entries || []).filter(e => e.date >= from && e.date <= today);
  const stops = inRange.map(e => toMin(e.stop)).filter(m => m !== null);
  return {
    days,
    from,
    to: today,
    daysLogged: inRange.length,
    avgHours: avg(inRange.map(e => e.hours)),
    totalHours: Math.round(inRange.reduce((s, e) => s + (e.hours || 0), 0) * 10) / 10,
    avgStop: minToTime(stops.length ? stops.reduce((s, n) => s + n, 0) / stops.length : null),
    stoppedBy6pm: stops.filter(m => m <= 18 * 60).length,
    daysWithStopTime: stops.length,
    avgMood: avg(inRange.map(e => e.mood)),
    avgStress: avg(inRange.map(e => e.stress)),
    exerciseDays: inRange.filter(e => (e.exerciseMinutes || 0) > 0).length,
    exerciseMinutes: inRange.reduce((s, e) => s + (e.exerciseMinutes || 0), 0),
    breathingDays: inRange.filter(e => (e.healing || []).includes('Slow breathing')).length,
  };
}

module.exports = { KV_KEY, HEALING, brisbaneDate, hoursBetween, normaliseEntry, upsert, removeDate, summarise, toMin };

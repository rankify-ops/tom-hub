async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['GET', key]),
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV not configured');
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', key, value]),
  });
}

async function refreshTokens(tokens) {
  const res = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: process.env.WHOOP_CLIENT_ID,
      client_secret: process.env.WHOOP_CLIENT_SECRET,
    }).toString(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const updated = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000),
    updated: new Date().toISOString(),
  };
  await kvSet('tom_whoop_tokens', JSON.stringify(updated));
  return updated;
}

async function whoopGetAll(path, accessToken) {
  const all = [];
  let url = 'https://api.prod.whoop.com/developer' + path;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    if (data.records) all.push(...data.records);
    url = data.next_token
      ? url.split('&nextToken=')[0] + '&nextToken=' + data.next_token
      : null;
  }
  return all;
}

function toDateKey(isoStr) {
  const d = new Date(isoStr);
  const aest = new Date(d.getTime() + 10 * 3600000);
  return aest.toISOString().split('T')[0];
}

module.exports = async function handler(req, res) {
  try {
    let tokens = await kvGet('tom_whoop_tokens');
    if (!tokens) return res.status(200).json({ error: 'not_connected' });

    if (Date.now() > tokens.expires_at - 300000) {
      tokens = await refreshTokens(tokens);
      if (!tokens) return res.status(200).json({ error: 'refresh_failed' });
    }

    const at = tokens.access_token;
    const now = new Date();
    const yearAgo = new Date(now - 365 * 86400000).toISOString();
    const range = '&start=' + encodeURIComponent(yearAgo) + '&end=' + encodeURIComponent(now.toISOString());

    const [allWorkouts, allRecovery, allCycles, allSleep] = await Promise.all([
      whoopGetAll('/v2/activity/workout?limit=25' + range, at),
      whoopGetAll('/v2/recovery?limit=25' + range, at),
      whoopGetAll('/v2/cycle?limit=25' + range, at),
      whoopGetAll('/v2/activity/sleep?limit=25' + range, at),
    ]);

    const history = await kvGet('tom_whoop_history') || {};

    let workoutsAdded = 0;
    for (const w of allWorkouts) {
      if (!w.start) continue;
      const dateKey = toDateKey(w.start);
      if (!history[dateKey]) history[dateKey] = {};
      if (!history[dateKey].workouts) history[dateKey].workouts = [];
      const existing = history[dateKey].workouts.find(x => x.id === w.id);
      const entry = {
        id: w.id,
        sport: w.sport_name,
        sport_id: w.sport_id,
        strain: w.score?.strain,
        avg_hr: w.score?.average_heart_rate,
        max_hr: w.score?.max_heart_rate,
        kilojoule: w.score?.kilojoule,
        distance_m: w.score?.distance_meter,
        start: w.start,
        end: w.end,
        duration_min: w.start && w.end ? Math.round((new Date(w.end) - new Date(w.start)) / 60000) : null,
      };
      if (existing) Object.assign(existing, entry);
      else { history[dateKey].workouts.push(entry); workoutsAdded++; }
    }

    for (const rec of allRecovery) {
      if (!rec.created_at) continue;
      const dateKey = toDateKey(rec.created_at);
      if (!history[dateKey]) history[dateKey] = {};
      history[dateKey].recovery = {
        score: rec.score?.recovery_score,
        hrv: rec.score?.hrv_rmssd_milli,
        rhr: rec.score?.resting_heart_rate,
        spo2: rec.score?.spo2_percentage,
        skin_temp: rec.score?.skin_temp_celsius,
      };
    }

    for (const cycle of allCycles) {
      if (!cycle.start) continue;
      const dateKey = toDateKey(cycle.start);
      if (!history[dateKey]) history[dateKey] = {};
      history[dateKey].strain = {
        score: cycle.score?.strain,
        kilojoule: cycle.score?.kilojoule,
        avg_hr: cycle.score?.average_heart_rate,
        max_hr: cycle.score?.max_heart_rate,
      };
    }

    const sleeps = allSleep.filter(s => !s.nap);
    for (const sleep of sleeps) {
      if (!sleep.start) continue;
      const dateKey = toDateKey(sleep.start);
      if (!history[dateKey]) history[dateKey] = {};
      const stage = sleep.score?.stage_summary;
      history[dateKey].sleep = {
        total_ms: stage?.total_in_bed_time_milli,
        total_hours: stage ? +(stage.total_in_bed_time_milli / 3600000).toFixed(1) : null,
        rem_ms: stage?.total_rem_sleep_time_milli,
        deep_ms: stage?.total_slow_wave_sleep_time_milli,
        light_ms: stage?.total_light_sleep_time_milli,
        awake_ms: stage?.total_awake_time_milli,
        performance: sleep.score?.sleep_performance_percentage,
        consistency: sleep.score?.sleep_consistency_percentage,
        efficiency: sleep.score?.sleep_efficiency_percentage,
        respiratory_rate: sleep.score?.respiratory_rate,
      };
    }

    await kvSet('tom_whoop_history', JSON.stringify(history));

    const totalDays = Object.keys(history).length;
    const totalWorkouts = Object.values(history).reduce((s, d) => s + (d.workouts?.length || 0), 0);

    return res.status(200).json({
      success: true,
      backfilled: {
        workouts: allWorkouts.length,
        workoutsNew: workoutsAdded,
        recovery: allRecovery.length,
        cycles: allCycles.length,
        sleep: sleeps.length,
        totalDaysInHistory: totalDays,
        totalWorkoutsInHistory: totalWorkouts,
      },
    });
  } catch (err) {
    console.error('Backfill error:', err);
    return res.status(500).json({ error: err.message });
  }
};

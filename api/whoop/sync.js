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

async function whoopGet(path, accessToken) {
  const res = await fetch('https://api.prod.whoop.com/developer' + path, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = async function handler(req, res) {
  try {
    let tokens = await kvGet('tom_whoop_tokens');
    if (!tokens) {
      return res.status(200).json({ synced: false, reason: 'not_connected' });
    }

    if (Date.now() > tokens.expires_at - 300000) {
      tokens = await refreshTokens(tokens);
      if (!tokens) {
        return res.status(200).json({ synced: false, reason: 'refresh_failed' });
      }
    }

    const at = tokens.access_token;

    // Fetch last 3 days to catch any late-scored data
    const now = new Date();
    const threeDaysAgo = new Date(now - 3 * 86400000).toISOString();

    const [recoveryRes, cycleRes, sleepRes, workoutRes, bodyRes] = await Promise.all([
      whoopGet('/v2/recovery?start=' + encodeURIComponent(threeDaysAgo) + '&end=' + encodeURIComponent(now.toISOString()) + '&limit=10', at),
      whoopGet('/v2/cycle?start=' + encodeURIComponent(threeDaysAgo) + '&end=' + encodeURIComponent(now.toISOString()) + '&limit=10', at),
      whoopGet('/v2/activity/sleep?start=' + encodeURIComponent(threeDaysAgo) + '&end=' + encodeURIComponent(now.toISOString()) + '&limit=10', at),
      whoopGet('/v2/activity/workout?start=' + encodeURIComponent(threeDaysAgo) + '&end=' + encodeURIComponent(now.toISOString()) + '&limit=10', at),
      whoopGet('/v1/user/measurement/body', at),
    ]);

    // Load existing history
    const history = await kvGet('tom_whoop_history') || {};

    const recoveries = recoveryRes?.records || [];
    const cycles = cycleRes?.records || [];
    const sleeps = (sleepRes?.records || []).filter(s => !s.nap);
    const workouts = workoutRes?.records || [];

    let daysUpdated = 0;

    // Index data by date (AEST = UTC+10)
    for (const rec of recoveries) {
      const dateUtc = new Date(rec.created_at);
      const dateAest = new Date(dateUtc.getTime() + 10 * 3600000);
      const dateKey = dateAest.toISOString().split('T')[0];

      if (!history[dateKey]) history[dateKey] = {};

      history[dateKey].recovery = {
        score: rec.score?.recovery_score,
        hrv: rec.score?.hrv_rmssd_milli,
        rhr: rec.score?.resting_heart_rate,
        spo2: rec.score?.spo2_percentage,
        skin_temp: rec.score?.skin_temp_celsius,
      };
      daysUpdated++;
    }

    for (const cycle of cycles) {
      const start = new Date(cycle.start);
      const startAest = new Date(start.getTime() + 10 * 3600000);
      const dateKey = startAest.toISOString().split('T')[0];

      if (!history[dateKey]) history[dateKey] = {};

      history[dateKey].strain = {
        score: cycle.score?.strain,
        kilojoule: cycle.score?.kilojoule,
        avg_hr: cycle.score?.average_heart_rate,
        max_hr: cycle.score?.max_heart_rate,
      };
    }

    for (const sleep of sleeps) {
      const start = new Date(sleep.start);
      const startAest = new Date(start.getTime() + 10 * 3600000);
      const dateKey = startAest.toISOString().split('T')[0];

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

    for (const w of workouts) {
      const start = new Date(w.start);
      const startAest = new Date(start.getTime() + 10 * 3600000);
      const dateKey = startAest.toISOString().split('T')[0];

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

      if (existing) {
        Object.assign(existing, entry);
      } else {
        history[dateKey].workouts.push(entry);
      }
    }

    if (bodyRes) {
      const todayKey = new Date(now.getTime() + 10 * 3600000).toISOString().split('T')[0];
      if (!history[todayKey]) history[todayKey] = {};
      history[todayKey].body = {
        weight_kg: bodyRes.weight_kilogram,
        height_m: bodyRes.height_meter,
        max_hr: bodyRes.max_heart_rate,
      };
    }

    // Save history
    await kvSet('tom_whoop_history', JSON.stringify(history));

    // Also save last sync timestamp
    const syncMeta = { last_sync: now.toISOString(), days_in_db: Object.keys(history).length, days_updated: daysUpdated };
    await kvSet('tom_whoop_sync_meta', JSON.stringify(syncMeta));

    return res.status(200).json({ synced: true, ...syncMeta });
  } catch (err) {
    console.error('Whoop sync error:', err);
    return res.status(500).json({ error: err.message });
  }
};

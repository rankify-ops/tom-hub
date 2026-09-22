// Shared KV helpers + webhook dispatch for tom-hub

function kvHeaders() {
  return {
    Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function kvUrl() {
  return process.env.KV_REST_API_URL;
}

async function kvGet(key) {
  const url = kvUrl();
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: kvHeaders(),
    body: JSON.stringify(['GET', key]),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(key, value) {
  const url = kvUrl();
  if (!url || !process.env.KV_REST_API_TOKEN) throw new Error('KV not configured');
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  await fetch(url, {
    method: 'POST',
    headers: kvHeaders(),
    body: JSON.stringify(['SET', key, raw]),
  });
}

async function kvDel(key) {
  const url = kvUrl();
  if (!url || !process.env.KV_REST_API_TOKEN) return;
  await fetch(url, {
    method: 'POST',
    headers: kvHeaders(),
    body: JSON.stringify(['DEL', key]),
  });
}

async function fireWebhook(event, payload) {
  const url = process.env.GROKBOT_WEBHOOK_URL;
  const key = process.env.GROKBOT_WEBHOOK_KEY;
  if (!url || !key) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        source: 'tom-hub',
        event,
        timestamp: new Date().toISOString(),
        ...payload,
      }),
    });
  } catch (_) {}
}

module.exports = { kvGet, kvSet, kvDel, fireWebhook };

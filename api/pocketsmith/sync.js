const PS_BASE = 'https://api.pocketsmith.com/v2';
const PS_USER = 869698;

const GROUP_MAP = {
  5554543: 'personal', 5554553: 'personal', 5554558: 'personal',
  5554563: 'personal', 5554568: 'personal', 5554573: 'personal',
  5554598: 'personal', 5554613: 'personal', 5554608: 'personal',
  5554548: 'loan',
  5554578: 'business', 5554583: 'business', 5554588: 'business',
  5554593: 'business', 5554603: 'business', 5554618: 'business',
};

const BANK_MAP = {
  2038698: 'CommBank',
  2038703: 'NAB',
};

async function psGet(path) {
  const key = process.env.POCKETSMITH_API_KEY;
  if (!key) throw new Error('POCKETSMITH_API_KEY not set');
  const res = await fetch(`${PS_BASE}${path}`, {
    headers: { 'X-Developer-Key': key, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`PocketSmith ${res.status}: ${await res.text()}`);
  return res.json();
}

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

module.exports = async function handler(req, res) {
  try {
    const rawAccts = await psGet(`/users/${PS_USER}/transaction_accounts`);
    const accounts = rawAccts.map(a => {
      const num = (a.number || '').replace(/x/g, '').slice(-4);
      let name = a.name.replace(/&amp;/g, '&');
      if (name === 'Standard Variable Rate Home Loan (Investment)') name = 'Home Loan (Investment)';
      if (name === 'Commonwealth Direct Investment Account') name = 'Direct Investment Account';
      if (name === 'SUBSCRIPTIONS & BILLS') name = 'Subscriptions & Bills';
      if (name === 'Holding account 2') name = 'Holding Account 2';
      if (name === 'Credit Card #0779') name = 'Credit Card';
      return {
        id: a.id,
        name,
        bank: BANK_MAP[a.institution?.id] || 'Unknown',
        number: num,
        balance: a.current_balance,
        group: GROUP_MAP[a.id] || 'personal',
      };
    });

    const now = new Date();
    const startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 2);
    startDate.setDate(1);
    const start = startDate.toISOString().slice(0, 10);
    const end = now.toISOString().slice(0, 10);

    const seen = new Set();
    const transactions = [];
    let page = 1;
    while (true) {
      const txns = await psGet(`/users/${PS_USER}/transactions?start_date=${start}&end_date=${end}&per_page=100&page=${page}`);
      if (!txns.length) break;
      for (const t of txns) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const acct = accounts.find(a => a.id === t.transaction_account?.id);
        const catTitle = t.category?.title || '';
        transactions.push({
          id: t.id,
          payee: t.payee || t.original_payee || '',
          date: t.date,
          amount: t.amount,
          cat: catTitle,
          acct: acct?.name || '',
          acctId: t.transaction_account?.id || 0,
          isTransfer: catTitle.toLowerCase().includes('transfer'),
        });
      }
      if (txns.length < 100) break;
      page++;
      if (page > 20) break;
    }

    transactions.sort((a, b) => b.date.localeCompare(a.date));

    await kvSet('tom_pocketsmith', JSON.stringify({
      accounts,
      transactions,
      updated: now.toISOString(),
    }));

    return res.status(200).json({
      success: true,
      accounts: accounts.length,
      transactions: transactions.length,
      synced: now.toISOString(),
    });
  } catch (err) {
    console.error('PocketSmith sync error:', err);
    return res.status(500).json({ error: err.message });
  }
};

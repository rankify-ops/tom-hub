const { requireCronOrAuth } = require('../_auth');
const PS_BASE = 'https://api.pocketsmith.com/v2';
const PS_USER = 869698;
const { pocketSmithGroup } = require('../../lib/tax');

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

const { kvGet, kvSet, fireWebhook } = require('../db');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireCronOrAuth(req, res)) return;
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
      if (name === 'American Express Platinum Card') name = 'Amex Platinum';
      const bankName = BANK_MAP[a.institution?.id] || (a.name.toLowerCase().includes('american express') ? 'Amex' : 'Unknown');
      return {
        id: a.id,
        name,
        bank: bankName,
        number: num,
        balance: a.current_balance,
        group: pocketSmithGroup(a.id),
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

    const amex = accounts.find(a => a.id === 5643758);
    if (amex) {
      const amexTotal = transactions.filter(t => t.acctId === 5643758).reduce((s, t) => s + t.amount, 0);
      amex.balance = amexTotal;
    }

    await kvSet('tom_pocketsmith', {
      accounts,
      transactions,
      updated: now.toISOString(),
    });

    let staleAlert = null;
    const amexTxns = transactions.filter(t => t.acctId === 5643758);
    if (amexTxns.length) {
      const latestAmexDate = amexTxns.reduce((m, t) => t.date > m ? t.date : m, '');
      const daysSince = Math.floor((now - new Date(latestAmexDate)) / 86400000);
      if (daysSince >= 2) {
        staleAlert = `Amex feed stale — last transaction ${latestAmexDate} (${daysSince} days ago)`;
        await fireWebhook('amex_feed_stale', {
          lastTransaction: latestAmexDate,
          daysSince,
          message: `Amex feed stale — last transaction was ${latestAmexDate} (${daysSince} days ago). Reauthorize MFA in PocketSmith → Manage → Feeds → American Express → REAUTHORIZE.`,
        });
      }
    }

    return res.status(200).json({
      success: true,
      accounts: accounts.length,
      transactions: transactions.length,
      synced: now.toISOString(),
      staleAlert,
    });
  } catch (err) {
    console.error('PocketSmith sync error:', err);
    return res.status(500).json({ error: err.message });
  }
};

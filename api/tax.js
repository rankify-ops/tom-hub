const { requireAuth } = require('./_auth');
const fs = require('fs');
const path = require('path');
const config = require('../lib/tax-config');
const { buildSummary, parseAssetRegister, summariseFeed, applyRankifyLoan } = require('../lib/tax');
const { fetchDirectorLoan } = require('../lib/rankify-loan');
const { kvGet, kvSet } = require('./db');
const LAST_LOAN_KEY = 'tom_director_loan_last';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAuth(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  try {
    const csv = fs.readFileSync(path.join(__dirname, '../data/asset-register.csv'), 'utf8');
    const assets = parseAssetRegister(csv);
    let summary = buildSummary(config, assets);
    // Director loan: live from Rankify Hub (60s cache). If Rankify Hub fails,
    // show the last good sync, clearly marked stale. Never a silent old number.
    try {
      const live = await fetchDirectorLoan();
      if (live.ok) {
        summary = applyRankifyLoan(summary, live.data, { syncedAt: live.syncedAt });
        if (!live.cached) {
          try { await kvSet(LAST_LOAN_KEY, { data: live.data, syncedAt: live.syncedAt }); } catch (_) {}
        }
      } else {
        const last = await kvGet(LAST_LOAN_KEY).catch(() => null);
        if (last && last.data) summary = applyRankifyLoan(summary, last.data, { syncedAt: last.syncedAt, stale: true });
        summary.loanSync = { ...summary.loanSync, error: live.reason + (live.status ? ' ' + live.status : '') };
      }
    } catch (_) {}
    let feed = null;
    try {
      const ps = await kvGet('tom_pocketsmith');
      if (ps && Array.isArray(ps.transactions)) {
        const cards = ps.transactions.filter(t => config.accounts.byId[t.acctId] && config.accounts.byId[t.acctId].personalCard);
        const cardTotals = summariseFeed(cards, config);
        const allTotals = summariseFeed(ps.transactions, config);
        const totals = {
          reimbursable: cardTotals.reimbursable,
          personalSpend: cardTotals.personalSpend,
          hiatusSpend: allTotals.hiatusSpend,
          otherVenture: cardTotals.otherVenture,
          excludedSpend: allTotals.excludedSpend,
          reverseReimbursement: allTotals.reverseReimbursement,
        };
        const dates = ps.transactions.map(t => t.date).filter(Boolean).sort();
        feed = {
          ...totals,
          updated: ps.updated || null,
          from: dates[0] || null,
          to: dates[dates.length - 1] || null,
          note: 'Already inside the booked loan. This is the PocketSmith feed, for checking. It is not a second claim.',
        };
      }
    } catch (_) {}
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ ...summary, feed });
  } catch (err) {
    console.error('tax error:', err);
    return res.status(500).json({ error: err.message });
  }
};

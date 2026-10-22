const { kvGet } = require('../db');
const { handleCors } = require('../_auth');

const KV_FINANCES = 'tom_finances';
const KV_COSTS = 'tom_cost_tracking';

function requireHubKey(req, res) {
  const key = process.env.HUB_SHARED_KEY;
  if (!key) { res.status(503).json({ error: 'HUB_SHARED_KEY not configured' }); return false; }
  const provided = req.headers['x-hub-key'] || '';
  if (provided !== key) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (!requireHubKey(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  try {
    const [finances, costs] = await Promise.all([
      kvGet(KV_FINANCES),
      kvGet(KV_COSTS),
    ]);

    const entries = finances?.entries || [];
    const costItems = costs?.items || [];

    const loanKeywords = ['director loan', 'director-loan', 'div 7a', 'loan'];
    const expenseKeywords = ['home office', 'licence', 'license', 'running cost', 'company expense', 'rankify expense'];

    const loanEntries = entries.filter(e => {
      const text = ((e.label || '') + ' ' + (e.category || '') + ' ' + (e.notes || '')).toLowerCase();
      return loanKeywords.some(k => text.includes(k));
    });

    const expenseEntries = entries.filter(e => {
      const text = ((e.label || '') + ' ' + (e.category || '') + ' ' + (e.notes || '')).toLowerCase();
      return expenseKeywords.some(k => text.includes(k));
    });

    const rankifyExpenses = costItems.find(c =>
      (c.name || '').toLowerCase().includes('rankify')
    );

    const loanBalance = loanEntries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({
      directorLoan: {
        balance: loanBalance,
        transactions: loanEntries.map(e => ({
          date: e.date || null,
          label: e.label || '',
          amount: parseFloat(e.amount) || 0,
          category: e.category || '',
        })),
        asAt: new Date().toISOString(),
      },
      companyExpenses: {
        entries: expenseEntries.map(e => ({
          date: e.date || null,
          label: e.label || '',
          amount: parseFloat(e.amount) || 0,
          category: e.category || '',
        })),
        rankifyMonthly: rankifyExpenses ? rankifyExpenses.monthly : null,
        rankifyAnnual: rankifyExpenses ? rankifyExpenses.annual : null,
      },
      hubSource: 'tom-hub',
      financesUpdated: finances?.updated || null,
      costsUpdated: costs?.updated || null,
    });
  } catch (err) {
    console.error('director-loan error:', err);
    return res.status(500).json({ error: err.message });
  }
};

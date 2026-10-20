const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../lib/tax-config');
const tax = require('../lib/tax');
const net = require('../lib/net-position');

// PocketSmith balances from tom-hub.vercel.app on 20 Oct 2026.
// Property median is REA $932,000 (8 Oct 2026) and CommBank $962,000 (31 Aug 2026).
const accounts = [
  { id: 5554543, balance: 3524.2, group: 'personal', number: '2490', name: 'Everyday Offset' },
  { id: 5554548, balance: -911252.88, group: 'loan', number: '0237', name: 'Home Loan (Investment)' },
  { id: 5554553, balance: 0, group: 'personal', number: '5481', name: 'Everyday Offset' },
  { id: 5554558, balance: 0.01, group: 'personal', number: '6535', name: 'Direct Investment Account' },
  { id: 5554563, balance: 0.7, group: 'personal', number: '6633', name: 'Every Day' },
  { id: 5554568, balance: 3.58, group: 'personal', number: '1692', name: 'Subscriptions & Bills' },
  { id: 5554573, balance: 1.87, group: 'personal', number: '7398', name: 'Holding Account' },
  { id: 5554578, balance: 7313.43, group: 'business', number: '3314', name: 'RANKIFY INCOME' },
  { id: 5554583, balance: 0, group: 'business', number: '3283', name: 'RANKIFY TAX' },
  { id: 5554588, balance: 0.48, group: 'business', number: '4750', name: 'RANKIFY' },
  { id: 5554593, balance: 0, group: 'business', number: '2179', name: 'RANKIFY EXPENSES' },
  { id: 5554598, balance: 0.43, group: 'personal', number: '0011', name: 'Holding Account 2' },
  { id: 5554603, balance: -0.29, group: 'business', number: '5327', name: 'Hiatus Transactional' },
  { id: 5554608, balance: -601, group: 'personal', number: '0779', name: 'Credit Card' },
  { id: 5554613, balance: 0.01, group: 'personal', number: '3336', name: 'Income' },
  { id: 5554618, balance: 0, group: 'business', number: '9471', name: 'Hiatus Savings' },
  { id: 5643758, balance: -1988.9399999999962, group: 'personal', number: '1003', name: 'Amex Platinum' },
];
const propertyValue = 947000;
const summary = tax.buildSummary(config);
const costItems = [{ name: 'AMEX Balance', monthly: 1998.94, status: 'active' }];

function groupOf(account) {
  const meta = config.accounts.byId[account.id];
  return meta ? meta.group : (account.group || 'personal');
}

function previousNetPosition(rows, fullProperty) {
  const personalCash = rows.filter(a => groupOf(a) === 'personal' && a.balance >= 0);
  const biz = rows.filter(a => ['rankify', 'hiatus', 'excluded'].includes(groupOf(a)));
  const loans = rows.filter(a => groupOf(a) === 'loan');
  const cards = rows.filter(a => groupOf(a) === 'personal' && a.balance < 0);
  const totalCash = personalCash.reduce((s, a) => s + a.balance, 0) + biz.reduce((s, a) => s + a.balance, 0);
  const ccDebt = cards.reduce((s, a) => s + Math.abs(a.balance), 0);
  const homeLoanShare = Math.round(loans.reduce((s, a) => s + Math.abs(a.balance), 0) / 2 * 100) / 100;
  const propShare = Math.round(fullProperty / 2 * 100) / 100;
  const totalAssets = totalCash + propShare + 22000;
  const totalDebts = ccDebt + homeLoanShare + 18133.93 + 1000 + 4000;
  return totalAssets - totalDebts;
}

function position(extra) {
  return net.personalNetPosition(Object.assign({
    accounts,
    groupOf,
    propertyValue,
    taxSummary: summary,
    costItems,
  }, extra));
}

test('live balances: net position was $24,994.11 and is now $13,838.41', () => {
  const before = previousNetPosition(accounts, propertyValue);
  assert.equal(before.toFixed(2), '24994.11');

  const after = position();
  assert.equal(after.cash, 3530.80);
  assert.equal(after.cardDebt, 2589.94);
  assert.equal(after.amex.owing, 1988.94);
  assert.equal(after.amex.source, 'bank-feed');
  assert.equal(after.amexCostIgnored, 1998.94);
  assert.equal(after.carLoan.owing, 17582.10);
  assert.equal(after.carLoan.note, 'Taurus payout, 6 Oct 2026');
  assert.equal(after.carLoan.paymentsLeft, 32);
  assert.equal(after.oweToDom, 1000);
  assert.equal(after.directorLoan.debt, 4393.91);
  assert.equal(after.directorLoan.bookedSigned, -4393.91);
  assert.equal(after.directorLoan.asset, 0);
  assert.equal(after.fy26Tax.debt, 4000);
  assert.equal(after.fy26Tax.label, 'FY26 tax (estimate, unconfirmed)');
  assert.equal(after.propertyShare, 473500);
  assert.equal(after.homeLoanShare, 455626.44);
  assert.equal(after.totalAssets, 499030.80);
  assert.equal(after.totalDebts, 485192.39);
  assert.equal(after.net, 13838.41);
  assert.equal((before - after.net).toFixed(2), '11155.70');
});

test('cash leaves out Rankify 3314, Hiatus, and the other non-personal accounts', () => {
  const after = position();
  const numbers = after.cashAccounts.map(a => a.number);
  assert.deepEqual(numbers, ['2490', '6535', '6633', '1692', '7398', '0011', '3336']);
  const leftOut = after.leftOut.map(a => a.number).sort();
  assert.deepEqual(leftOut, ['2179', '3283', '3314', '4750', '5327', '9471']);
  assert.equal(after.leftOut.some(a => a.number === '3314' && a.balance === 7313.43), true);
  assert.equal(after.cards.map(row => row.account.number).sort().join(','), '0779,1003');
});

test('the raw PocketSmith business group is left out even without a tax-config remap', () => {
  const remapped = position();
  const raw = net.personalNetPosition({
    accounts,
    propertyValue,
    taxSummary: summary,
    costItems,
  });
  assert.equal(raw.net, remapped.net);
  assert.equal(raw.cash, 3530.80);
  assert.equal(raw.leftOut.length, 6);
});

test('director loan debt is the booked figure, not the proposed balance', () => {
  const after = position();
  assert.equal(summary.directorLoan.withProposedSigned, -1413.46);
  assert.equal(after.directorLoan.debt, 4393.91);
  assert.notEqual(after.directorLoan.debt, 1413.46);

  const proposedAsBooked = JSON.parse(JSON.stringify(summary));
  proposedAsBooked.directorLoan.bookedSigned = -1413.46;
  const wrong = position({ taxSummary: proposedAsBooked });
  assert.equal(wrong.directorLoan.debt, 1413.46);

  const rankifyOwes = JSON.parse(JSON.stringify(summary));
  rankifyOwes.directorLoan.bookedSigned = 250;
  const asset = position({ taxSummary: rankifyOwes });
  assert.equal(asset.directorLoan.debt, 0);
  assert.equal(asset.directorLoan.asset, 250);
  assert.equal(asset.net, 18482.32);
});

test('FY26 tax stays the unconfirmed $4,000 and ignores a tax-summary debt', () => {
  const base = position();
  assert.equal(base.fy26Tax.debt, 4000);
  assert.equal(base.fy26Tax.label, 'FY26 tax (estimate, unconfirmed)');

  const withFigure = JSON.parse(JSON.stringify(summary));
  withFigure.fy26Debt = 9999;
  withFigure.fy26 = { atoOwing: 2500 };
  withFigure.ato = { owing: 80 };
  const ignored = position({ taxSummary: withFigure });
  assert.equal(ignored.fy26Tax.debt, 4000);
  assert.equal(ignored.net, base.net);
});

test('a missing Amex feed is not filled in from the $1,998.94 cost line', () => {
  const noAmex = accounts.filter(a => a.id !== 5643758);
  const after = position({ accounts: noAmex });
  assert.equal(after.amex.owing, null);
  assert.equal(after.amexCostIgnored, 1998.94);
  assert.equal(after.cardDebt, 601);
  assert.equal(after.cards.length, 1);
});

test('the Net Position card uses the shared function and drops the old hard-coded debts', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.equal(html.includes('18133.93'), false);
  assert.equal(html.includes('2025 Tax Bill'), false);
  assert.equal(html.includes('taxBill2025'), false);
  assert.match(html, /TomNet\.personalNetPosition/);
  assert.match(html, /np\.fy26Tax\.label/);
  assert.equal(html.includes('FY26 ATO owing is pending'), false);
  assert.equal(html.includes('fy26Debt'), false);
  assert.match(html, /Personal accounts only/);
  assert.match(html, /bank feed/);
  const src = fs.readFileSync(path.join(__dirname, '../lib/net-position.js'), 'utf8');
  assert.match(src, /FY26 tax \(estimate, unconfirmed\)/);
  assert.equal(src.includes('fy26Debt'), false);
  assert.equal(src.includes('atoOwing'), false);
  assert.equal(src.includes('x-hub-key'), false);
  assert.equal(src.includes('HUB_SHARED_KEY'), false);
  assert.equal(src.includes('api/shared/director-loan'), false);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../lib/tax-config');
const tax = require('../lib/tax');

const assets = tax.parseAssetRegister(
  fs.readFileSync(path.join(__dirname, '../data/asset-register.csv'), 'utf8')
);
const summary = tax.buildSummary(config, assets);

test('booked director loan: Tom owes Rankify $4,393.91', () => {
  const loan = summary.directorLoan;
  assert.equal(loan.tomOwes, true);
  assert.equal(loan.bookedSigned, -4393.91);
  assert.equal(loan.bookedAbs, 4393.91);
  assert.equal(loan.headline, 'Tom owes Rankify $4,393.91');
  assert.equal(loan.netPaidToTom, 14384.27);
  assert.equal(loan.expensesTomPaid, 9990.36);
  assert.equal(loan.reverseReimbursement, 2447.73);
  assert.deepEqual(loan.ptyAccountNumbers, ['3314', '2179']);
  assert.equal(loan.excludedAccountNumber, '4750');
});

test('proposed items bring the loan to about $1,413', () => {
  const loan = summary.directorLoan;
  assert.equal(loan.proposed.gearSale, 2875);
  assert.equal(loan.proposed.licenceDays, 11);
  assert.equal(loan.proposed.licenceFee, 132);
  assert.equal(loan.proposed.phoneInternetPersonal, 26.55);
  assert.equal(loan.withProposedSigned, -1413.46);
  assert.equal(loan.withProposedAbs, 1413.46);
  assert.equal(loan.proposedHeadline, 'Tom owes Rankify $1,413.46');
  assert.equal(summary.loanSync.live, false);
  assert.match(summary.loanSync.label, /^Not live: Rankify Hub did not answer\. This is the 20 Oct 2026 snapshot/);
});

test('Div 7A estimate uses 39% and the 8.77% benchmark', () => {
  assert.equal(summary.div7a.combined, 0.39);
  assert.equal(summary.div7a.incomeTax, 0.37);
  assert.equal(summary.div7a.medicare, 0.02);
  assert.equal(summary.div7a.benchmarkRate, 0.0877);
  assert.equal(summary.div7a.estimate, true);
  assert.equal(summary.div7a.booked.debit, 4393.91);
  assert.equal(summary.div7a.booked.tax, 1713.62);
  assert.equal(summary.div7a.booked.interest, 385.35);
  assert.equal(summary.div7a.proposed.debit, 1413.46);
  assert.equal(summary.div7a.proposed.tax, 551.25);
  assert.equal(summary.div7a.proposed.interest, 123.96);
});

test('FY27 licence fee, matching rent, and a nil running-cost claim', () => {
  const fee = summary.fy27.licence;
  assert.equal(fee.weeklyExact, 83.95);
  assert.equal(fee.weeklyAbout, 84);
  assert.equal(fee.daysFromStart, 264);
  assert.equal(fee.daysAdopted, 254);
  assert.equal(fee.incomeFromStart, 3166.11);
  assert.equal(fee.incomeAdopted, 3046.19);
  assert.equal(summary.fy27.rentDeduction, 3046.19);
  assert.equal(summary.fy27.runningCosts, 0);
  assert.equal(summary.fy27.start, '2026-07-01');
  assert.equal(summary.fy27.end, '2027-06-30');
  assert.equal(summary.fy27.returnDue, '2027-10-31');
});

test('option B gear sale rounds to $2,875 and Tom claims no FY27 decline', () => {
  assert.equal(summary.assets.includedCount, 15);
  assert.equal(summary.assets.excludedCount, 5);
  assert.equal(summary.assets.marketValue, 2875.08);
  assert.equal(summary.assets.saleProceedsRounded, 2875);
  assert.equal(summary.assets.optionBPersonalDeduction, 0);
  assert.equal(summary.fy27.depreciation, 0);
  assert.equal(summary.assets.optionADecline, 985.78);
  assert.equal(config.directorLoan.proposed.gearSale, summary.assets.saleProceedsRounded);
});

test('car reimbursement is 91c/km up to 5,000 km and is empty without a trip log', () => {
  assert.equal(summary.car.loggedKm, 0);
  assert.equal(summary.car.reimbursement, 0);
  assert.equal(summary.car.ratePerKm, 0.91);
  assert.equal(summary.car.capKm, 5000);
  assert.equal(summary.car.maxReimbursement, 4550);
  const atCap = tax.carPosition(config, 5000);
  assert.equal(atCap.reimbursement, 4550);
  const over = tax.carPosition(config, 6200);
  assert.equal(over.countedKm, 5000);
  assert.equal(over.reimbursement, 4550);
  assert.equal(over.overCap, true);
});

test('Rankify costs on personal cards are reimbursable and stay out of personal spend', () => {
  const semrush = tax.classifyTransaction(
    { acctId: 5643758, payee: 'SEMRUSH INC BOSTON', amount: -322.92, isTransfer: false },
    config
  );
  assert.equal(semrush.tag, 'Rankify, reimbursable');
  assert.equal(semrush.personalAmount, 0);
  assert.equal(semrush.reimbursableAmount, 322.92);

  const vercel = tax.classifyTransaction(
    { acctId: 5554608, payee: 'VERCEL INC. VERCEL.COM CA', amount: -61.94 },
    config
  );
  assert.equal(vercel.tag, 'Rankify, reimbursable');
  assert.equal(vercel.personalAmount, 0);

  const vodafone = tax.classifyTransaction(
    { acctId: 5643758, payee: 'VODAFONE *AUSTRALIA NORTH SYDNEY', amount: -80.52 },
    config
  );
  assert.equal(vodafone.tag, 'Rankify, reimbursable');
  assert.equal(vodafone.reimbursableAmount, 72.47);
  assert.equal(vodafone.personalAmount, 8.05);

  const coles = tax.classifyTransaction(
    { acctId: 5643758, payee: 'COLES MIAMI 4583 MIAMI', amount: -20 },
    config
  );
  assert.equal(coles.tag, '');
  assert.equal(coles.personalAmount, 20);
});

test('Hiatus, ITM, NAB 4750 and GreenEdge stay out of personal spend and the Pty Ltd loan', () => {
  const hiatus = tax.classifyTransaction(
    { acctId: 5554603, payee: 'Alibaba.com', amount: -495.37 },
    config
  );
  assert.equal(hiatus.entity, 'hiatus');
  assert.equal(hiatus.tag, 'Hiatus');
  assert.equal(hiatus.personalAmount, 0);
  assert.equal(hiatus.reimbursableAmount, 0);

  const itm = tax.classifyTransaction(
    { acctId: 5554613, payee: 'ITM Wages', amount: 2474.54 },
    config
  );
  assert.equal(itm.entity, 'itm');
  assert.equal(itm.tag, 'ITM');
  assert.equal(itm.personalAmount, 0);

  const nab4750 = tax.classifyTransaction(
    { acctId: 5554588, payee: 'SML ATM QUICKSTOP', amount: -350 },
    config
  );
  assert.equal(nab4750.entity, 'not_pty');
  assert.equal(nab4750.tag, 'Not Rankify Pty Ltd');
  assert.equal(nab4750.personalAmount, 0);
  assert.equal(config.accounts.byId[5554588].pty, false);
  assert.equal(config.accounts.byId[5554578].pty, true);
  assert.equal(config.accounts.byId[5554593].pty, true);

  const greenedge = tax.classifyTransaction(
    { acctId: 5554608, payee: 'Microsoft*Microsoft 365 Pmsbill.info', amount: -16 },
    config
  );
  assert.equal(greenedge.entity, 'other');
  assert.equal(greenedge.tag, 'Other venture');
  assert.equal(greenedge.personalAmount, 0);
  assert.equal(greenedge.reimbursableAmount, 0);

  const loanInterest = tax.classifyTransaction(
    { acctId: 5554548, payee: 'Interest charged', amount: -4927.51 },
    config
  );
  assert.equal(loanInterest.entity, 'loan');
  assert.equal(loanInterest.personalAmount, 0);

  const reverse = tax.classifyTransaction(
    { acctId: 5554578, payee: 'ONLINE G0301662332 Linked Acc Trns FLOOD TA', amount: 2447.73 },
    config
  );
  assert.equal(reverse.tag, 'Reverse reimbursement');
});

test('subscription rows for Rankify, phone and internet are not full personal spend', () => {
  const rankify = tax.costItemSplit({ name: 'Rankify Expenses' }, config);
  assert.equal(rankify.personalShare, 0);
  assert.equal(rankify.tag, 'Planning only');

  const phone = tax.costItemSplit({ name: 'Vodafone Plan' }, config);
  assert.equal(phone.personalShare, 0.1);
  assert.equal(phone.tag, 'Rankify, reimbursable');

  const internet = tax.costItemSplit({ name: 'Internet (50%)' }, config);
  assert.equal(internet.personalShare, 0.1);
  assert.equal(internet.tag, 'Rankify, reimbursable');

  const rent = tax.costItemSplit({ name: 'Rent - New Place' }, config);
  assert.equal(rent.personalShare, 1);
  assert.equal(rent.tag, '');
});

test('feed totals keep reimbursable, Hiatus and 4750 out of personal spend', () => {
  const totals = tax.summariseFeed([
    { acctId: 5643758, payee: 'SEMRUSH INC', amount: -100 },
    { acctId: 5643758, payee: 'COLES', amount: -40 },
    { acctId: 5643758, payee: 'VODAFONE AUSTRALIA', amount: -10 },
    { acctId: 5554603, payee: 'Xero', amount: -37 },
    { acctId: 5554588, payee: 'ATM', amount: -350 },
    { acctId: 5554613, payee: 'ITM Wages', amount: 2000 },
  ], config);
  assert.equal(totals.reimbursable, 109);
  assert.equal(totals.personalSpend, 41);
  assert.equal(totals.hiatusSpend, 37);
  assert.equal(totals.excludedSpend, 350);
});

test('FY27 estimate: about a $204 refund before Div 7A', () => {
  const fe = summary.fy27Estimate;
  assert.equal(fe.paygProjected, 51324);
  assert.equal(fe.liability, 51120);
  assert.equal(fe.mls, 0);
  assert.equal(fe.helpDebt, 0);
  assert.equal(fe.refund, 204);
  assert.equal(fe.ifDeemedDividendSigned, -1509.62);
  assert.equal(summary.shareholderPct, 1);
});

test('prior-year ATO debt mirrors Net Position $4,000, no due date or plan', () => {
  const pd = summary.priorYearTaxDebt;
  assert.equal(pd.amount, 4000);
  assert.equal(pd.dueDate, null);
  assert.equal(pd.paymentPlan, null);
});

test('fy26Debt is exposed for Net Position and marked unconfirmed', () => {
  assert.equal(summary.fy26Debt.amount, 4000);
  assert.equal(summary.fy26Debt.confirmed, false);
  assert.equal(summary.fy26Debt.dueDate, null);
  assert.equal(summary.fy26Debt.paymentPlan, null);
});

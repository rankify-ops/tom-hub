const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../lib/tax-config');
const tax = require('../lib/tax');
const {
  BOOKS_URL,
  LOAN_URL,
  fromBooks,
  normalizeDirectorLoan,
  fetchDirectorLoan,
  resetDirectorLoanCache,
} = require('../lib/rankify-loan');

const assets = tax.parseAssetRegister(
  fs.readFileSync(path.join(__dirname, '../data/asset-register.csv'), 'utf8')
);

const sample = {
  asOf: '2026-10-21',
  booked: -10,
  withProposed: 25,
  costsTomPaid: 9990.36,
  netPaidToTom: 14384.27,
  reverseReimbursement: 2447.73,
  proposed: {
    gearSale: 3000,
    licenceFee: 200,
    licenceDays: 12,
    phoneInternetPersonal: 30,
  },
  companyTaxEstimate: { tax: 4200, explain: '25% of taxable profit.' },
  div7aEstimate: {
    debit: 10,
    tax: 3,
    interest: 1,
    proposedTax: 0,
    proposedInterest: 0,
    proposedDebit: 0,
    minimumYearly: 2.5,
    benchmarkRate: 0.0877,
    combined: 0.39,
  },
  reconciled: true,
  bankBalances: { '3314': 1200.5, '2179': -40, total: 1160.5 },
  configVersion: 'fy27-1',
};

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('normalize keeps the shared feed figures and does not recompute them', () => {
  const normalized = normalizeDirectorLoan(sample);
  assert.equal(normalized.asOf, '2026-10-21');
  assert.equal(normalized.booked, -10);
  assert.equal(normalized.withProposed, 25);
  assert.equal(normalized.costsTomPaid, 9990.36);
  assert.equal(normalized.netPaidToTom, 14384.27);
  assert.equal(normalized.reverseReimbursement, 2447.73);
  assert.equal(normalized.proposed.gearSale, 3000);
  assert.equal(normalized.div7a.tax, 3);
  assert.equal(normalized.div7a.minimumYearly, 2.5);
  assert.equal(normalized.div7a.benchmarkRate, 0.0877);
  assert.equal(normalized.companyTax.tax, 4200);
  assert.equal(normalized.reconciliation.reconciled, true);
  assert.equal(normalized.bankBalances.find(row => row.number === '3314').balance, 1200.5);
  assert.equal(normalized.bankBalances.find(row => row.total).balance, 1160.5);
  assert.equal(normalized.configVersion, 'fy27-1');
});

test('Rankify-style names and a proposed list still normalize', () => {
  const normalized = normalizeDirectorLoan({
    asOf: '2026-10-21T00:00:00.000Z',
    bookedSigned: -50,
    balanceWithProposed: -12.5,
    expensesTomPaid: 80,
    netPaid: 100,
    reverseReimbursement: 5,
    proposed: [
      { name: 'Gear sale', amount: 40 },
      { label: 'Licence fee', amount: 8 },
    ],
    div7a: { incomeTax: 19.5, minimumYearly: 8, interest: 4.2 },
    companyTaxEstimate: 900,
    reconciled: { reconciled: false, headline: 'Off by $2.00', difference: -2 },
    configVersion: 4,
  });
  assert.equal(normalized.booked, -50);
  assert.equal(normalized.withProposed, -12.5);
  assert.equal(normalized.costsTomPaid, 80);
  assert.equal(normalized.netPaidToTom, 100);
  assert.equal(normalized.div7a.tax, 19.5);
  assert.equal(normalized.div7a.interest, 4.2);
  assert.equal(normalized.companyTax.tax, 900);
  assert.equal(normalized.reconciliation.reconciled, false);
  assert.equal(normalized.proposed.items.length, 2);
  assert.equal(normalized.proposed.items[0].label, 'Gear sale');
});

test('a feed without Div 7A or a date is rejected so local figures cannot mix in', () => {
  assert.equal(normalizeDirectorLoan(null), null);
  assert.equal(normalizeDirectorLoan({ booked: -1, withProposed: -1, asOf: '2026-10-21' }), null);
  assert.equal(normalizeDirectorLoan({
    asOf: '2026-10-21',
    booked: -1,
    div7aEstimate: { tax: 1 },
  }), null);
  assert.equal(normalizeDirectorLoan({
    asOf: 'not-a-date',
    booked: -1,
    withProposed: -1,
    div7aEstimate: { tax: 1 },
  }), null);
});

test('applying the feed replaces headlines and Div 7A without recomputing tax', () => {
  const summary = tax.buildSummary(config, assets);
  const normalized = normalizeDirectorLoan(sample);
  const live = tax.applyRankifyLoan(summary, normalized);
  assert.equal(summary.loanSync.live, false);
  assert.equal(summary.directorLoan.bookedSigned, -4393.91);
  assert.equal(summary.div7a.booked.tax, 1713.62);
  assert.equal(live.loanSync.live, true);
  assert.equal(live.loanSync.label, 'Live from Rankify Hub');
  assert.equal(live.loanSync.configVersion, 'fy27-1');
  assert.equal(live.directorLoan.bookedSigned, -10);
  assert.equal(live.directorLoan.headline, 'Tom owes Rankify $10.00');
  assert.equal(live.directorLoan.withProposedSigned, 25);
  assert.equal(live.directorLoan.proposedHeadline, 'Rankify owes Tom $25.00');
  assert.equal(live.directorLoan.proposed.gearSale, 3000);
  assert.equal(live.div7a.booked.tax, 3);
  assert.equal(live.div7a.booked.interest, 1);
  assert.equal(live.fy26Debt.amount, 4000);
  assert.equal(live.fy26Debt.confirmed, false);
  assert.equal(summary.fy27Estimate.ifDeemedDividendSigned, -1509.62);
  assert.equal(live.fy27Estimate.ifDeemedDividendSigned, 201);
  assert.notEqual(live.fy27Estimate.ifDeemedDividendSigned, tax.round2(204 - 10 * 0.39));
  assert.equal(live.div7a.minimumYearly, 2.5);
  assert.notEqual(live.div7a.booked.tax, tax.round2(10 * 0.39));
  assert.equal(live.companyTax.tax, 4200);
  assert.equal(JSON.stringify(live).includes('HUB_SHARED_KEY'), false);
});

test('fetch sends the hub key, caches briefly, and never returns the key', async () => {
  const calls = [];
  const secret = 'super-secret-hub-key';
  const cache = { at: 0, key: '', data: null };
  let now = 1000000;
  const fetchImpl = async (url, opts) => {
    if (url === BOOKS_URL) return { ok: false, status: 404, json: async () => ({}) };
    calls.push({ url, key: opts.headers['x-hub-key'], redirect: opts.redirect });
    return { ok: true, status: 200, json: async () => sample };
  };
  const env = { HUB_SHARED_KEY: secret };
  const first = await fetchDirectorLoan({ env, fetchImpl, cache, now: () => now });
  const second = await fetchDirectorLoan({ env, fetchImpl, cache, now: () => now + 1000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, LOAN_URL);
  assert.equal(calls[0].key, secret);
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.data.booked, -10);
  assert.equal(JSON.stringify(first).includes(secret), false);
  assert.equal(JSON.stringify(second).includes(secret), false);
  now += 61000;
  await fetchDirectorLoan({ env, fetchImpl, cache, now: () => now });
  assert.equal(calls.length, 2);
});

test('missing key, errors, redirects, and invalid JSON do not become a live loan', async () => {
  const secret = 'another-secret';
  const missing = await fetchDirectorLoan({
    env: {},
    cache: { at: 0, key: '', data: null },
    fetchImpl: async () => { throw new Error('should not run'); },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'unconfigured');

  const down = await fetchDirectorLoan({
    env: { HUB_SHARED_KEY: secret },
    cache: { at: 0, key: '', data: null },
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ booked: -1 }) }),
  });
  assert.equal(down.ok, false);
  assert.equal(down.reason, 'http');
  assert.equal(JSON.stringify(down).includes(secret), false);

  const redirected = await fetchDirectorLoan({
    env: { HUB_SHARED_KEY: secret },
    cache: { at: 0, key: '', data: null },
    fetchImpl: async () => ({ ok: false, status: 302, json: async () => sample }),
  });
  assert.equal(redirected.ok, false);
  assert.equal(redirected.reason, 'redirect');

  const invalid = await fetchDirectorLoan({
    env: { HUB_SHARED_KEY: secret },
    cache: { at: 0, key: '', data: null },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ booked: -1, withProposed: -1 }) }),
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid');

  const threw = await fetchDirectorLoan({
    env: { HUB_SHARED_KEY: secret },
    cache: { at: 0, key: '', data: null },
    fetchImpl: async () => { throw new Error('network'); },
  });
  assert.equal(threw.ok, false);
  assert.equal(threw.reason, 'error');
});

process.env.ROUTINE_SECRET = process.env.ROUTINE_SECRET || 'test-bot-key';
test('the tax API uses a mocked feed, then the dated fallback, and never leaks the key', async () => {
  const handler = require('../api/tax');
  const secret = 'do-not-leak-this-key';
  const previousKey = process.env.HUB_SHARED_KEY;
  const previousFetch = global.fetch;
  const previousKvUrl = process.env.KV_REST_API_URL;
  const previousKvToken = process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  process.env.HUB_SHARED_KEY = secret;
  resetDirectorLoanCache();

  global.fetch = async (url, opts) => {
    if (url === BOOKS_URL) return { ok: false, status: 404, json: async () => ({}) };
    assert.equal(url, LOAN_URL);
    assert.equal(opts.headers['x-hub-key'], secret);
    return {
      ok: true,
      status: 200,
      json: async () => sample,
    };
  };
  const live = mockRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer test-bot-key' } }, live);
  assert.equal(live.statusCode, 200);
  assert.equal(live.headers['Cache-Control'], 'private, no-store');
  assert.equal(live.body.loanSync.live, true);
  assert.match(live.body.loanSync.label, /^Live from Rankify Hub · synced \d+ \w+ \d{4}, \d+:\d\d [ap]m AEST$/);
  assert.equal(live.body.directorLoan.bookedSigned, -10);
  assert.equal(live.body.directorLoan.headline, 'Tom owes Rankify $10.00');
  assert.equal(live.body.div7a.booked.tax, 3);
  assert.equal(live.body.companyTax.tax, 4200);
  assert.equal(JSON.stringify(live.body).includes(secret), false);
  assert.equal(JSON.stringify(live.headers).includes(secret), false);

  resetDirectorLoanCache();
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const fallback = mockRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer test-bot-key' } }, fallback);
  assert.equal(fallback.body.loanSync.live, false);
  assert.equal(fallback.body.loanSync.stale, true);
  assert.match(fallback.body.loanSync.label, /^Not live: Rankify Hub did not answer\. This is the 20 Oct 2026 snapshot/);
  assert.equal(fallback.body.directorLoan.bookedSigned, -4393.91);
  assert.equal(fallback.body.div7a.booked.tax, 1713.62);
  assert.equal(fallback.body.companyTax, null);
  assert.equal(JSON.stringify(fallback.body).includes(secret), false);

  if (previousKey == null) delete process.env.HUB_SHARED_KEY;
  else process.env.HUB_SHARED_KEY = previousKey;
  if (previousKvUrl == null) delete process.env.KV_REST_API_URL;
  else process.env.KV_REST_API_URL = previousKvUrl;
  if (previousKvToken == null) delete process.env.KV_REST_API_TOKEN;
  else process.env.KV_REST_API_TOKEN = previousKvToken;
  global.fetch = previousFetch;
  resetDirectorLoanCache();
});

test('browser files never mention the shared key or the Rankify loan URL', () => {
  const files = ['index.html', 'lib/tax.js', 'lib/tax-config.js', 'lib/net-position.js'];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.equal(src.includes('x-hub-key'), false, file);
    assert.equal(src.includes('HUB_SHARED_KEY'), false, file);
    assert.equal(src.includes('api/shared/director-loan'), false, file);
  }
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const nav = html.slice(html.indexOf('<nav class="sidebar-nav">'), html.indexOf('</nav>'));
  const labels = [...nav.matchAll(/<span>([^<]+)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(labels.slice(0, 3), ['Overview', 'Money', 'Tax']);
  assert.ok(labels.indexOf('Training & Recovery') > labels.indexOf('Tax'));
  assert.ok(labels.includes('Checklists') && labels.includes('Notes') && labels.includes('Goals'));
  assert.ok(labels.includes('Investment Properties') && labels.includes('Licenses & Certs'));
  assert.match(html, /Matches Rankify Hub/);
  assert.match(html, /loan-sync/);
  assert.match(html, /Hiatus and ITM stay separate/);
});

const books = {
  asOf: '2026-10-28',
  tax: {
    loan: { booked: -1881.42, withProposed: 1186.92, expensesTomPaid: 12502.85, reimbursements: 16832, reverseReimbursements: 2447.73, netPaidToTom: 14384.27 },
    div7a: {
      booked: { debit: 1881.42, personalTax: 733.75, annualInterest: 165, personalRate: 0.39, benchmarkRate: 0.0877 },
      withProposed: { debit: 0, personalTax: 0, annualInterest: 0, personalRate: 0.39, benchmarkRate: 0.0877 },
    },
    proposed: [{ date: '2026-10-20', description: 'Gear sale', amount: 2875 }],
    ledger: [{ description: 'Client Pty Ltd invoice', amount: 999 }],
  },
  reconciliation: { status: 'reconciled', outBy: 0, accounts: [{ number: '3314' }] },
};

test('Rankify Hub books are read with a bearer key and only the loan summary crosses', async () => {
  const calls = [];
  const cache = { at: 0, key: '', data: null };
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.authorization });
    if (opts.headers.authorization === 'Bearer wrong') return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => books };
  };
  const r = await fetchDirectorLoan({ env: { CRM_ADMIN_API_KEY: 'wrong', HUB_SHARED_KEY: 'right' }, fetchImpl, cache, now: () => 5000 });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, BOOKS_URL);
  assert.equal(r.data.booked, -1881.42);
  assert.equal(r.data.withProposed, 1186.92);
  assert.equal(r.data.costsTomPaid, 12502.85);
  assert.equal(r.data.div7a.tax, 733.75);
  assert.equal(r.data.reconciliation.reconciled, true);
  assert.equal(JSON.stringify(r).includes('Client Pty Ltd'), false);
  assert.equal(JSON.stringify(r).includes('right'), false);
  const summary = tax.applyRankifyLoan(tax.buildSummary(config, assets), r.data, { syncedAt: r.syncedAt });
  assert.equal(summary.directorLoan.headline, 'Tom owes Rankify $1,881.42');
  assert.equal(summary.loanSync.live, true);
  const stale = tax.applyRankifyLoan(tax.buildSummary(config, assets), r.data, { syncedAt: '2026-10-28T07:00:00Z', stale: true });
  assert.equal(stale.loanSync.live, false);
  assert.equal(stale.loanSync.label, 'Not live: Rankify Hub did not answer. Showing the last sync from 28 Oct 2026, 5:00 pm AEST');
});

test('cache is never longer than 5 minutes', async () => {
  let n = 0;
  const cache = { at: 0, key: '', data: null };
  const fetchImpl = async () => { n++; return { ok: true, status: 200, json: async () => books }; };
  await fetchDirectorLoan({ env: { HUB_SHARED_KEY: 'k' }, fetchImpl, cache, now: () => 0, ttlMs: 3600000 });
  await fetchDirectorLoan({ env: { HUB_SHARED_KEY: 'k' }, fetchImpl, cache, now: () => 300001, ttlMs: 3600000 });
  assert.equal(n, 2);
});

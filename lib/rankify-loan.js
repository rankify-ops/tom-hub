// Server-only client for Rankify Hub's director loan.
// HUB_SHARED_KEY is read from the environment at request time and is never
// returned, logged, or written into a response.
const { round2 } = require('./tax');

const LOAN_URL = 'https://rankify-crm.vercel.app/api/shared/director-loan';
const CACHE_MS = 60 * 1000;
const defaultCache = { at: 0, key: '', data: null };

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function money(value) {
  const n = asNumber(value);
  return n == null ? null : round2(n);
}

function asDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
  return match ? match[1] : null;
}

function readDiv7a(raw) {
  const source = raw.div7aEstimate || raw.div7a;
  if (!source || typeof source !== 'object') return null;
  const booked = source.booked && typeof source.booked === 'object' ? source.booked : source;
  const proposed = source.proposed && typeof source.proposed === 'object' ? source.proposed : null;
  let tax = money(booked.tax);
  if (tax == null) tax = money(source.tax);
  if (tax == null) {
    const incomeTax = asNumber(source.incomeTax);
    if (incomeTax != null && Math.abs(incomeTax) > 1) tax = round2(incomeTax);
  }
  if (tax == null) return null;
  let proposedTax = proposed ? money(proposed.tax) : money(source.proposedTax);
  if (proposedTax == null && proposed) {
    const proposedIncome = asNumber(proposed.incomeTax);
    if (proposedIncome != null && Math.abs(proposedIncome) > 1) proposedTax = round2(proposedIncome);
  }
  const rawRate = source.incomeTaxRate != null
    ? source.incomeTaxRate
    : (asNumber(source.incomeTax) != null && Math.abs(asNumber(source.incomeTax)) <= 1 ? source.incomeTax : null);
  return {
    tax,
    interest: money(booked.interest != null ? booked.interest : source.interest),
    debit: money(booked.debit != null ? booked.debit : source.debit),
    proposedTax,
    proposedInterest: proposed ? money(proposed.interest) : money(source.proposedInterest),
    proposedDebit: proposed ? money(proposed.debit) : money(source.proposedDebit),
    minimumYearly: money(source.minimumYearly != null ? source.minimumYearly : source.minimumYearlyRepayment),
    benchmarkRate: asNumber(source.benchmarkRate),
    combined: asNumber(source.combined),
    incomeTaxRate: asNumber(rawRate),
    medicare: asNumber(source.medicare),
    explain: typeof source.explain === 'string' ? source.explain : '',
  };
}

function readProposed(raw) {
  const proposed = raw.proposed;
  if (!proposed) return null;
  if (Array.isArray(proposed)) {
    const items = proposed.map(item => ({
      label: String((item && (item.label || item.name || item.description)) || 'Proposed'),
      amount: money(item && (item.amount != null ? item.amount : item.value)),
    })).filter(item => item.amount != null);
    return items.length ? { items } : null;
  }
  if (typeof proposed !== 'object') return null;
  if (Array.isArray(proposed.items)) {
    const items = proposed.items.map(item => ({
      label: String((item && (item.label || item.name || item.description)) || 'Proposed'),
      amount: money(item && (item.amount != null ? item.amount : item.value)),
    })).filter(item => item.amount != null);
    return {
      items,
      gearSale: money(proposed.gearSale),
      licenceFee: money(proposed.licenceFee),
      licenceDays: asNumber(proposed.licenceDays),
      licenceFrom: typeof proposed.licenceFrom === 'string' ? proposed.licenceFrom : null,
      phoneInternetPersonal: money(
        proposed.phoneInternetPersonal != null ? proposed.phoneInternetPersonal
          : proposed.phoneInternetShare != null ? proposed.phoneInternetShare
            : proposed.phone
      ),
    };
  }
  return {
    gearSale: money(proposed.gearSale),
    licenceFee: money(proposed.licenceFee),
    licenceDays: asNumber(proposed.licenceDays),
    licenceFrom: typeof proposed.licenceFrom === 'string' ? proposed.licenceFrom : null,
    phoneInternetPersonal: money(
      proposed.phoneInternetPersonal != null ? proposed.phoneInternetPersonal
        : proposed.phoneInternetShare != null ? proposed.phoneInternetShare
          : proposed.phone
    ),
  };
}

function readCompanyTax(raw) {
  const source = raw.companyTaxEstimate;
  if (source == null) return null;
  if (typeof source === 'number' || typeof source === 'string') {
    const tax = money(source);
    return tax == null ? null : { tax, explain: '' };
  }
  if (typeof source === 'object') {
    const tax = money(source.tax != null ? source.tax : source.amount != null ? source.amount : source.estimate);
    if (tax == null) return null;
    return { tax, explain: typeof source.explain === 'string' ? source.explain : '' };
  }
  return null;
}

function readBanks(raw) {
  const source = raw.bankBalances || raw.banks;
  if (!source) return null;
  if (Array.isArray(source)) {
    const rows = source.map(row => ({
      number: String((row && (row.number || row.accountNumber)) || ''),
      name: String((row && (row.name || row.label)) || ''),
      balance: money(row && (row.balance != null ? row.balance : row.bankBalance)),
      total: false,
    })).filter(row => row.balance != null && (row.number || row.name));
    return rows.length ? rows : null;
  }
  if (typeof source !== 'object') return null;
  const rows = [];
  Object.keys(source).forEach(key => {
    const value = source[key];
    if (key === 'total' || key === 'bankBalance') {
      const balance = money(value && typeof value === 'object' ? value.balance : value);
      if (balance != null) rows.push({ number: '', name: 'Company bank', balance, total: true });
      return;
    }
    const balance = money(value && typeof value === 'object' ? (value.balance != null ? value.balance : value.bankBalance) : value);
    if (balance == null) return;
    rows.push({
      number: String(key),
      name: String(value && value.name || ''),
      balance,
      total: false,
    });
  });
  rows.sort((a, b) => {
    if (a.total !== b.total) return a.total ? 1 : -1;
    const order = { '3314': 0, '2179': 1 };
    const ao = Object.prototype.hasOwnProperty.call(order, a.number) ? order[a.number] : 10;
    const bo = Object.prototype.hasOwnProperty.call(order, b.number) ? order[b.number] : 10;
    if (ao !== bo) return ao - bo;
    return String(a.number).localeCompare(String(b.number));
  });
  return rows.length ? rows : null;
}

function readReconciliation(raw) {
  if (typeof raw.reconciled === 'boolean') {
    return { reconciled: raw.reconciled, headline: '', bankBalance: null, difference: null };
  }
  if (raw.reconciled && typeof raw.reconciled === 'object') {
    return {
      reconciled: !!raw.reconciled.reconciled,
      headline: typeof raw.reconciled.headline === 'string' ? raw.reconciled.headline : '',
      bankBalance: money(raw.reconciled.bankBalance),
      difference: money(raw.reconciled.difference),
    };
  }
  return null;
}

function unwrap(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const nested = payload.directorLoan && typeof payload.directorLoan === 'object'
    ? payload.directorLoan
    : payload.loan && typeof payload.loan === 'object'
      ? payload.loan
      : null;
  if (!nested) return payload;
  return {
    ...nested,
    asOf: payload.asOf || nested.asOf,
    booked: payload.booked != null ? payload.booked : nested.booked,
    withProposed: payload.withProposed != null ? payload.withProposed : nested.withProposed,
    costsTomPaid: payload.costsTomPaid != null ? payload.costsTomPaid : nested.costsTomPaid,
    netPaidToTom: payload.netPaidToTom != null ? payload.netPaidToTom : nested.netPaidToTom,
    reverseReimbursement: payload.reverseReimbursement != null ? payload.reverseReimbursement : nested.reverseReimbursement,
    proposed: payload.proposed || nested.proposed,
    div7aEstimate: payload.div7aEstimate || nested.div7aEstimate || payload.div7a || nested.div7a,
    companyTaxEstimate: payload.companyTaxEstimate != null ? payload.companyTaxEstimate : nested.companyTaxEstimate,
    reconciled: payload.reconciled != null ? payload.reconciled : nested.reconciled,
    bankBalances: payload.bankBalances || nested.bankBalances,
    configVersion: payload.configVersion != null ? payload.configVersion : nested.configVersion,
  };
}

function normalizeDirectorLoan(payload) {
  const raw = unwrap(payload);
  if (!raw) return null;
  const asOf = asDate(raw.asOf || raw.bookedAsOf);
  const booked = money(raw.booked != null ? raw.booked : raw.bookedSigned);
  const proposed = readProposed(raw);
  const nestedProposed = raw.proposed && !Array.isArray(raw.proposed) ? raw.proposed : null;
  const withProposed = money(
    raw.withProposed != null ? raw.withProposed
      : raw.withProposedSigned != null ? raw.withProposedSigned
        : raw.balanceWithProposed != null ? raw.balanceWithProposed
          : nestedProposed && nestedProposed.withProposed
  );
  const div7a = readDiv7a(raw);
  if (!asOf || booked == null || withProposed == null || !div7a) return null;
  const version = raw.configVersion == null ? null : String(raw.configVersion);
  return {
    asOf,
    booked,
    withProposed,
    costsTomPaid: money(raw.costsTomPaid != null ? raw.costsTomPaid : raw.expensesTomPaid),
    netPaidToTom: money(raw.netPaidToTom != null ? raw.netPaidToTom : raw.netPaid),
    reverseReimbursement: money(raw.reverseReimbursement),
    proposed,
    div7a,
    companyTax: readCompanyTax(raw),
    reconciliation: readReconciliation(raw),
    bankBalances: readBanks(raw),
    configVersion: version,
  };
}

function resetDirectorLoanCache() {
  defaultCache.at = 0;
  defaultCache.key = '';
  defaultCache.data = null;
}

async function fetchDirectorLoan(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now || Date.now;
  const cache = opts.cache || defaultCache;
  const key = typeof env.HUB_SHARED_KEY === 'string' ? env.HUB_SHARED_KEY.trim() : '';
  if (!key) return { ok: false, reason: 'unconfigured' };

  const ttl = opts.ttlMs || CACHE_MS;
  const t = now();
  if (cache.data && cache.key === key && t - cache.at < ttl) {
    return { ok: true, data: cache.data, cached: true };
  }

  const url = opts.url || LOAN_URL;
  const timeoutMs = opts.timeoutMs || 4000;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { 'x-hub-key': key, accept: 'application/json' },
      redirect: 'manual',
      signal: controller ? controller.signal : undefined,
    });
    if (res.status >= 300 && res.status < 400) return { ok: false, reason: 'redirect', status: res.status };
    if (!res.ok) return { ok: false, reason: 'http', status: res.status };
    const json = await res.json();
    const data = normalizeDirectorLoan(json);
    if (!data) return { ok: false, reason: 'invalid' };
    cache.at = t;
    cache.key = key;
    cache.data = data;
    return { ok: true, data, cached: false };
  } catch (_) {
    return { ok: false, reason: 'error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  LOAN_URL,
  CACHE_MS,
  normalizeDirectorLoan,
  fetchDirectorLoan,
  resetDirectorLoanCache,
};

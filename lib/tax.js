// Personal tax maths for Tom Hub. No I/O. The browser and the tests both load this file.
function taxConfig() {
  if (typeof TAX_CONFIG !== 'undefined') return TAX_CONFIG;
  return require('./tax-config');
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function formatAud(n) {
  const negative = n < 0;
  const [whole, frac] = Math.abs(Number(n)).toFixed(2).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + '$' + withCommas + '.' + frac;
}

function daysInclusive(from, to) {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86400000) + 1;
}

function accountMeta(acctId, config) {
  return (config || taxConfig()).accounts.byId[acctId] || null;
}

function pocketSmithGroup(acctId, config) {
  const meta = accountMeta(acctId, config);
  return meta ? meta.group : 'personal';
}

function directorLoan(config) {
  const cfg = config || taxConfig();
  const d = cfg.directorLoan;
  const netPaidToTom = round2(d.reimbursements - d.reverseReimbursement);
  const bookedSigned = round2(d.expensesTomPaid - netPaidToTom);
  const licenceDays = daysInclusive(d.proposed.licenceFrom, d.proposed.licenceTo);
  const licenceFee = round2(cfg.homeOffice.weeklyRounded * licenceDays / 7);
  const gearSale = d.proposed.gearSale;
  const phone = d.proposed.phoneInternetPersonalShare;
  // Gear sale and the licence fee are money Rankify owes Tom.
  // The 10% phone/internet share is money Tom owes back.
  const withProposedSigned = round2(bookedSigned + gearSale + licenceFee - phone);
  const bookedCopy = loanCopy(bookedSigned);
  const proposedCopy = loanCopy(withProposedSigned);
  return {
    bookedSigned,
    bookedAbs: bookedCopy.abs,
    tomOwes: bookedCopy.tomOwes,
    headline: bookedCopy.headline,
    proposedHeadline: proposedCopy.headline,
    withProposedSigned,
    withProposedAbs: round2(Math.abs(withProposedSigned)),
    netPaidToTom,
    expensesTomPaid: d.expensesTomPaid,
    reimbursements: d.reimbursements,
    reverseReimbursement: d.reverseReimbursement,
    bookedAsOf: d.bookedAsOf,
    ptyAccountNumbers: d.ptyAccountNumbers,
    excludedAccountNumber: d.excludedAccountNumber,
    proposed: {
      gearSale,
      licenceFee,
      licenceDays,
      licenceFrom: d.proposed.licenceFrom,
      phoneInternetPersonal: phone,
    },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIVE_LABEL = 'Live from Rankify Hub';

function formatIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return '';
  return Number(match[3]) + ' ' + month + ' ' + match[1];
}

function syncedTimeLabel(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Brisbane', day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d).replace(/\s?(am|pm)$/i, function (m) { return ' ' + m.trim().toLowerCase(); }) + ' AEST';
  } catch (_) {
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}

function syncedDateLabel(iso) {
  const pretty = formatIsoDate(iso);
  return pretty ? 'Not live, last synced ' + pretty : 'Not live, last synced';
}

function loanCopy(signed) {
  const amount = round2(Number(signed) || 0);
  const abs = round2(Math.abs(amount));
  if (amount < -0.004) {
    return { tomOwes: true, settled: false, abs, headline: 'Tom owes Rankify ' + formatAud(abs) };
  }
  if (amount > 0.004) {
    return { tomOwes: false, settled: false, abs, headline: 'Rankify owes Tom ' + formatAud(abs) };
  }
  return { tomOwes: false, settled: true, abs: 0, headline: 'The director loan is settled' };
}

function fallbackLoanSync(config) {
  const cfg = config || taxConfig();
  const asOf = (cfg.directorLoan && cfg.directorLoan.bookedAsOf) || cfg.asOf;
  const pretty = formatIsoDate(asOf);
  return {
    live: false,
    stale: true,
    matchesRankifyHub: false,
    asOf,
    syncedAt: null,
    configVersion: null,
    label: 'Not live: Rankify Hub did not answer. This is the ' + (pretty || 'old') + ' snapshot, not today\'s figure',
  };
}

function applyRankifyLoan(summary, feed, meta) {
  const m = meta || {};
  if (!summary || !feed || typeof feed.booked !== 'number' || typeof feed.withProposed !== 'number') return summary;
  if (!feed.div7a || typeof feed.div7a.tax !== 'number') return summary;
  const next = JSON.parse(JSON.stringify(summary));
  const booked = loanCopy(feed.booked);
  const proposed = loanCopy(feed.withProposed);
  const loan = next.directorLoan;
  loan.bookedSigned = round2(feed.booked);
  loan.bookedAbs = booked.abs;
  loan.tomOwes = booked.tomOwes;
  loan.headline = booked.headline;
  loan.withProposedSigned = round2(feed.withProposed);
  loan.withProposedAbs = proposed.abs;
  loan.proposedHeadline = proposed.headline;
  loan.expensesTomPaid = feed.costsTomPaid == null ? null : round2(feed.costsTomPaid);
  loan.netPaidToTom = feed.netPaidToTom == null ? null : round2(feed.netPaidToTom);
  loan.reverseReimbursement = feed.reverseReimbursement == null ? null : round2(feed.reverseReimbursement);
  loan.reimbursements = null;
  loan.bookedAsOf = String(feed.asOf).slice(0, 10);
  loan.proposed = feed.proposed || {
    gearSale: null,
    licenceFee: null,
    licenceDays: null,
    phoneInternetPersonal: null,
    items: null,
  };
  loan.figuresFrom = 'rankify-hub';

  const src = feed.div7a;
  next.div7a.booked = {
    debit: src.debit == null ? (feed.booked < 0 ? round2(Math.abs(feed.booked)) : 0) : round2(src.debit),
    tax: round2(src.tax),
    interest: src.interest == null ? null : round2(src.interest),
  };
  next.div7a.proposed = {
    debit: src.proposedDebit == null ? (feed.withProposed < 0 ? round2(Math.abs(feed.withProposed)) : 0) : round2(src.proposedDebit),
    tax: src.proposedTax == null ? null : round2(src.proposedTax),
    interest: src.proposedInterest == null ? null : round2(src.proposedInterest),
  };
  next.div7a.minimumYearly = src.minimumYearly == null ? null : round2(src.minimumYearly);
  next.div7a.explain = src.explain || '';
  next.div7a.ratesFromFeed = src.benchmarkRate != null || src.combined != null;
  if (src.benchmarkRate != null) next.div7a.benchmarkRate = src.benchmarkRate;
  if (src.combined != null) next.div7a.combined = src.combined;
  if (src.incomeTaxRate != null) next.div7a.incomeTax = src.incomeTaxRate;
  if (src.medicare != null) next.div7a.medicare = src.medicare;
  next.div7a.estimate = true;
  next.div7a.figuresFrom = 'rankify-hub';

  next.companyTax = feed.companyTax || null;
  next.reconciliation = feed.reconciliation || null;
  next.bankBalances = feed.bankBalances || null;
  if (next.fy27Estimate && typeof next.fy27Estimate.resultSigned === 'number') {
    next.fy27Estimate.ifDeemedDividendSigned = round2(next.fy27Estimate.resultSigned - next.div7a.booked.tax);
  }
  next.asOf = loan.bookedAsOf;
  const when = syncedTimeLabel(m.syncedAt);
  next.loanSync = {
    live: !m.stale,
    stale: !!m.stale,
    matchesRankifyHub: !m.stale,
    asOf: loan.bookedAsOf,
    syncedAt: m.syncedAt || null,
    source: feed.source || 'rankify-hub',
    configVersion: feed.configVersion || null,
    label: m.stale
      ? 'Not live: Rankify Hub did not answer. Showing the last sync' + (when ? ' from ' + when : '')
      : LIVE_LABEL + (when ? ' · synced ' + when : ''),
  };
  return next;
}

function div7aOnBalance(signedBalance, config) {
  const cfg = config || taxConfig();
  const debit = signedBalance < 0 ? round2(Math.abs(signedBalance)) : 0;
  return {
    debit,
    tax: round2(debit * cfg.marginal.combined),
    interest: round2(debit * cfg.div7a.benchmarkRate),
    estimate: true,
  };
}

function licenceFee(config) {
  const cfg = config || taxConfig();
  const h = cfg.homeOffice;
  const weeklyExact = round2(h.rentWeeklyShare * h.floorPct);
  const daily = h.rentWeeklyShare / 7;
  const daysFromStart = daysInclusive(h.licenceStart, cfg.fy.end);
  const daysAdopted = daysFromStart - h.itmOverlapDays;
  const incomeFromStart = round2(daily * daysFromStart * h.floorPct);
  const incomeAdopted = round2(daily * daysAdopted * h.floorPct);
  return {
    weeklyExact,
    weeklyAbout: h.weeklyRounded,
    room: h.room,
    floorPctLabel: h.floorPctLabel,
    rentWeeklyShare: h.rentWeeklyShare,
    licenceStart: h.licenceStart,
    daysFromStart,
    daysAdopted,
    itmOverlapDays: h.itmOverlapDays,
    incomeFromStart,
    incomeAdopted,
    rentDeduction: incomeAdopted,
  };
}

function carPosition(config, loggedKm) {
  const cfg = config || taxConfig();
  const km = loggedKm == null ? cfg.car.loggedKm : loggedKm;
  const counted = Math.min(Math.max(0, km), cfg.car.capKm);
  return {
    loggedKm: km,
    countedKm: counted,
    ratePerKm: cfg.car.ratePerKm,
    capKm: cfg.car.capKm,
    reimbursement: round2(counted * cfg.car.ratePerKm),
    maxReimbursement: round2(cfg.car.capKm * cfg.car.ratePerKm),
    overCap: km > cfg.car.capKm,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function parseAssetRegister(csvText) {
  const table = parseCsv(csvText);
  const header = table[0].map(h => h.trim());
  const col = (part) => header.findIndex(h => h.toLowerCase().includes(part.toLowerCase()));
  const iId = header.findIndex(h => h.trim().toLowerCase() === 'id');
  const iItem = header.findIndex(h => h.trim().toLowerCase() === 'item');
  const iMv = col('estimated market value');
  const iDecline = col('A: FY27 decline');
  const iNotes = col('notes');
  return table.slice(1).map(r => {
    const notes = r[iNotes] || '';
    const included = /INCLUDED/i.test(notes) && !/EXCLUDED/i.test(notes);
    return {
      id: r[iId] || '',
      item: r[iItem] || '',
      marketValue: Number(r[iMv] || 0),
      optionADecline: Number(r[iDecline] || 0),
      included,
      notes,
    };
  });
}

function depreciation(assets, config) {
  const cfg = config || taxConfig();
  const included = (assets || []).filter(a => a.included);
  const marketValue = round2(included.reduce((s, a) => s + Number(a.marketValue || 0), 0));
  const optionADecline = round2(included.reduce((s, a) => s + Number(a.optionADecline || 0), 0));
  return {
    likelyOption: cfg.depreciation.likelyOption,
    saleDate: cfg.depreciation.saleDate,
    includedCount: included.length,
    excludedCount: (assets || []).length - included.length,
    marketValue,
    saleProceedsRounded: Math.round(marketValue),
    optionBPersonalDeduction: 0,
    optionADecline,
  };
}

function classifyTransaction(txn, config) {
  const cfg = config || taxConfig();
  const meta = accountMeta(txn.acctId, cfg);
  const group = meta ? meta.group : 'personal';
  const payee = String(txn.payee || '').toUpperCase();
  const debit = txn.amount < 0 ? round2(Math.abs(txn.amount)) : 0;

  if (group === 'hiatus') {
    return { entity: 'hiatus', tag: 'Hiatus', personalAmount: 0, reimbursableAmount: 0 };
  }
  if (group === 'excluded') {
    return { entity: 'not_pty', tag: 'Not Rankify Pty Ltd', personalAmount: 0, reimbursableAmount: 0 };
  }
  if (group === 'loan') {
    return { entity: 'loan', tag: '', personalAmount: 0, reimbursableAmount: 0 };
  }
  if (group === 'rankify') {
    if (txn.amount > 0 && payee.includes('FLOOD')) {
      return { entity: 'rankify', tag: 'Reverse reimbursement', personalAmount: 0, reimbursableAmount: 0 };
    }
    return { entity: 'rankify', tag: 'Rankify Pty Ltd', personalAmount: 0, reimbursableAmount: 0 };
  }

  if (payee.includes('ITM WAGES') || payee.includes('ITM ')) {
    return { entity: 'itm', tag: 'ITM', personalAmount: 0, reimbursableAmount: 0 };
  }

  if (txn.amount > 0 && payee.includes('RANKIFY PTY')) {
    return { entity: 'rankify', tag: 'Reimbursement', personalAmount: 0, reimbursableAmount: 0 };
  }

  if (!debit || txn.isTransfer) {
    return { entity: 'personal', tag: txn.isTransfer ? 'Transfer' : '', personalAmount: 0, reimbursableAmount: 0 };
  }

  const onPersonalCard = !!(meta && meta.personalCard);
  if (onPersonalCard) {
    for (const needle of cfg.otherVenturePayees) {
      if (payee.includes(needle)) {
        return { entity: 'other', tag: 'Other venture', personalAmount: 0, reimbursableAmount: 0 };
      }
    }
    for (const needle of cfg.reimbursablePayees) {
      if (payee.includes(needle)) {
        return { entity: 'rankify', tag: 'Rankify, reimbursable', personalAmount: 0, reimbursableAmount: debit };
      }
    }
    for (const rule of cfg.partialPayees) {
      if (payee.includes(rule.match)) {
        const reimbursableAmount = round2(debit * rule.businessPct);
        const personalAmount = round2(debit - reimbursableAmount);
        return {
          entity: 'split',
          tag: 'Rankify, reimbursable',
          personalAmount,
          reimbursableAmount,
        };
      }
    }
  }

  return { entity: 'personal', tag: '', personalAmount: debit, reimbursableAmount: 0 };
}

function summariseFeed(transactions, config) {
  const cfg = config || taxConfig();
  const totals = {
    personalSpend: 0,
    reimbursable: 0,
    hiatusSpend: 0,
    otherVenture: 0,
    excludedSpend: 0,
    reverseReimbursement: 0,
  };
  for (const txn of transactions || []) {
    const c = classifyTransaction(txn, cfg);
    totals.personalSpend += c.personalAmount;
    totals.reimbursable += c.reimbursableAmount;
    if (c.entity === 'hiatus' && txn.amount < 0 && !txn.isTransfer) totals.hiatusSpend += Math.abs(txn.amount);
    if (c.entity === 'other' && txn.amount < 0) totals.otherVenture += Math.abs(txn.amount);
    if (c.entity === 'not_pty' && txn.amount < 0 && !txn.isTransfer) totals.excludedSpend += Math.abs(txn.amount);
    if (c.tag === 'Reverse reimbursement') totals.reverseReimbursement += Number(txn.amount);
  }
  Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });
  return totals;
}

function costItemSplit(item, config) {
  const cfg = config || taxConfig();
  const name = String(item && item.name || '').toLowerCase();
  for (const rule of cfg.costItemRules) {
    if (name.includes(rule.match)) {
      return {
        personalShare: rule.personalShare,
        reimbursableShare: round2(1 - rule.personalShare),
        tag: rule.tag,
        note: rule.note,
      };
    }
  }
  return { personalShare: 1, reimbursableShare: 0, tag: '', note: '' };
}

function fy27Estimate(cfg) {
  const e = cfg.fy27Estimate;
  const liability = round2(e.taxPlusMedicare + e.mls);
  const result = round2(e.paygProjected - liability);
  const divTax = div7aOnBalance(directorLoan(cfg).bookedSigned, cfg).tax;
  return {
    estimate: true,
    paygWeekly: e.paygWeekly,
    paygWeeks: e.paygWeeks,
    paygProjected: e.paygProjected,
    taxPlusMedicare: e.taxPlusMedicare,
    mls: e.mls,
    mlsNote: e.mlsNote,
    helpDebt: e.helpDebt,
    liability,
    refund: result > 0 ? result : 0,
    payable: result < 0 ? -result : 0,
    resultSigned: result,
    ifDeemedDividendSigned: round2(result - divTax),
  };
}

function buildSummary(config, assets) {
  const cfg = config || taxConfig();
  const loan = directorLoan(cfg);
  const fee = licenceFee(cfg);
  const car = carPosition(cfg);
  const assetsOut = assets && assets.length ? depreciation(assets, cfg) : {
    likelyOption: cfg.depreciation.likelyOption,
    saleDate: cfg.depreciation.saleDate,
    includedCount: null,
    excludedCount: null,
    marketValue: null,
    saleProceedsRounded: cfg.directorLoan.proposed.gearSale,
    optionBPersonalDeduction: 0,
    optionADecline: null,
  };
  const divBooked = div7aOnBalance(loan.bookedSigned, cfg);
  const divProposed = div7aOnBalance(loan.withProposedSigned, cfg);

  return {
    asOf: cfg.asOf,
    estimateNote: 'Estimate for you to check. Your tax agent signs off before anything is lodged.',
    directorLoan: loan,
    div7a: {
      estimate: true,
      incomeTax: cfg.marginal.incomeTax,
      medicare: cfg.marginal.medicare,
      combined: cfg.marginal.combined,
      salaryApprox: cfg.marginal.salaryApprox,
      benchmarkRate: cfg.div7a.benchmarkRate,
      booked: divBooked,
      proposed: divProposed,
    },
    fy27: {
      label: cfg.fy.label,
      start: cfg.fy.start,
      end: cfg.fy.end,
      returnDue: cfg.fy.returnDue,
      returnDueLabel: cfg.fy.returnDueLabel,
      licence: fee,
      rentDeduction: fee.rentDeduction,
      runningCosts: 0,
      runningCostsNote: 'The licence fee is cost recovery, so power, phone and internet are not claimed again. ITM work-from-home stays separate. The 70c/hr fixed rate is last year\'s; FY27 is not published yet.',
      depreciation: assetsOut.optionBPersonalDeduction,
      depreciationNote: 'Option B is the likely path: sell the gear to Rankify on 20 Oct 2026. You claim no decline in value. Rankify claims the write-off.',
      optionADecline: assetsOut.optionADecline,
      carReimbursement: car.reimbursement,
    },
    shareholderPct: cfg.shareholderPct,
    fy27Estimate: fy27Estimate(cfg),
    priorYearTaxDebt: { ...cfg.priorYearTaxDebt },
    fy26Debt: {
      amount: cfg.priorYearTaxDebt.amount,
      confirmed: false,
      dueDate: cfg.priorYearTaxDebt.dueDate,
      paymentPlan: cfg.priorYearTaxDebt.paymentPlan,
      source: 'Tom Hub Net Position hard-coded taxBill2025 = 4000, labelled "2025 Tax Bill" (added 26 Aug 2026). Not checked against an ATO notice.',
    },
    assets: assetsOut,
    car,
    stillToConfirm: cfg.stillToConfirm,
    loanSync: fallbackLoanSync(cfg),
    companyTax: null,
    reconciliation: null,
    bankBalances: null,
  };
}

const api = {
  round2,
  formatAud,
  daysInclusive,
  accountMeta,
  pocketSmithGroup,
  directorLoan,
  div7aOnBalance,
  licenceFee,
  carPosition,
  parseCsv,
  parseAssetRegister,
  depreciation,
  classifyTransaction,
  summariseFeed,
  costItemSplit,
  fy27Estimate,
  buildSummary,
  formatIsoDate,
  syncedDateLabel,
  syncedTimeLabel,
  loanCopy,
  fallbackLoanSync,
  applyRankifyLoan,
  LIVE_LABEL,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') globalThis.TomTax = api;

// Personal net position for Tom Hub. No I/O.
// Cash is personal accounts only. Rankify and Hiatus stay out.
// The director loan is the booked figure on the tax summary (the server
// already read Rankify). The Amex figure is the bank-feed account.

function cents(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const CAR_LOAN_OWING = 17582.10;
const CAR_LOAN_NOTE = 'Taurus payout, 6 Oct 2026';
const CAR_VALUE = 22000;
const CAR_PAYMENT_MONTHLY = 566.42;
// Tom confirmed this is $1,000, not $3,000.
const OWE_TO_DOM = 1000;
const FY26_TAX_ESTIMATE = 4000;
const FY26_TAX_LABEL = "2025 Tax Bill (Tom's estimate)";
const AMEX_ACCOUNT_ID = 5643758;
const AMEX_COST_NAME = 'amex balance';

function balanceOf(account) {
  const n = Number(account && account.balance);
  return Number.isFinite(n) ? n : 0;
}

function fy26TaxFrom(summary) {
  const debt = summary && summary.fy26Debt;
  const prior = summary && summary.priorYearTaxDebt;
  const hasAmount = debt && typeof debt.amount === 'number' && Number.isFinite(debt.amount);
  const amount = hasAmount ? cents(debt.amount) : FY26_TAX_ESTIMATE;
  const confirmed = !!(debt && debt.confirmed === true);
  const base = prior && prior.netPositionLabel ? String(prior.netPositionLabel) : '2025 Tax Bill';
  return {
    debt: amount > 0 ? amount : 0,
    confirmed,
    label: confirmed ? base : base + " (Tom's estimate)",
  };
}

function directorFrom(summary) {
  const loan = summary && summary.directorLoan;
  const sync = summary && summary.loanSync;
  const syncLabel = sync && sync.label ? String(sync.label) : '';
  const live = !!(sync && sync.live);
  if (!loan || typeof loan.bookedSigned !== 'number' || !Number.isFinite(loan.bookedSigned)) {
    return { included: false, bookedSigned: null, debt: 0, asset: 0, syncLabel, live };
  }
  const bookedSigned = cents(loan.bookedSigned);
  if (bookedSigned < 0) {
    return { included: true, bookedSigned, debt: cents(Math.abs(bookedSigned)), asset: 0, syncLabel, live };
  }
  if (bookedSigned > 0) {
    return { included: true, bookedSigned, debt: 0, asset: bookedSigned, syncLabel, live };
  }
  return { included: true, bookedSigned: 0, debt: 0, asset: 0, syncLabel, live };
}

function bucketFor(account, groupOf) {
  const raw = groupOf ? groupOf(account) : ((account && account.group) || 'personal');
  if (raw === 'personal' || raw === 'loan') return raw;
  return 'leftOut';
}

function amexCostMonthly(costItems) {
  let found = null;
  for (const item of costItems || []) {
    const name = String((item && item.name) || '').trim().toLowerCase();
    if (name !== AMEX_COST_NAME) continue;
    if (typeof item.monthly === 'number' && Number.isFinite(item.monthly)) found = cents(item.monthly);
  }
  return found;
}

function personalNetPosition(input) {
  const opts = input || {};
  const accounts = Array.isArray(opts.accounts) ? opts.accounts : [];
  const cashAccounts = [];
  const cards = [];
  const loans = [];
  const leftOut = [];

  for (const account of accounts) {
    const bucket = bucketFor(account, opts.groupOf);
    const balance = balanceOf(account);
    if (bucket === 'personal') {
      if (balance >= 0) cashAccounts.push(account);
      else cards.push(account);
    } else if (bucket === 'loan') {
      loans.push(account);
    } else {
      leftOut.push(account);
    }
  }

  const cash = cents(cashAccounts.reduce((sum, account) => sum + cents(balanceOf(account)), 0));
  const cardRows = cards.map(account => ({
    account,
    owing: cents(Math.abs(balanceOf(account))),
    bankFeed: Number(account.id) === AMEX_ACCOUNT_ID,
  }));
  const cardDebt = cents(cardRows.reduce((sum, row) => sum + row.owing, 0));
  const amexRow = cardRows.find(row => Number(row.account.id) === AMEX_ACCOUNT_ID) || null;
  const homeLoanFull = cents(loans.reduce((sum, account) => sum + Math.abs(balanceOf(account)), 0));
  const homeLoanShare = cents(homeLoanFull / 2);
  const propertyFull = Number(opts.propertyValue) || 0;
  const propertyShare = propertyFull ? cents(propertyFull / 2) : 0;
  const directorLoan = directorFrom(opts.taxSummary);
  const fy26Tax = fy26TaxFrom(opts.taxSummary);
  const amexCostIgnored = amexCostMonthly(opts.costItems);
  const totalAssets = cents(cash + propertyShare + CAR_VALUE + directorLoan.asset);
  const totalDebts = cents(cardDebt + homeLoanShare + CAR_LOAN_OWING + OWE_TO_DOM + directorLoan.debt + fy26Tax.debt);

  return {
    cash,
    cashAccounts: cashAccounts.filter(account => balanceOf(account) > 0),
    cards: cardRows,
    cardDebt,
    amex: {
      id: AMEX_ACCOUNT_ID,
      owing: amexRow ? amexRow.owing : null,
      source: 'bank-feed',
    },
    amexCostIgnored,
    leftOut,
    propertyFull,
    propertyShare,
    carValue: CAR_VALUE,
    carLoan: {
      owing: CAR_LOAN_OWING,
      note: CAR_LOAN_NOTE,
      paymentMonthly: CAR_PAYMENT_MONTHLY,
      paymentsLeft: Math.ceil(CAR_LOAN_OWING / CAR_PAYMENT_MONTHLY),
    },
    oweToDom: OWE_TO_DOM,
    directorLoan,
    fy26Tax,
    homeLoanFull,
    homeLoanShare,
    equity: cents(propertyShare - homeLoanShare),
    totalAssets,
    totalDebts,
    net: cents(totalAssets - totalDebts),
  };
}

const tomNetApi = {
  cents,
  personalNetPosition,
  CAR_LOAN_OWING,
  CAR_LOAN_NOTE,
  CAR_VALUE,
  CAR_PAYMENT_MONTHLY,
  OWE_TO_DOM,
  FY26_TAX_ESTIMATE,
  FY26_TAX_LABEL,
  AMEX_ACCOUNT_ID,
};

if (typeof module !== 'undefined' && module.exports) module.exports = tomNetApi;
if (typeof globalThis !== 'undefined') globalThis.TomNet = tomNetApi;

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
const OWE_TO_DOM = 1000;
const AMEX_ACCOUNT_ID = 5643758;
const AMEX_COST_NAME = 'amex balance';

function balanceOf(account) {
  const n = Number(account && account.balance);
  return Number.isFinite(n) ? n : 0;
}

function amountOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return cents(value);
  if (value && typeof value === 'object' && typeof value.amount === 'number' && Number.isFinite(value.amount)) {
    return cents(value.amount);
  }
  return null;
}

function fy26Ato(summary) {
  const fy = summary && summary.fy26;
  const ato = summary && summary.ato;
  const candidates = [
    fy && fy.atoOwing,
    fy && fy.owing,
    summary && summary.fy26AtoOwing,
    ato && ato.fy26Owing,
    ato && ato.owing,
  ];
  for (const value of candidates) {
    const amount = amountOf(value);
    if (amount != null) {
      return {
        pending: false,
        amount,
        debt: amount > 0 ? amount : 0,
        asset: amount < 0 ? cents(Math.abs(amount)) : 0,
        label: 'FY26 tax bill',
      };
    }
  }
  return { pending: true, amount: null, debt: 0, asset: 0, label: 'FY26 tax bill' };
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
  const ato = fy26Ato(opts.taxSummary);
  const amexCostIgnored = amexCostMonthly(opts.costItems);
  const totalAssets = cents(cash + propertyShare + CAR_VALUE + directorLoan.asset + ato.asset);
  const totalDebts = cents(cardDebt + homeLoanShare + CAR_LOAN_OWING + OWE_TO_DOM + directorLoan.debt + ato.debt);

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
    ato,
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
  AMEX_ACCOUNT_ID,
};

if (typeof module !== 'undefined' && module.exports) module.exports = tomNetApi;
if (typeof globalThis !== 'undefined') globalThis.TomNet = tomNetApi;

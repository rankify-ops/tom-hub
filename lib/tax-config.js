// Single source for Tom's personal tax figures.
// Rates are estimates for the dashboard. The tax agent signs off before lodgment.
const TAX_CONFIG = {
  asOf: '2026-10-20',
  currency: 'AUD',

  fy: {
    label: 'FY27',
    start: '2026-07-01',
    end: '2027-06-30',
    returnDue: '2027-10-31',
    returnDueLabel: '31 Oct 2027, or later if a tax agent lodges it',
  },

  // ITM salary is about $180k, so the 37% bracket. Medicare is added on top.
  marginal: {
    incomeTax: 0.37,
    medicare: 0.02,
    combined: 0.39,
    salaryApprox: 180000,
  },

  div7a: {
    benchmarkRate: 0.0877,
  },

  // Booked director loan, Tom Flood ↔ Rankify Pty Ltd, 1 Jul–20 Oct 2026.
  // Sign: positive = Rankify owes Tom. Negative = Tom owes Rankify.
  // Only NAB 3314 and 2179 are Rankify Pty Ltd. NAB 4750 is not.
  directorLoan: {
    expensesTomPaid: 9990.36,
    reimbursements: 16832.00,
    reverseReimbursement: 2447.73,
    bookedAsOf: '2026-10-20',
    ptyAccountNumbers: ['3314', '2179'],
    excludedAccountNumber: '4750',
    personalCardNumbers: ['1003', '0779'],
    proposed: {
      // Register market values sum to $2,875.08. The reconciliation uses $2,875.
      gearSale: 2875,
      // 10–20 Oct inclusive, at the rounded ~$84/week rate.
      licenceFrom: '2026-10-10',
      licenceTo: '2026-10-20',
      // Tom's 10% of phone and internet that was sitting in the Rankify expenses.
      phoneInternetPersonalShare: 26.55,
    },
  },

  homeOffice: {
    room: 'Bed 3',
    rentWeeklyShare: 1150,
    floorPct: 0.073,
    floorPctLabel: '7.3%',
    licenceStart: '2026-10-10',
    // 10–19 Oct the room was also used for ITM. Those 10 days come out of the cautious total.
    itmOverlapDays: 10,
    // Reconciliation and the weekly skim use $84. Exact is $1,150 × 7.3%.
    weeklyRounded: 84,
  },

  phoneInternet: {
    businessPct: 0.9,
    personalPct: 0.1,
  },

  car: {
    ratePerKm: 0.91,
    capKm: 5000,
    // No trip log in the hub yet.
    loggedKm: 0,
  },

  runningCosts: {
    // Last published fixed rate. FY27 has not been published.
    priorFixedRateCents: 70,
    fy27RatePublished: false,
  },

  depreciation: {
    likelyOption: 'B',
    saleDate: '2026-10-20',
  },

  // PocketSmith account ids from the live hub feed.
  accounts: {
    byId: {
      5554543: { group: 'personal', number: '2490', name: 'Everyday Offset' },
      5554548: { group: 'loan', number: '0237', name: 'Home Loan (Investment)' },
      5554553: { group: 'personal', number: '5481', name: 'Everyday Offset' },
      5554558: { group: 'personal', number: '6535', name: 'Direct Investment Account' },
      5554563: { group: 'personal', number: '6633', name: 'Every Day' },
      5554568: { group: 'personal', number: '1692', name: 'Subscriptions & Bills' },
      5554573: { group: 'personal', number: '7398', name: 'Holding Account' },
      5554578: { group: 'rankify', number: '3314', name: 'RANKIFY INCOME', pty: true },
      5554583: { group: 'excluded', number: '3283', name: 'RANKIFY TAX', pty: false },
      5554588: { group: 'excluded', number: '4750', name: 'RANKIFY', pty: false },
      5554593: { group: 'rankify', number: '2179', name: 'RANKIFY EXPENSES', pty: true },
      5554598: { group: 'personal', number: '0011', name: 'Holding Account 2' },
      5554603: { group: 'hiatus', number: '5327', name: 'Hiatus Transactional' },
      5554608: { group: 'personal', number: '0779', name: 'Credit Card', personalCard: true },
      5554613: { group: 'personal', number: '3336', name: 'Income' },
      5554618: { group: 'hiatus', number: '9471', name: 'Hiatus Savings' },
      5643758: { group: 'personal', number: '1003', name: 'Amex Platinum', personalCard: true },
    },
  },

  // Rankify costs that show up on Tom's Amex (1003) and NAB card 0779.
  reimbursablePayees: [
    'SEMRUSH',
    'ANTHROPIC',
    'CLAUDE',
    'VERCEL',
    'CURSOR',
    'POCKETSMITH',
    'PARSEC',
    'SMARTLEAD',
    'HIGGSFIELD',
    'FACEBK',
    'FACEBOOK',
    'SUPABASE',
    'VENTRAIP',
    'APOLLO',
    'BUSINESS1300',
    'RELIABLELEADS',
    'RANKIFY AUSTRALIA',
    'GODADDY',
  ],

  // 90% Rankify, 10% Tom. Matched on the personal cards.
  partialPayees: [
    { match: 'VODAFONE', businessPct: 0.9 },
    { match: 'QUOKKA NET', businessPct: 0.9 },
  ],

  // Not Rankify and not personal spend.
  otherVenturePayees: ['MICROSOFT 365', 'MICROSOFT*MICROSOFT'],

  // Subscription rows in the finances cost list.
  costItemRules: [
    {
      match: 'rankify expenses',
      personalShare: 0,
      tag: 'Planning only',
      note: 'Cash-flow line only. It is not personal spend and it does not feed the tax figures.',
    },
    {
      match: 'vodafone',
      personalShare: 0.1,
      tag: 'Rankify, reimbursable',
      note: '90% is Rankify. 10% is yours.',
    },
    {
      match: 'internet',
      personalShare: 0.1,
      tag: 'Rankify, reimbursable',
      note: '90% is Rankify. 10% is yours.',
    },
  ],

  stillToConfirm: [
    'Business % for Apple, ExpressVPN and ChatGPT',
    'GoDaddy charges can include domains for other ventures',
    'Who owns NAB 4750',
  ],
};

if (typeof module !== 'undefined' && module.exports) module.exports = TAX_CONFIG;

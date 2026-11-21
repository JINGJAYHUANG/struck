// Sample data for judges and the demo. Prices for the two Court of Justice products are from the
// C-330/23 press release; dates and every other product are made up for the demo.

export const SAMPLE_PRODUCTS = [
  { market: 'DE', sku: 'BANANA-1KG', name: 'Bananas, 1 kg', rows: [['2026-10-01', '1.29'], ['2026-11-20', '1.69']] },
  { market: 'DE', sku: 'PINEAPPLE', name: 'Pineapple, each', rows: [['2026-10-01', '1.39'], ['2026-11-20', '1.69']] },
  { market: 'DE', sku: 'COFFEE-1KG', name: 'Coffee beans, 1 kg', rows: [['2026-09-01', '12.99']] },
  { market: 'DE', sku: 'JACKET-ALPINE', name: 'Alpine winter jacket', rows: [['2026-09-01', '100.00'], ['2026-11-13', '90.00'], ['2026-11-20', '80.00']] },
  { market: 'DE', sku: 'JACKET-HARBOUR', name: 'Harbour winter jacket', rows: [['2026-09-01', '100.00'], ['2026-10-29', '90.00'], ['2026-11-05', '80.00'], ['2026-11-12', '70.00'], ['2026-11-19', '100.00']] },
  { market: 'EU-BASE', sku: 'ESPRESSO-PRO', name: 'Espresso machine Pro', rows: [['2026-09-01', '399.00'], ['2026-10-24', '279.00'], ['2026-11-01', '399.00']] },
  // The Cyber Monday price (30 Nov to 2 Dec) is a price actually charged, so it counts in the next promotion's window.
  { market: 'EU-BASE', sku: 'TV-55', name: '55-inch TV', rows: [['2026-09-01', '799.00'], ['2026-11-30', '699.00'], ['2026-12-03', '799.00']] },
  { market: 'EU-BASE', sku: 'HEADPHONES-ANC', name: 'Noise-cancelling headphones', launchedAt: '2026-11-15', rows: [['2026-11-15', '149.00']] },
];

/** Promotions: summary, brief (the work item description) and the lines Struck checks. Money as decimals. */
export const SAMPLE_PROMOTIONS = [
  {
    id: 'black-friday-produce',
    summary: 'Black Friday – fresh produce (DE)',
    market: 'DE',
    startsAt: '2026-11-27',
    brief: 'Black Friday flyer, Germany, from Friday 27 November.\nBananas 1 kg: now 1.29, was 1.69, banner "-23%".\nPineapple: "Preis-Highlight" 1.49, was 1.69.\nCoffee beans 1 kg: 10.99 instead of 12.99, "-15%".',
    lines: [
      { sku: 'BANANA-1KG', newPrice: '1.29', shownPrior: '1.69', shownPercent: 23, claimType: 'percent' },
      { sku: 'PINEAPPLE', newPrice: '1.49', shownPrior: '1.69', claimType: 'statement', statementLabel: 'Preis-Highlight' },
      { sku: 'COFFEE-1KG', newPrice: '10.99', shownPrior: '12.99', shownPercent: 15, claimType: 'percent' },
    ],
    expect: { overall: 'fail', verdicts: { 'BANANA-1KG': 'fail', PINEAPPLE: 'fail', 'COFFEE-1KG': 'ok' } },
  },
  {
    id: 'winter-jackets',
    summary: 'Winter jackets – progressive markdown (DE)',
    market: 'DE',
    startsAt: '2026-11-27',
    brief: 'Third step of the Alpine jacket markdown that began on 13 November (90, then 80): now 70, "-30% from 100".\nHarbour jacket is back at 100 since 19 November after its October markdown; new banner "-30% from 100" at 70.',
    lines: [
      { sku: 'JACKET-ALPINE', newPrice: '70.00', shownPrior: '100.00', shownPercent: 30, claimType: 'percent', campaignStart: '2026-11-13' },
      { sku: 'JACKET-HARBOUR', newPrice: '70.00', shownPrior: '100.00', shownPercent: 30, claimType: 'percent' },
    ],
    expect: { overall: 'fail', verdicts: { 'JACKET-ALPINE': 'ok', 'JACKET-HARBOUR': 'fail' } },
  },
  {
    id: 'cyber-monday',
    summary: 'Cyber Monday – electronics (EU)',
    market: 'EU-BASE',
    startsAt: '2026-11-30',
    brief: 'Cyber Monday, Monday 30 November.\nEspresso machine Pro: 299 instead of 399, "-25%".\n55-inch TV: 699 instead of 799, "-12%".',
    lines: [
      { sku: 'ESPRESSO-PRO', newPrice: '299.00', shownPrior: '399.00', shownPercent: 25, claimType: 'percent' },
      { sku: 'TV-55', newPrice: '699.00', shownPrior: '799.00', shownPercent: 12, claimType: 'percent' },
    ],
    expect: { overall: 'fail', verdicts: { 'ESPRESSO-PRO': 'fail', 'TV-55': 'ok' } },
  },
  {
    id: 'launch-offer',
    summary: 'Launch offer – headphones (EU)',
    market: 'EU-BASE',
    startsAt: '2026-11-27',
    brief: 'Launch offer for the new noise-cancelling headphones (on sale since 15 November): 119, was 149, "-20%".',
    lines: [
      { sku: 'HEADPHONES-ANC', newPrice: '119.00', shownPrior: '149.00', shownPercent: 20, claimType: 'percent' },
    ],
    expect: { overall: 'fail', verdicts: { 'HEADPHONES-ANC': 'cannot-verify' } },
  },
  {
    id: 'weekend-brief',
    summary: 'Weekend deal – TV (EU), brief only',
    market: 'EU-BASE',
    startsAt: '2026-12-05',
    brief: 'Weekend deal from Saturday 5 December: the 55-inch TV (TV-55) at 649, show "was 799" and a "-18%" badge. Ask Struck to read this brief into lines.',
    lines: [],
    expect: null,
    // What the agent should read from the brief; the Cyber Monday price of 699 is the prior price on 5 December.
    briefLines: [{ sku: 'TV-55', newPrice: '649.00', shownPrior: '799.00', shownPercent: 18, claimType: 'percent' }],
    briefExpect: { overall: 'fail', verdicts: { 'TV-55': 'fail' } },
  },
];

/** "1.29" or "1,29" to 129 cents, without floating-point arithmetic. */
export function toMinor(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Number.isInteger(value) && value >= 0 && typeof value === 'number' && !String(value).includes('.')) {
    // An integer number is taken as a decimal amount of the currency (12 = 12.00), never as cents.
    return value * 100;
  }
  const s = String(value).trim().replace(/[€\s]/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Not a price: ${value}`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
}

/** Lines with decimal prices to engine lines with cents. */
export function toEngineLine(l) {
  return {
    sku: String(l.sku || '').trim().toUpperCase(),
    newPriceMinor: Number.isInteger(l.newPriceMinor) ? l.newPriceMinor : toMinor(l.newPrice),
    shownPriorMinor: Number.isInteger(l.shownPriorMinor) ? l.shownPriorMinor
      : (l.shownPrior != null && l.shownPrior !== '' ? toMinor(l.shownPrior) : null),
    shownPercent: l.shownPercent != null && l.shownPercent !== '' ? Number(l.shownPercent) : null,
    claimType: l.claimType || undefined,
    statementLabel: l.statementLabel || undefined,
    campaignStart: l.campaignStart || undefined,
    exemption: l.exemption || undefined,
    additionalReference: l.additionalReference || undefined,
  };
}

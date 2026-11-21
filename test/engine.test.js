// Golden cases from official texts (C-330/23 Aldi Süd press release; Commission guidance 2021/C 526/02;
// PAngV § 11), an independent brute-force oracle, metamorphic properties and window boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLine, checkPromotion, supportedPercent, maxPriceForPercent } from '../src/engine/rules.js';
import { computePrior, normalizeSeries, priceAt, InputError } from '../src/engine/prior.js';
import { PROFILES, fingerprint } from '../src/engine/profiles.js';
import { addLocalDays, parseLocal, zonedToEpoch, formatLocal, windowLabel } from '../src/engine/time.js';

const DE = PROFILES.DE;
const EU = PROFILES['EU-BASE'];
const UTCP = { ...EU, code: 'UTC-TEST', timeZone: 'UTC', status: 'custom' };
const codes = (r) => r.codes.map((c) => c.code).sort();

test('C-330/23 bananas: -23% computed from the last price, 0% from the 30-day low', () => {
  const r = checkLine({
    profile: DE, start: '2026-11-27',
    series: [{ effectiveFrom: '2026-10-01', priceMinor: 129 }, { effectiveFrom: '2026-11-20', priceMinor: 169 }],
    line: { sku: 'BANANA-1KG', newPriceMinor: 129, shownPriorMinor: 169, shownPercent: 23, claimType: 'percent' },
  });
  assert.equal(r.verdict, 'fail');
  assert.equal(r.priorMinor, 129);
  assert.deepEqual(codes(r), ['S2', 'S4', 'S5']);
  assert.equal(r.supportedPercent, 0);
  assert.equal(r.actualPercent, 0);
  assert.equal(r.maxPriceForClaimMinor, 99); // floor(129 x 0.77) = 99 cents
  assert.equal(formatLocal(r.windowStart, 'Europe/Berlin'), '2026-10-28 00:00');
  assert.equal(formatLocal(r.priorAt, 'Europe/Berlin'), '2026-10-28 00:00');
  // The window ends at the start of 27 November, so its last full day is 26 November.
  assert.equal(windowLabel(r.windowStart, r.windowEnd, 'Europe/Berlin'), '2026-10-28 to 2026-11-26');
  assert.match(r.codes.find((c) => c.code === 'S2').message, /from 2026-10-28 to 2026-11-26 was/);
  assert.equal(windowLabel(parseLocal('2026-10-28T14:00', 'UTC'), parseLocal('2026-11-27T14:00', 'UTC'), 'UTC'), '2026-10-28 14:00 to before 2026-11-27 14:00');
});

test('C-330/23 pineapples: "Preis-Highlight" at 1.49 is above the 30-day low of 1.39', () => {
  const r = checkLine({
    profile: DE, start: '2026-11-27',
    series: [{ effectiveFrom: '2026-10-01', priceMinor: 139 }, { effectiveFrom: '2026-11-20', priceMinor: 169 }],
    line: { sku: 'PINEAPPLE', newPriceMinor: 149, shownPriorMinor: 169, claimType: 'statement' },
  });
  assert.equal(r.verdict, 'fail');
  assert.deepEqual(codes(r), ['S2', 'S5']);
  assert.match(r.codes.find((c) => c.code === 'S5').message, /7\.2% above/);
});

test('Commission guidance: 30-day low 100, last price 160; "160 -> 80, -50%" supports only -20%', () => {
  const r = checkLine({
    profile: EU, start: '2026-11-27',
    series: [{ effectiveFrom: '2026-10-01', priceMinor: 10000 }, { effectiveFrom: '2026-11-10', priceMinor: 16000 }],
    line: { sku: 'X', newPriceMinor: 8000, shownPriorMinor: 16000, shownPercent: 50 },
  });
  assert.deepEqual(codes(r), ['S2', 'S4']);
  assert.equal(r.supportedPercent, 20);
  assert.equal(r.maxPriceForClaimMinor, 5000);
  const ok = checkLine({
    profile: EU, start: '2026-11-27',
    series: [{ effectiveFrom: '2026-10-01', priceMinor: 10000 }, { effectiveFrom: '2026-11-10', priceMinor: 16000 }],
    line: { sku: 'X', newPriceMinor: 5000, shownPriorMinor: 10000, shownPercent: 50 },
  });
  assert.equal(ok.verdict, 'ok');
});

test('PAngV 11(2): an uninterrupted progressive markdown keeps the price from before it began', () => {
  const series = [
    { effectiveFrom: '2026-09-01', priceMinor: 10000 },
    { effectiveFrom: '2026-11-06', priceMinor: 9000 },
    { effectiveFrom: '2026-11-13', priceMinor: 8000 },
  ];
  const line = { sku: 'JACKET', newPriceMinor: 7000, shownPriorMinor: 10000, shownPercent: 30, campaignStart: '2026-11-06' };
  const de = checkLine({ profile: DE, start: '2026-11-20', series, line });
  assert.equal(de.verdict, 'ok');
  assert.equal(de.anchoredToCampaignStart, true);
  assert.equal(de.priorMinor, 10000);
  // The EU baseline has no progressive option: the window ends at this step, so 80.00 is the prior price.
  const eu = checkLine({ profile: EU, start: '2026-11-20', series, line });
  assert.equal(eu.verdict, 'fail');
  assert.equal(eu.priorMinor, 8000);
  assert.deepEqual(codes(eu), ['S2', 'S4', 'S9']);
});

test('Guidance: reduced prices of an earlier campaign count in the next window', () => {
  const series = [
    { effectiveFrom: '2026-09-01', priceMinor: 10000 },
    { effectiveFrom: '2026-11-01', priceMinor: 9000 },
    { effectiveFrom: '2026-11-08', priceMinor: 8000 },
    { effectiveFrom: '2026-11-15', priceMinor: 7000 },
    { effectiveFrom: '2026-11-22', priceMinor: 10000 },
  ];
  const line = { sku: 'JACKET-B', newPriceMinor: 7000, shownPriorMinor: 10000, shownPercent: 30 };
  const r = checkLine({ profile: DE, start: '2026-11-27', series, line });
  assert.equal(r.priorMinor, 7000);
  assert.deepEqual(codes(r), ['S2', 'S4', 'S5']);
  // Claiming it continues the campaign does not help: the price went back up on 2026-11-22.
  const r2 = checkLine({ profile: DE, start: '2026-11-27', series, line: { ...line, campaignStart: '2026-11-01' } });
  assert.deepEqual(codes(r2), ['S2', 'S4', 'S5', 'S9']);
  assert.match(r2.codes.find((c) => c.code === 'S9').message, /went back up on 2026-11-2[12]/);
});

test('A Halloween price still in the window makes a Cyber Monday "-25%" a price rise', () => {
  const r = checkLine({
    profile: EU, start: '2026-11-30',
    series: [
      { effectiveFrom: '2026-09-01', priceMinor: 39900 },
      { effectiveFrom: '2026-10-24', priceMinor: 27900 },
      { effectiveFrom: '2026-11-01', priceMinor: 39900 },
    ],
    line: { sku: 'ESPRESSO', newPriceMinor: 29900, shownPriorMinor: 39900, shownPercent: 25 },
  });
  assert.equal(r.priorMinor, 27900);
  assert.deepEqual(codes(r), ['S2', 'S4', 'S5']);
  assert.match(r.codes.find((c) => c.code === 'S5').message, /7\.2% above/);
});

test('Honest claims pass: -12% at 12.5%, -15% at 15.4%', () => {
  const tv = checkLine({ profile: EU, start: '2026-11-30', series: [{ effectiveFrom: '2026-09-01', priceMinor: 79900 }],
    line: { sku: 'TV', newPriceMinor: 69900, shownPriorMinor: 79900, shownPercent: 12 } });
  assert.equal(tv.verdict, 'ok');
  assert.equal(tv.actualPercent, 12.5);
  const coffee = checkLine({ profile: DE, start: '2026-11-27', series: [{ effectiveFrom: '2026-09-01', priceMinor: 1299 }],
    line: { sku: 'COFFEE', newPriceMinor: 1099, shownPriorMinor: 1299, shownPercent: 15 } });
  assert.equal(coffee.verdict, 'ok');
  assert.equal(coffee.supportedPercent, 15);
  assert.equal(coffee.labels.de.replace(/\u00a0/g, ' '), '−15 % 10,99 € · Niedrigster Preis der letzten 30 Tage: 12,99 €');
});

test('A product launched inside the window cannot be verified without a new-product option', () => {
  const launchedAt = parseLocal('2026-11-15', EU.timeZone);
  const r = checkLine({ profile: EU, start: '2026-11-27', product: { launchedAt },
    series: [{ effectiveFrom: '2026-11-15', priceMinor: 14900 }],
    line: { sku: 'HEADPHONES', newPriceMinor: 11900, shownPriorMinor: 14900, shownPercent: 20 } });
  assert.equal(r.verdict, 'cannot-verify');
  assert.deepEqual(codes(r), ['S6']);
  const withOption = { ...EU, newProductShorterWindow: { enabled: true } };
  const r2 = checkLine({ profile: withOption, start: '2026-11-27', product: { launchedAt },
    series: [{ effectiveFrom: '2026-11-15', priceMinor: 14900 }],
    line: { sku: 'HEADPHONES', newPriceMinor: 11900, shownPriorMinor: 14900, shownPercent: 20 } });
  assert.equal(r2.verdict, 'ok');
});

test('History that starts after the window start cannot be verified', () => {
  const r = checkLine({ profile: DE, start: '2026-11-27', series: [{ effectiveFrom: '2026-11-10', priceMinor: 500 }],
    line: { sku: 'S', newPriceMinor: 400, shownPriorMinor: 500, shownPercent: 20 } });
  assert.equal(r.verdict, 'cannot-verify');
});

test('PAngV 11(4) no. 2: perishables are exempt only with a notice', () => {
  const series = [{ effectiveFrom: '2026-10-01', priceMinor: 299 }];
  const base = { sku: 'SALAD', newPriceMinor: 149, shownPercent: 50 };
  const ex = checkLine({ profile: DE, start: '2026-11-27', series, line: { ...base, exemption: { type: 'perishable', noticeText: 'Best before today' } } });
  assert.equal(ex.verdict, 'exempt');
  const noNotice = checkLine({ profile: DE, start: '2026-11-27', series, line: { ...base, exemption: { type: 'perishable' } } });
  assert.deepEqual(codes(noNotice), ['S1', 'S7']);
  const eu = checkLine({ profile: EU, start: '2026-11-27', series, line: { ...base, exemption: { type: 'perishable', noticeText: 'x' } } });
  assert.equal(eu.verdict, 'fail');
});

test('No announced reduction needs no prior price', () => {
  const r = checkLine({ profile: DE, start: '2026-11-27', series: [{ effectiveFrom: '2026-10-01', priceMinor: 999 }],
    line: { sku: 'P', newPriceMinor: 899 } });
  assert.equal(r.verdict, 'ok');
  assert.deepEqual(codes(r), ['S0']);
});

test('A lower shown prior price is a warning, an extra reference price is information', () => {
  const r = checkLine({ profile: DE, start: '2026-11-27', series: [{ effectiveFrom: '2026-10-01', priceMinor: 1000 }],
    line: { sku: 'P', newPriceMinor: 800, shownPriorMinor: 950, additionalReference: { label: 'RRP', priceMinor: 1200 } } });
  assert.equal(r.verdict, 'warn');
  assert.deepEqual(codes(r), ['S3', 'S8']);
});

test('Window boundaries: a segment starting at the window start counts, one ending there does not', () => {
  const start = parseLocal('2026-11-27', 'UTC');
  const ws = addLocalDays(start, 'UTC', -30);
  const endsAtStart = normalizeSeries([{ effectiveFrom: ws - 86400000, priceMinor: 50 }, { effectiveFrom: ws, priceMinor: 100 }], 'UTC');
  assert.equal(computePrior({ series: endsAtStart, profile: UTCP, start }).priorMinor, 100);
  const startsAt = normalizeSeries([{ effectiveFrom: ws - 86400000, priceMinor: 120 }, { effectiveFrom: ws, priceMinor: 60 }], 'UTC');
  assert.equal(computePrior({ series: startsAt, profile: UTCP, start }).priorMinor, 60);
  const atEnd = normalizeSeries([{ effectiveFrom: ws - 1, priceMinor: 100 }, { effectiveFrom: start, priceMinor: 10 }], 'UTC');
  assert.equal(computePrior({ series: atEnd, profile: UTCP, start }).priorMinor, 100);
});

test('Daylight saving: 30 calendar days in Berlin across 2026-10-25', () => {
  const start = zonedToEpoch({ year: 2026, month: 11, day: 20 }, 'Europe/Berlin');
  const ws = addLocalDays(start, 'Europe/Berlin', -30);
  assert.equal(formatLocal(ws, 'Europe/Berlin'), '2026-10-21 00:00');
  assert.equal(start - ws, 30 * 86400000 + 3600000); // one extra hour because the clocks went back
});

test('Percent helpers use floor and whole cents', () => {
  assert.equal(supportedPercent(1299, 1099), 15);
  assert.equal(supportedPercent(100, 100), 0);
  assert.equal(supportedPercent(100, 120), 0);
  assert.equal(maxPriceForPercent(129, 23), 99);
  assert.equal(maxPriceForPercent(10000, 50), 5000);
  assert.equal(maxPriceForPercent(1999, 10), 1799);
});

test('Invalid input is rejected, not guessed', () => {
  assert.throws(() => normalizeSeries([{ effectiveFrom: '2026-10-01', priceMinor: 1.5 }], 'UTC'), InputError);
  assert.throws(() => normalizeSeries([{ effectiveFrom: '2026-10-01', priceMinor: 100 }, { effectiveFrom: '2026-10-01', priceMinor: 200 }], 'UTC'), InputError);
  assert.throws(() => checkLine({ profile: DE, start: '2026-11-27', series: [], line: { sku: 'A', newPriceMinor: -1 } }), InputError);
  assert.throws(() => checkLine({ profile: DE, start: '2026-11-27', series: [], line: { sku: 'A', newPriceMinor: 100, shownPercent: 120 } }), InputError);
});

test('checkPromotion: counts, blocking lines, unknown SKU and stable fingerprints', () => {
  const promotion = {
    market: 'DE', startsAt: '2026-11-27',
    lines: [
      { sku: 'BANANA-1KG', newPriceMinor: 129, shownPriorMinor: 169, shownPercent: 23 },
      { sku: 'COFFEE', newPriceMinor: 1099, shownPriorMinor: 1299, shownPercent: 15 },
      { sku: 'GHOST', newPriceMinor: 100, shownPriorMinor: 200 },
    ],
  };
  const seriesBySku = {
    'BANANA-1KG': [{ effectiveFrom: '2026-10-01', priceMinor: 129 }, { effectiveFrom: '2026-11-20', priceMinor: 169 }],
    COFFEE: [{ effectiveFrom: '2026-09-01', priceMinor: 1299 }],
  };
  const r = checkPromotion({ promotion, profile: DE, seriesBySku, now: 0 });
  assert.equal(r.overall, 'fail');
  assert.deepEqual(r.counts, { fail: 1, warn: 0, ok: 1, cannotVerify: 1, exempt: 0 });
  assert.equal(r.blocking, 2);
  const again = checkPromotion({ promotion, profile: DE, seriesBySku, now: 1 });
  assert.equal(again.dataHash, r.dataHash);
  assert.equal(again.profileHash, r.profileHash);
  assert.notEqual(fingerprint({ a: 1, b: { c: 2 } }), fingerprint({ a: 1, b: { c: 3 } }));
});

// Oracle A: an independent path. Sample every change instant and every hour in the window, look the price up by
// linear scan, take the minimum, and compare with the segment-overlap engine.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('Oracle A: segment engine equals brute-force minimum on 2,000 random series', () => {
  const rnd = mulberry32(20261120);
  const H = 3600000;
  for (let k = 0; k < 2000; k++) {
    const tz = rnd() < 0.5 ? 'Europe/Berlin' : 'UTC';
    const profile = { ...UTCP, timeZone: tz };
    const start = zonedToEpoch({ year: 2026, month: 10 + Math.floor(rnd() * 3), day: 1 + Math.floor(rnd() * 28), hour: Math.floor(rnd() * 24) }, tz);
    const first = start - (31 + Math.floor(rnd() * 40)) * 24 * H;
    const n = 1 + Math.floor(rnd() * 12);
    const raw = [{ effectiveFrom: first, priceMinor: 100 + Math.floor(rnd() * 900) }];
    for (let i = 1; i < n; i++) raw.push({ effectiveFrom: first + Math.floor(rnd() * (start - first + 10 * 24 * H)), priceMinor: 100 + Math.floor(rnd() * 900) });
    const series = normalizeSeries(raw, tz);
    const got = computePrior({ series, profile, start });
    const ws = addLocalDays(start, tz, -30);
    const points = new Set();
    for (let t = ws; t < start; t += H) points.add(t);
    for (const r of series) if (r.effectiveFrom >= ws && r.effectiveFrom < start) points.add(r.effectiveFrom);
    let min = Infinity;
    for (const t of points) {
      const p = priceAt(series, t);
      if (p !== null && p < min) min = p;
    }
    assert.equal(got.status, 'ok');
    assert.equal(got.priorMinor, min, `case ${k}`);
  }
});

test('Metamorphic: higher prices never lower the prior price; a lower one inside the window sets it; shifting time changes nothing', () => {
  const rnd = mulberry32(7);
  const D = 86400000;
  for (let k = 0; k < 300; k++) {
    const start = parseLocal('2026-11-27', 'UTC') + Math.floor(rnd() * 20) * D;
    const series = normalizeSeries([
      { effectiveFrom: start - 60 * D, priceMinor: 500 + Math.floor(rnd() * 500) },
      { effectiveFrom: start - Math.floor(rnd() * 50) * D - D, priceMinor: 500 + Math.floor(rnd() * 500) },
    ], 'UTC');
    const base = computePrior({ series, profile: UTCP, start }).priorMinor;
    const higher = normalizeSeries([...series, { effectiveFrom: start - 5 * D + 1234, priceMinor: 5000 }], 'UTC');
    assert.ok(computePrior({ series: higher, profile: UTCP, start }).priorMinor <= Math.max(base, 5000));
    const lower = normalizeSeries([...series, { effectiveFrom: start - 10 * D + 1234, priceMinor: 10 }], 'UTC');
    assert.equal(computePrior({ series: lower, profile: UTCP, start }).priorMinor, 10);
    const shift = 7 * D;
    const moved = series.map((r) => ({ ...r, effectiveFrom: r.effectiveFrom + shift }));
    assert.equal(computePrior({ series: moved, profile: UTCP, start: start + shift }).priorMinor, base);
  }
});

// The Commission's sweeps page (commission.europa.eu, "2022 - Sweep on Black Friday sales", read 2026-11-20) gives two
// worked examples from Black Friday 2022 (25 November). The page names 27.99 as the 30-day low in the first example
// without saying when it applied; the test models it as the "discounted" price that ended on 2 November.
test('Commission sweep example 1: "-40%" against 39.99, but the 30-day low was 27.99, so 14% at most', () => {
  const series = [
    { effectiveFrom: '2022-10-01', priceMinor: 2799 },
    { effectiveFrom: '2022-11-03', priceMinor: 3999 },
  ];
  const r = checkLine({ profile: EU, start: '2022-11-25', series, line: { sku: 'SWEEP-1', newPriceMinor: 2399, shownPriorMinor: 3999, shownPercent: 40, claimType: 'percent' } });
  assert.equal(r.verdict, 'fail');
  assert.equal(r.priorMinor, 2799);
  assert.deepEqual(codes(r), ['S2', 'S4']);
  assert.equal(r.supportedPercent, 14); // the page: "the discount rate displayed should have been 14%"
  assert.equal(r.maxPriceForClaimMinor, 1679); // the price that would support the claimed 40%
});

test('Commission sweep example 2: a rise from 19.48 to 21.66 shown as "-24%" against a fake 28.81', () => {
  const series = [{ effectiveFrom: '2022-10-01', priceMinor: 1948 }];
  const r = checkLine({ profile: EU, start: '2022-11-25', series, line: { sku: 'SWEEP-2', newPriceMinor: 2166, shownPriorMinor: 2881, shownPercent: 24, claimType: 'percent' } });
  assert.equal(r.verdict, 'fail');
  assert.equal(r.priorMinor, 1948);
  assert.deepEqual(codes(r), ['S2', 'S4', 'S5']);
  assert.equal(r.actualPercent, -11.2); // the page: "a price increase of 11%"
});

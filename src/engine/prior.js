// The prior price: the lowest price the trader applied in the window before a reduction
// (Directive 98/6/EC Art. 6a(1)-(2); PAngV § 11(1)). Prices are integers in minor units (cents); instants are
// UTC epoch milliseconds. A price change applies from its instant until the next change.

import { addLocalDays, parseLocal, formatLocal } from './time.js';

export class InputError extends Error {}

/** Validate, sort and de-duplicate a price series: [{effectiveFrom, priceMinor}]. */
export function normalizeSeries(series, timeZone) {
  if (!Array.isArray(series)) throw new InputError('Price history must be a list.');
  const rows = series.map((r, i) => {
    const at = typeof r.effectiveFrom === 'number' ? r.effectiveFrom : parseLocal(r.effectiveFrom, timeZone);
    const price = r.priceMinor;
    if (!Number.isFinite(at)) throw new InputError(`Row ${i + 1}: the date is not valid.`);
    if (!Number.isInteger(price) || price < 0) throw new InputError(`Row ${i + 1}: the price must be a whole number of cents, 0 or more.`);
    return { effectiveFrom: at, priceMinor: price };
  });
  rows.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.effectiveFrom === r.effectiveFrom) {
      if (last.priceMinor !== r.priceMinor) {
        throw new InputError(`Two different prices start at the same moment (${new Date(r.effectiveFrom).toISOString()}).`);
      }
      continue;
    }
    out.push(r);
  }
  return out;
}

/** Segments [start, end) with their price; the last one is open-ended. */
export function segments(series) {
  return series.map((r, i) => ({
    start: r.effectiveFrom,
    end: i + 1 < series.length ? series[i + 1].effectiveFrom : Infinity,
    priceMinor: r.priceMinor,
  }));
}

/** Price in effect at an instant, or null before the first record. */
export function priceAt(series, instant) {
  let price = null;
  for (const r of series) {
    if (r.effectiveFrom <= instant) price = r.priceMinor;
    else break;
  }
  return price;
}

/**
 * Checks that a progressive campaign ran without interruption from its first reduction until `start`:
 * the first step lowered the price, no later step raised it, and the new promotion price does not raise it.
 */
export function campaignContinuity(series, campaignStart, start, newPriceMinor) {
  const before = priceAt(series, campaignStart - 1);
  const atStart = priceAt(series, campaignStart);
  if (atStart === null) return { ok: false, reason: 'No price is recorded at the campaign start.' };
  if (before === null || !(atStart < before)) {
    return { ok: false, reason: 'The price did not go down at the campaign start, so it was not the first reduction.' };
  }
  let last = atStart;
  for (const r of series) {
    if (r.effectiveFrom <= campaignStart || r.effectiveFrom >= start) continue;
    if (r.priceMinor > last) {
      return { ok: false, reason: `The price went back up on ${new Date(r.effectiveFrom).toISOString().slice(0, 10)}, so the campaign was interrupted.` };
    }
    last = r.priceMinor;
  }
  if (Number.isInteger(newPriceMinor) && newPriceMinor > last) {
    return { ok: false, reason: 'The new promotion price is higher than the previous step, so it does not continue the reduction.' };
  }
  return { ok: true, reason: '' };
}

/**
 * Lowest price in the window before the reduction.
 * Returns { status: 'ok', priorMinor, priorAt, windowStart, windowEnd, anchoredToCampaignStart, notes[] }
 * or { status: 'cannot-verify', reason, windowStart, windowEnd, notes[] }.
 */
export function computePrior({ series, profile, product = {}, start, campaignStart = null, newPriceMinor = null }) {
  const tz = profile.timeZone;
  const notes = [];
  let anchor = start;
  let anchored = false;
  if (campaignStart !== null && campaignStart !== undefined && campaignStart !== '') {
    const cs = typeof campaignStart === 'number' ? campaignStart : parseLocal(campaignStart, tz);
    if (!profile.progressive?.enabled) {
      notes.push({ code: 'S9', key: 'CAMPAIGN_NOT_RECOGNISED', level: 'warn',
        message: `The ${profile.code} profile does not use the progressive-reduction rule, so the window was taken before this promotion.` });
    } else if (cs >= start) {
      notes.push({ code: 'S9', key: 'CAMPAIGN_BROKEN', level: 'warn', message: 'The campaign start is not before the promotion start.' });
    } else {
      const c = campaignContinuity(series, cs, start, newPriceMinor);
      if (c.ok) {
        anchor = cs;
        anchored = true;
      } else {
        notes.push({ code: 'S9', key: 'CAMPAIGN_BROKEN', level: 'warn', message: `${c.reason} The window was taken before this promotion instead.` });
      }
    }
  }
  const windowEnd = anchor;
  let windowStart = addLocalDays(anchor, tz, -profile.windowDays);
  if (Number.isFinite(product.launchedAt) && product.launchedAt > windowStart) {
    if (profile.newProductShorterWindow?.enabled) {
      notes.push({ code: 'S10', key: 'NEW_PRODUCT_WINDOW', level: 'info',
        message: `The product launched on ${formatLocal(product.launchedAt, tz, false)}, so the window starts at launch.` });
      windowStart = product.launchedAt;
    } else {
      return { status: 'cannot-verify', windowStart, windowEnd, anchoredToCampaignStart: anchored, notes,
        reason: `The product launched on ${formatLocal(product.launchedAt, tz, false)}, inside the ${profile.windowDays}-day window, and the ${profile.code} profile has no shorter period for new products.` };
    }
  }
  if (!series.length || series[0].effectiveFrom > windowStart) {
    const from = series.length ? formatLocal(series[0].effectiveFrom, tz) : 'nowhere';
    return { status: 'cannot-verify', windowStart, windowEnd, anchoredToCampaignStart: anchored, notes,
      reason: `The price history starts ${series.length ? `on ${from}` : 'nowhere'}, after the window start ${formatLocal(windowStart, tz)}.` };
  }
  let prior = Infinity;
  let priorAt = null;
  const inWindow = [];
  for (const s of segments(series)) {
    if (s.start < windowEnd && s.end > windowStart) {
      const from = Math.max(s.start, windowStart);
      inWindow.push({ from, to: Math.min(s.end, windowEnd), priceMinor: s.priceMinor });
      if (s.priceMinor < prior) {
        prior = s.priceMinor;
        priorAt = from;
      }
    }
  }
  return { status: 'ok', priorMinor: prior, priorAt, windowStart, windowEnd, anchoredToCampaignStart: anchored, notes, inWindow };
}

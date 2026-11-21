// Line and promotion verdicts. Every number comes from code; nothing here calls a model.
// Codes: S1 prior missing, S2 reference overstated, S3 reference understated, S4 percent overstated,
// S5 no reduction, S6 cannot verify, S7 exempt, S8 additional reference, S9 campaign, S10 new product.

import { computePrior, normalizeSeries, InputError } from './prior.js';
import { fingerprint } from './profiles.js';
import { parseLocal, formatLocal, windowLabel } from './time.js';

export const ENGINE_VERSION = '1.0.0';
const CLAIM_TYPES = new Set(['percent', 'was-now', 'statement', 'none']);

export function formatMoney(minor, currency = 'EUR', locale = 'en-IE') {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}

/** Largest whole percentage the prior price supports (floor), 0 when there is no reduction. */
export function supportedPercent(priorMinor, newPriceMinor) {
  if (!(newPriceMinor < priorMinor) || priorMinor <= 0) return 0;
  return Math.floor((100 * (priorMinor - newPriceMinor)) / priorMinor);
}

/** Highest new price that still supports a claimed percentage against the prior price. */
export function maxPriceForPercent(priorMinor, percent) {
  return Math.floor((priorMinor * (100 - percent)) / 100 + 1e-9);
}

function cleanLine(line) {
  const sku = String(line.sku || '').trim();
  if (!sku) throw new InputError('Every line needs a SKU.');
  const newPriceMinor = line.newPriceMinor;
  if (!Number.isInteger(newPriceMinor) || newPriceMinor < 0) throw new InputError(`${sku}: the new price must be a whole number of cents.`);
  const shownPriorMinor = line.shownPriorMinor ?? null;
  if (shownPriorMinor !== null && (!Number.isInteger(shownPriorMinor) || shownPriorMinor < 0)) {
    throw new InputError(`${sku}: the shown prior price must be a whole number of cents.`);
  }
  const shownPercent = line.shownPercent ?? null;
  if (shownPercent !== null && (!Number.isFinite(shownPercent) || shownPercent <= 0 || shownPercent >= 100)) {
    throw new InputError(`${sku}: the shown percentage must be between 0 and 100.`);
  }
  let claimType = line.claimType || (shownPercent !== null ? 'percent' : shownPriorMinor !== null ? 'was-now' : 'none');
  if (!CLAIM_TYPES.has(claimType)) throw new InputError(`${sku}: unknown claim type ${claimType}.`);
  return { ...line, sku, newPriceMinor, shownPriorMinor, shownPercent, claimType };
}

function exemptionApplies(line, profile) {
  const ex = line.exemption;
  if (!ex || !ex.type) return { applies: false };
  if (ex.type === 'perishable') {
    const rule = profile.perishableExemption;
    if (!rule?.enabled) return { applies: false, why: `The ${profile.code} profile has no exemption for perishable goods.` };
    if (rule.requiresNotice && !String(ex.noticeText || '').trim()) {
      return { applies: false, why: 'The perishable-goods exemption needs a notice telling customers why the price was cut.' };
    }
    return { applies: true, rule };
  }
  if (ex.type === 'individual') {
    const rule = profile.individualExemption;
    if (!rule?.enabled) return { applies: false, why: `The ${profile.code} profile has no exemption for individual reductions.` };
    return { applies: true, rule };
  }
  return { applies: false, why: `Unknown exemption type ${ex.type}.` };
}

function verdictOf(codes) {
  if (codes.some((c) => c.level === 'fail')) return 'fail';
  if (codes.some((c) => c.level === 'warn')) return 'warn';
  return 'ok';
}

/** Checks one promotion line. `start` is an epoch or a local date string in the profile's time zone. */
export function checkLine({ series = [], profile, product = {}, line, start }) {
  const l = cleanLine(line);
  const tz = profile.timeZone;
  const startMs = typeof start === 'number' ? start : parseLocal(start, tz);
  const s = normalizeSeries(series, tz);
  const money = (m) => formatMoney(m, profile.currency, 'en-IE');
  const result = {
    sku: l.sku, name: product.name || l.name || l.sku, claimType: l.claimType,
    newPriceMinor: l.newPriceMinor, shownPriorMinor: l.shownPriorMinor, shownPercent: l.shownPercent,
    priorMinor: null, priorAt: null, windowStart: null, windowEnd: null, anchoredToCampaignStart: false,
    actualPercent: null, supportedPercent: null, maxPriceForClaimMinor: null, codes: [], suggestions: [], labels: {},
  };
  const announced = l.claimType !== 'none' || l.shownPercent !== null || l.shownPriorMinor !== null;
  const ex = exemptionApplies(l, profile);
  if (ex.applies) {
    result.codes.push({ code: 'S7', key: 'EXEMPT', level: 'ok', message: `Exempt under the ${profile.code} profile: ${ex.rule.note}`, source: ex.rule.source });
    result.verdict = 'exempt';
    return result;
  }
  if (l.exemption?.type) result.codes.push({ code: 'S7', key: 'EXEMPTION_NOT_APPLICABLE', level: 'warn', message: ex.why });

  const prior = computePrior({ series: s, profile, product, start: startMs, campaignStart: l.campaignStart ?? null, newPriceMinor: l.newPriceMinor });
  result.windowStart = prior.windowStart;
  result.windowEnd = prior.windowEnd;
  result.anchoredToCampaignStart = prior.anchoredToCampaignStart;
  result.codes.push(...prior.notes);
  if (!announced) {
    if (prior.status === 'ok') result.priorMinor = prior.priorMinor;
    result.codes.push({ code: 'S0', key: 'NO_REDUCTION_ANNOUNCED', level: 'ok', message: 'No reduction is announced, so no prior price is needed.' });
    result.verdict = verdictOf(result.codes);
    return result;
  }
  if (prior.status !== 'ok') {
    result.codes.push({ code: 'S6', key: 'CANNOT_VERIFY', level: 'fail', message: `${prior.reason} Do not publish this reduction until the history covers the window.` });
    result.verdict = 'cannot-verify';
    return result;
  }
  const P = prior.priorMinor;
  const N = l.newPriceMinor;
  result.priorMinor = P;
  result.priorAt = prior.priorAt;
  result.inWindow = prior.inWindow;
  result.supportedPercent = supportedPercent(P, N);
  result.actualPercent = P > 0 ? Math.round((1000 * (P - N)) / P) / 10 : 0;
  const window = windowLabel(prior.windowStart, prior.windowEnd, tz);

  if (l.shownPriorMinor === null) {
    result.codes.push({ code: 'S1', key: 'PRIOR_MISSING', level: 'fail', message: `A reduction is announced but no prior price is shown. The prior price is ${money(P)} (lowest from ${window}).` });
  } else if (l.shownPriorMinor > P) {
    result.codes.push({ code: 'S2', key: 'REFERENCE_OVERSTATED', level: 'fail', message: `Shows ${money(l.shownPriorMinor)} as the prior price, but the lowest price from ${window} was ${money(P)}.` });
  } else if (l.shownPriorMinor < P) {
    result.codes.push({ code: 'S3', key: 'REFERENCE_UNDERSTATED', level: 'warn', message: `Shows ${money(l.shownPriorMinor)}, below the prior price ${money(P)}. It is not the prior price; check what it is meant to be.` });
  }
  if (N >= P) {
    const pct = P > 0 ? Math.round((1000 * (N - P)) / P) / 10 : 0;
    result.codes.push({ code: 'S5', key: 'NO_REDUCTION', level: 'fail', message: N === P
      ? `The new price ${money(N)} equals the prior price ${money(P)}: there is no reduction to announce.`
      : `The new price ${money(N)} is ${pct}% above the prior price ${money(P)}: there is no reduction to announce.` });
  }
  if (l.shownPercent !== null) {
    result.maxPriceForClaimMinor = maxPriceForPercent(P, l.shownPercent);
    if (l.shownPercent > result.supportedPercent) {
      result.codes.push({ code: 'S4', key: 'PERCENT_OVERSTATED', level: 'fail',
        message: `Claims −${l.shownPercent}%, but against the prior price ${money(P)} ${result.actualPercent > 0 ? `the cut is ${result.actualPercent}%` : 'there is no cut'}. For −${l.shownPercent}% the price must be at most ${money(result.maxPriceForClaimMinor)}.` });
    }
  }
  if (l.additionalReference && Number.isInteger(l.additionalReference.priceMinor)) {
    result.codes.push({ code: 'S8', key: 'ADDITIONAL_REFERENCE', level: 'info',
      message: `Also shows ${l.additionalReference.label || 'another reference price'} ${money(l.additionalReference.priceMinor)}. It must be clearly explained and must not be confused with the prior price.` });
  }
  result.verdict = verdictOf(result.codes);
  result.suggestions = suggestions(result, profile);
  result.labels = labels(result, profile);
  return result;
}

function suggestions(r, profile) {
  if (r.verdict === 'ok') return [];
  const money = (m) => formatMoney(m, profile.currency, 'en-IE');
  const out = [];
  if (r.newPriceMinor < r.priorMinor) {
    out.push({ fix: 'show-prior', text: `Show ${money(r.priorMinor)} as the prior price${r.supportedPercent > 0 ? ` and claim at most −${r.supportedPercent}%` : ''}.` });
  } else {
    out.push({ fix: 'remove-claim', text: `Remove the reduction claim: at ${money(r.newPriceMinor)} there is no cut against ${money(r.priorMinor)}.` });
  }
  if (r.shownPercent !== null && r.maxPriceForClaimMinor !== null && r.maxPriceForClaimMinor < r.newPriceMinor) {
    const showPrior = r.shownPriorMinor !== r.priorMinor ? ` and show ${money(r.priorMinor)} as the prior price` : '';
    out.push({ fix: 'set-price', text: `Keep −${r.shownPercent}%: set the price to ${money(r.maxPriceForClaimMinor)} (or less)${showPrior}.` });
  }
  return out;
}

function labels(r, profile) {
  const en = (m) => formatMoney(m, profile.currency, 'en-IE');
  const de = (m) => formatMoney(m, profile.currency, 'de-DE');
  const days = profile.windowDays;
  if (r.newPriceMinor >= r.priorMinor) return { en: en(r.newPriceMinor), de: de(r.newPriceMinor) };
  const pct = r.shownPercent !== null && r.shownPercent <= r.supportedPercent ? r.shownPercent : r.supportedPercent;
  return {
    en: `${pct > 0 ? `−${pct}% ` : ''}${en(r.newPriceMinor)} · Lowest price in the last ${days} days: ${en(r.priorMinor)}`,
    de: `${pct > 0 ? `−${pct} % ` : ''}${de(r.newPriceMinor)} · Niedrigster Preis der letzten ${days} Tage: ${de(r.priorMinor)}`,
  };
}

/**
 * Checks every line of a promotion.
 * promotion: { market, startsAt, lines[] }; products: { sku: {name, launchedAt} }; seriesBySku: { sku: [...] }.
 */
export function checkPromotion({ promotion, profile, products = {}, seriesBySku = {}, now = Date.now() }) {
  if (!profile) throw new InputError(`Unknown market ${promotion?.market}. Set up a market profile first.`);
  if (!promotion || !Array.isArray(promotion.lines) || !promotion.lines.length) throw new InputError('The promotion has no lines.');
  const start = typeof promotion.startsAt === 'number' ? promotion.startsAt : parseLocal(promotion.startsAt, profile.timeZone);
  const lines = promotion.lines.map((line) => {
    const sku = String(line.sku || '').trim();
    const series = seriesBySku[sku] || [];
    try {
      return checkLine({ series, profile, product: products[sku] || {}, line, start });
    } catch (e) {
      if (!(e instanceof InputError)) throw e;
      return { sku, name: products[sku]?.name || sku, verdict: 'cannot-verify', codes: [{ code: 'S6', key: 'INVALID_LINE', level: 'fail', message: e.message }], suggestions: [], labels: {} };
    }
  });
  const counts = { fail: 0, warn: 0, ok: 0, cannotVerify: 0, exempt: 0 };
  for (const l of lines) {
    if (l.verdict === 'fail') counts.fail += 1;
    else if (l.verdict === 'warn') counts.warn += 1;
    else if (l.verdict === 'cannot-verify') counts.cannotVerify += 1;
    else if (l.verdict === 'exempt') counts.exempt += 1;
    else counts.ok += 1;
  }
  const overall = counts.fail || counts.cannotVerify ? 'fail' : counts.warn ? 'warn' : 'ok';
  const usedSeries = Object.fromEntries(lines.map((l) => [l.sku, seriesBySku[l.sku] || []]));
  return {
    engineVersion: ENGINE_VERSION,
    market: profile.code,
    profileStatus: profile.status,
    profileHash: fingerprint(profile),
    dataHash: fingerprint({ lines: promotion.lines, series: usedSeries, startsAt: start }),
    startsAt: start,
    checkedAt: now,
    overall,
    counts,
    blocking: counts.fail + counts.cannotVerify,
    lines,
  };
}

/** One-off check for an agent or MCP client: no promotion needed. */
export function checkClaim({ series, profile, product, date, newPriceMinor, shownPriorMinor = null, shownPercent = null, claimType, campaignStart = null }) {
  return checkLine({ series, profile, product, start: date, line: { sku: product?.sku || 'item', newPriceMinor, shownPriorMinor, shownPercent, claimType, campaignStart } });
}

// Struck's services: load a promotion from its work item, check it with the engine, store the result on the work
// item (issue property "struck", indexed for JQL), explain lines, apply computed fixes and create fix tasks.
// The engine decides; nothing here asks a model.

import { checkPromotion, checkClaim, formatMoney, ENGINE_VERSION } from '../engine/rules.js';
import { computePrior, normalizeSeries, InputError } from '../engine/prior.js';
import { getProfile, PROFILES, SOURCES } from '../engine/profiles.js';
import { parseLocal, formatLocal, windowLabel } from '../engine/time.js';
import { toEngineLine, toMinor } from '../engine/demo.js';
import * as kv from '../store/kv.js';
import { getItem, setProperty, createItem, adfText } from '../platform/jira.js';

export { InputError };
export const MARKETS = Object.keys(PROFILES);
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?$/;

const money = (minor, profile) => formatMoney(minor, profile?.currency ?? 'EUR', 'en-IE');

export function profileOut(profile) {
  return {
    code: profile.code,
    name: profile.name,
    status: profile.status,
    timeZone: profile.timeZone,
    windowDays: profile.windowDays,
    options: {
      progressiveReductions: profile.progressive.enabled,
      perishableExemption: profile.perishableExemption.enabled,
      individualExemption: profile.individualExemption.enabled,
      newProductShorterWindow: profile.newProductShorterWindow.enabled,
    },
    notes: [profile.progressive.note, profile.perishableExemption.note, profile.individualExemption.note, profile.newProductShorterWindow.note],
    sources: profile.sources.map((id) => SOURCES[id]).filter(Boolean),
  };
}

/** Price histories and product facts for the SKUs of one market. */
async function marketData(market, skus) {
  const seriesBySku = {};
  const products = {};
  for (const sku of new Set(skus)) {
    const rec = await kv.getSeries(market, sku);
    if (!rec) continue;
    seriesBySku[sku] = rec.rows;
    products[sku] = { sku, name: rec.name, launchedAt: rec.launchedAt ?? undefined };
  }
  return { seriesBySku, products };
}

export function lineOut(line, profile) {
  const tz = profile.timeZone;
  return {
    sku: line.sku,
    product: line.name,
    verdict: line.verdict,
    codes: line.codes.map(({ code, key, level, message }) => ({ code, key, level, message })),
    newPrice: money(line.newPriceMinor, profile),
    shownPrior: line.shownPriorMinor == null ? null : money(line.shownPriorMinor, profile),
    shownPercent: line.shownPercent ?? null,
    claimType: line.claimType ?? null,
    priorPrice: line.priorMinor == null ? null : money(line.priorMinor, profile),
    priorPriceFrom: line.priorAt == null ? null : formatLocal(line.priorAt, tz, false),
    window: line.windowStart == null ? null : windowLabel(line.windowStart, line.windowEnd, tz),
    anchoredToCampaignStart: Boolean(line.anchoredToCampaignStart),
    realCutPercent: line.actualPercent ?? null,
    supportedPercent: line.supportedPercent ?? null,
    maxPriceForClaim: line.maxPriceForClaimMinor == null ? null : money(line.maxPriceForClaimMinor, profile),
    suggestions: line.suggestions ?? [],
    labels: line.labels ?? {},
  };
}

export function resultOut(result, profile, extra = {}) {
  return {
    ...extra,
    market: profile.code,
    profile: profile.name,
    profileStatus: profile.status,
    startsAt: formatLocal(result.startsAt, profile.timeZone),
    overall: result.overall,
    counts: result.counts,
    blockingLines: result.blocking,
    lines: result.lines.map((l) => lineOut(l, profile)),
    sources: profile.sources.map((id) => SOURCES[id]?.title).filter(Boolean),
    engineVersion: result.engineVersion,
    checkedAt: new Date(result.checkedAt).toISOString(),
    note: 'Computed by Struck from the stored price history and the market profile. Not legal advice.',
  };
}

/** Checks a promotion object { market, startsAt, lines (engine format) }. */
export async function evaluate(promo) {
  const profile = getProfile(promo?.market);
  if (!profile) return { ok: false, error: `Unknown market "${promo?.market}". Use one of: ${MARKETS.join(', ')}.` };
  if (!promo.lines?.length) return { ok: false, error: 'This promotion has no lines yet.', profile };
  const { seriesBySku, products } = await marketData(profile.code, promo.lines.map((l) => l.sku));
  const result = checkPromotion({ promotion: promo, profile, products, seriesBySku });
  return { ok: true, result, profile };
}

function propertyValue(promo, result) {
  return {
    market: promo.market,
    startsAt: promo.startsAt,
    lines: promo.lines,
    overall: result ? result.overall : 'none',
    blocking: result ? result.blocking : 0,
    fail: result ? result.counts.fail : 0,
    warn: result ? result.counts.warn : 0,
    cannotVerify: result ? result.counts.cannotVerify : 0,
    verdicts: result ? result.lines.map((l) => ({ sku: l.sku, verdict: l.verdict, codes: l.codes.filter((c) => c.level !== 'ok' && c.level !== 'info').map((c) => c.code) })) : [],
    checkedAt: result ? new Date(result.checkedAt).toISOString() : null,
    engineVersion: ENGINE_VERSION,
    profileHash: result?.profileHash ?? null,
    dataHash: result?.dataHash ?? null,
  };
}

/** The work item and its stored promotion (null when it has none). People read as themselves. */
export async function promotionFor(issueKey, { asApp = false } = {}) {
  if (!issueKey) return { ok: false, error: 'Give a promotion work item key, or open the promotion.' };
  const got = await getItem(issueKey, { asApp });
  if (!got.ok) return { ok: false, error: got.status === 404 ? `Work item ${issueKey} was not found or you cannot see it.` : `Could not read ${issueKey} (HTTP ${got.status}).` };
  const p = got.item.prop;
  const promo = p && p.market ? { market: p.market, startsAt: p.startsAt, lines: p.lines ?? [] } : null;
  return { ok: true, item: got.item, promo, stored: p };
}

/** Re-checks a promotion and stores the result on the work item. */
export async function recheck(issueKey, { asApp = false, promo = null } = {}) {
  let p = promo;
  let item = null;
  if (!p) {
    const got = await promotionFor(issueKey, { asApp });
    if (!got.ok) return got;
    if (!got.promo) return { ok: false, error: `${issueKey} has no Struck promotion data yet.` };
    p = got.promo;
    item = got.item;
  }
  const ev = await evaluate(p);
  if (!ev.ok && !ev.profile) return ev;
  const result = ev.ok ? ev.result : null;
  const saved = await setProperty(issueKey, propertyValue(p, result));
  if (!saved.ok) return { ok: false, error: `Could not store the result on ${issueKey} (HTTP ${saved.status}).` };
  await kv.addPromoKey(issueKey);
  if (!ev.ok) return { ok: true, issueKey, item, promo: p, result: null, profile: ev.profile, message: ev.error };
  return { ok: true, issueKey, item, promo: p, result, profile: ev.profile };
}

function cleanStartsAt(value) {
  const s = String(value ?? '').trim();
  if (!DATE_RE.test(s)) throw new InputError('The start date must be YYYY-MM-DD (local time of the market).');
  return s;
}

/**
 * Saves promotion lines (decimal prices, as people and agents write them) after validating every SKU against the
 * stored price data, then re-checks. `market` and `startsAt` default to what the work item already has.
 */
export async function saveLines(issueKey, { market, startsAt, lines, replace = true, via = 'panel' }) {
  const got = await promotionFor(issueKey);
  if (!got.ok) return got;
  const m = String(market || got.promo?.market || '').toUpperCase();
  const profile = getProfile(m);
  if (!profile) return { ok: false, error: `Give the market: ${MARKETS.join(' or ')}.` };
  let start;
  try {
    start = cleanStartsAt(startsAt || got.promo?.startsAt);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!Array.isArray(lines) || !lines.length) return { ok: false, error: 'Give at least one line.' };
  if (lines.length > 50) return { ok: false, error: 'A promotion can have at most 50 lines.' };
  let engineLines;
  try {
    engineLines = lines.map(toEngineLine);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const known = new Set(await kv.listSkus(profile.code));
  const unknown = engineLines.map((l) => l.sku).filter((s) => !known.has(s));
  if (unknown.length) {
    return { ok: false, error: `No price history in ${profile.code} for: ${[...new Set(unknown)].join(', ')}. Import the history first or correct the SKU.`, knownSkus: [...known] };
  }
  const merged = replace || !got.promo ? engineLines
    : [...got.promo.lines.filter((l) => !engineLines.some((n) => n.sku === l.sku)), ...engineLines];
  const promo = { market: profile.code, startsAt: start, lines: merged };
  const r = await recheck(issueKey, { promo });
  if (!r.ok) return r;
  await kv.logFix(issueKey, { sku: '*', fix: 'save-lines', before: got.promo?.lines?.length ?? 0, after: merged.length, via });
  return r;
}

export async function explainLine(issueKey, sku) {
  const got = await promotionFor(issueKey);
  if (!got.ok) return got;
  if (!got.promo) return { ok: false, error: `${issueKey} has no Struck promotion data yet.` };
  const want = String(sku || '').trim().toUpperCase();
  const line = got.promo.lines.find((l) => l.sku === want);
  if (!line) return { ok: false, error: `${issueKey} has no line for ${want}. Its SKUs: ${got.promo.lines.map((l) => l.sku).join(', ')}.` };
  const ev = await evaluate({ ...got.promo, lines: [line] });
  if (!ev.ok) return ev;
  const r = ev.result.lines[0];
  const tz = ev.profile.timeZone;
  const rec = await kv.getSeries(ev.profile.code, want);
  const history = (rec?.rows ?? []).map((row) => ({ from: formatLocal(row.effectiveFrom, tz), price: money(row.priceMinor, ev.profile) }));
  return {
    ok: true,
    issueKey,
    line: lineOut(r, ev.profile),
    pricesInWindow: (r.inWindow ?? []).map((s) => ({ from: formatLocal(s.from, tz), to: formatLocal(s.to, tz), price: money(s.priceMinor, ev.profile) })),
    history,
    steps: [
      `Profile ${ev.profile.code} (${ev.profile.status}): window of ${ev.profile.windowDays} days before ${r.anchoredToCampaignStart ? 'the first step of the uninterrupted progressive reduction' : 'the promotion start'}.`,
      r.windowStart != null ? `Window: ${formatLocal(r.windowStart, tz)} up to, not including, ${formatLocal(r.windowEnd, tz)} (${tz}).` : 'No window could be formed.',
      r.priorMinor != null ? `Lowest price applied in the window: ${money(r.priorMinor, ev.profile)}, from ${formatLocal(r.priorAt, tz)}.` : 'No prior price could be computed.',
      ...r.codes.map((c) => `${c.code} ${c.key}: ${c.message}`),
    ],
    sources: ev.profile.sources.map((id) => SOURCES[id]),
  };
}

function parseDate(date, profile) {
  const s = String(date ?? '').trim();
  if (!DATE_RE.test(s)) throw new InputError('The date must be YYYY-MM-DD.');
  return parseLocal(s, profile.timeZone);
}

export async function priorPriceFor({ market, sku, date }) {
  const profile = getProfile(market);
  if (!profile) return { ok: false, error: `Unknown market "${market}". Use one of: ${MARKETS.join(', ')}.` };
  const want = String(sku || '').trim().toUpperCase();
  const rec = await kv.getSeries(profile.code, want);
  if (!rec) return { ok: false, error: `No price history in ${profile.code} for ${want}.`, knownSkus: await kv.listSkus(profile.code) };
  let start;
  try {
    start = parseDate(date, profile);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const p = computePrior({ series: normalizeSeries(rec.rows, profile.timeZone), profile, product: { launchedAt: rec.launchedAt ?? undefined }, start });
  const tz = profile.timeZone;
  return {
    ok: true,
    market: profile.code,
    profileStatus: profile.status,
    sku: want,
    product: rec.name,
    date: formatLocal(start, tz, false),
    status: p.status === 'ok' ? 'ok' : 'cannot-verify',
    priorPrice: p.status === 'ok' ? money(p.priorMinor, profile) : null,
    priorPriceFrom: p.status === 'ok' ? formatLocal(p.priorAt, tz, false) : null,
    window: windowLabel(p.windowStart, p.windowEnd, tz),
    reason: p.reason ?? null,
    note: 'The prior price is the lowest price applied in the window. Compute any percentage from it, never from the last price.',
  };
}

export async function claimCheck({ market, sku, date, newPrice, shownPrior, shownPercent, claimType }) {
  const profile = getProfile(market);
  if (!profile) return { ok: false, error: `Unknown market "${market}". Use one of: ${MARKETS.join(', ')}.` };
  const want = String(sku || '').trim().toUpperCase();
  const rec = await kv.getSeries(profile.code, want);
  if (!rec) return { ok: false, error: `No price history in ${profile.code} for ${want}.`, knownSkus: await kv.listSkus(profile.code) };
  try {
    const start = parseDate(date, profile);
    const pct = shownPercent === undefined || shownPercent === null || shownPercent === '' ? null : Number(shownPercent);
    const r = checkClaim({
      series: rec.rows, profile, product: { sku: want, name: rec.name, launchedAt: rec.launchedAt ?? undefined }, date: start,
      newPriceMinor: toMinor(newPrice), shownPriorMinor: shownPrior ? toMinor(shownPrior) : null, shownPercent: pct,
      claimType: claimType || undefined,
    });
    return { ok: true, market: profile.code, profileStatus: profile.status, date: formatLocal(start, profile.timeZone, false), ...lineOut({ ...r, name: rec.name }, profile) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Sets one line to computed values. `via` is "agent" or "panel". */
export async function applyFix(issueKey, { sku, fix, via = 'panel' }) {
  const got = await promotionFor(issueKey);
  if (!got.ok) return got;
  if (!got.promo) return { ok: false, error: `${issueKey} has no Struck promotion data yet.` };
  const want = String(sku || '').trim().toUpperCase();
  const idx = got.promo.lines.findIndex((l) => l.sku === want);
  if (idx < 0) return { ok: false, error: `${issueKey} has no line for ${want}.` };
  const ev = await evaluate({ ...got.promo, lines: [got.promo.lines[idx]] });
  if (!ev.ok) return ev;
  const r = ev.result.lines[0];
  if (r.priorMinor == null) return { ok: false, error: `No prior price could be computed for ${want} (${r.codes.map((c) => c.message).join(' ')}). Nothing was changed.` };
  const before = { ...got.promo.lines[idx] };
  const after = { ...before };
  if (fix === 'show-prior') {
    if (!(r.newPriceMinor < r.priorMinor)) return { ok: false, error: `At ${money(r.newPriceMinor, ev.profile)} there is no reduction against ${money(r.priorMinor, ev.profile)}; use remove-claim or set-price. Nothing was changed.` };
    after.shownPriorMinor = r.priorMinor;
    if (after.shownPercent != null && after.shownPercent > r.supportedPercent) after.shownPercent = r.supportedPercent > 0 ? r.supportedPercent : null;
    after.claimType = after.shownPercent != null ? 'percent' : 'was-now';
  } else if (fix === 'remove-claim') {
    after.shownPriorMinor = null;
    after.shownPercent = null;
    after.claimType = 'none';
    delete after.statementLabel;
  } else if (fix === 'set-price') {
    if (after.shownPercent == null) return { ok: false, error: 'set-price needs a claimed percentage on the line. Nothing was changed.' };
    after.newPriceMinor = r.maxPriceForClaimMinor;
    after.shownPriorMinor = r.priorMinor;
  } else {
    return { ok: false, error: 'fix must be show-prior, remove-claim or set-price. Nothing was changed.' };
  }
  const lines = got.promo.lines.slice();
  lines[idx] = after;
  const saved = await recheck(issueKey, { promo: { ...got.promo, lines } });
  if (!saved.ok) return saved;
  await kv.logFix(issueKey, { sku: want, fix, before, after, via });
  const line = saved.result.lines.find((l) => l.sku === want);
  return {
    ok: true,
    issueKey,
    changed: want,
    fix,
    before: { newPrice: money(before.newPriceMinor, ev.profile), shownPrior: before.shownPriorMinor == null ? null : money(before.shownPriorMinor, ev.profile), shownPercent: before.shownPercent ?? null },
    after: lineOut(line, saved.profile),
    overall: saved.result.overall,
    blockingLines: saved.result.blocking,
  };
}

export async function createFixTasks(issueKey) {
  const r = await recheck(issueKey);
  if (!r.ok) return r;
  if (!r.result) return { ok: false, error: r.message ?? 'Nothing to check.' };
  const bad = r.result.lines.filter((l) => l.verdict === 'fail' || l.verdict === 'cannot-verify');
  if (!bad.length) return { ok: true, issueKey, created: [], message: 'No failing lines, so no tasks were created.' };
  const projectKey = r.item?.projectKey ?? issueKey.split('-')[0];
  const created = [];
  const failed = [];
  for (const l of bad) {
    const o = lineOut(l, r.profile);
    const text = [
      `Struck found a problem with ${o.product} (${o.sku}) in ${issueKey}.`,
      ...o.codes.filter((c) => c.level === 'fail' || c.level === 'warn').map((c) => `${c.code} ${c.key}: ${c.message}`),
      o.priorPrice ? `Prior price (lowest in ${o.window}): ${o.priorPrice}.` : '',
      ...o.suggestions.map((s) => `Option: ${s.text}`),
      'Computed by Struck from the stored price history and the market profile. Not legal advice.',
    ].filter(Boolean).join('\n');
    const c = await createItem({ projectKey, parentKey: issueKey, summary: `Fix price claim: ${o.product} (${o.sku})`, description: text, labels: ['struck-fix'] });
    if (c.ok) created.push(c.key);
    else failed.push(`${o.sku}: ${c.error}`);
  }
  return { ok: created.length > 0 || !failed.length, issueKey, created, failed, ...(created.length ? {} : { error: `No task was created. ${failed.join(' ')}` }) };
}

/** Promotions with their stored summary, for the global page. Read as the user, so hidden work items stay hidden. */
export async function listPromotions() {
  const out = [];
  for (const key of await kv.listPromoKeys()) {
    const got = await getItem(key);
    if (!got.ok) continue;
    const p = got.item.prop ?? {};
    out.push({ key, summary: got.item.summary, status: got.item.status, market: p.market, startsAt: p.startsAt, overall: p.overall, blocking: p.blocking ?? 0, lines: (p.lines ?? []).length, checkedAt: p.checkedAt });
  }
  return out;
}

/** Brief text of a promotion (its description), for the agent to read lines from. */
export async function briefOf(issueKey) {
  const got = await promotionFor(issueKey);
  if (!got.ok) return got;
  return { ok: true, issueKey, summary: got.item.summary, brief: adfText(got.item.description).trim().slice(0, 4000) };
}

/**
 * CSV import: market,sku,name,effective_from,price[,launched_at]. Each SKU's rows replace its stored history.
 * Returns counts and re-checks every promotion afterwards.
 */
export async function importCsv(text) {
  const rows = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!rows.length) return { ok: false, error: 'Paste CSV rows: market,sku,name,effective_from,price[,launched_at].' };
  if (/^market\s*,/i.test(rows[0])) rows.shift();
  if (rows.length > 5000) return { ok: false, error: 'At most 5,000 rows per import.' };
  const groups = new Map();
  const errors = [];
  rows.forEach((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const [marketRaw, skuRaw, name, from, price, launched] = cells;
    const profile = getProfile(marketRaw);
    const sku = String(skuRaw || '').toUpperCase();
    if (!profile) return errors.push(`Row ${i + 1}: unknown market ${marketRaw}.`);
    if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku)) return errors.push(`Row ${i + 1}: SKU must be letters, digits, dot, dash or underscore.`);
    let at;
    let minor;
    try {
      at = parseLocal(from, profile.timeZone);
      minor = toMinor(price);
    } catch (e) {
      return errors.push(`Row ${i + 1}: ${e.message}`);
    }
    const key = `${profile.code}:${sku}`;
    if (!groups.has(key)) groups.set(key, { market: profile.code, sku, name: name || sku, launchedAt: null, rows: [] });
    const g = groups.get(key);
    g.rows.push({ effectiveFrom: at, priceMinor: minor });
    if (launched) {
      try {
        g.launchedAt = parseLocal(launched, profile.timeZone);
      } catch {
        errors.push(`Row ${i + 1}: launched_at is not a date.`);
      }
    }
    return null;
  });
  if (errors.length) return { ok: false, error: errors.slice(0, 10).join(' '), errorCount: errors.length };
  for (const g of groups.values()) {
    try {
      g.rows = normalizeSeries(g.rows, getProfile(g.market).timeZone);
    } catch (e) {
      return { ok: false, error: `${g.market} ${g.sku}: ${e.message}` };
    }
  }
  for (const g of groups.values()) await kv.saveSeries({ ...g, source: 'csv' });
  const rechecked = await recheckAll({ asApp: false });
  return { ok: true, products: groups.size, rows: rows.length, rechecked: rechecked.checked };
}

/** Re-checks every stored promotion (daily trigger, and after an import). */
export async function recheckAll({ asApp = true } = {}) {
  let checked = 0;
  for (const key of await kv.listPromoKeys()) {
    const r = await recheck(key, { asApp });
    if (r.ok) checked += 1;
    else if (/not found/.test(r.error ?? '')) await kv.removePromoKey(key);
  }
  return { checked };
}

/** Workflow validator: blocks the transition while any line fails or cannot be verified. */
export async function validate(issueKey) {
  const got = await promotionFor(issueKey, { asApp: true });
  if (!got.ok || !got.promo) return { result: true };
  const r = await recheck(issueKey, { asApp: true, promo: got.promo });
  if (!r.ok) return { result: false, errorMessage: `Struck could not check this promotion: ${r.error}` };
  if (!r.result) return { result: false, errorMessage: `Struck: ${r.message}` };
  if (!r.result.blocking) return { result: true };
  const bad = r.result.lines.filter((l) => l.verdict === 'fail' || l.verdict === 'cannot-verify').map((l) => `${l.sku} (${l.codes.filter((c) => c.level === 'fail').map((c) => c.code).join(', ')})`);
  return { result: false, errorMessage: `Struck: ${bad.length} price claim${bad.length === 1 ? '' : 's'} must be fixed before publishing: ${bad.join('; ')}. Open the Struck panel for the numbers.` };
}

export const ALL_PROFILES = () => MARKETS.map((m) => profileOut(PROFILES[m]));

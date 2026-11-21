// Resolver functions for the work item panel and the Struck page, plus the validator and the daily re-check.
// People act as themselves; issue-property writes, the validator and the scheduled trigger run as the app.

import Resolver from '@forge/resolver';
import {
  promotionFor, recheck, saveLines, applyFix, listPromotions, importCsv, recheckAll, validate, resultOut, ALL_PROFILES,
  MARKETS,
} from '../services/struck.js';
import { loadSample, removeSample, sampleStatus } from '../services/sample.js';
import { listProjects } from '../platform/jira.js';
import * as kv from '../store/kv.js';
import { getProfile } from '../engine/profiles.js';
import { addLocalDays, formatLocal } from '../engine/time.js';
import { priceAt, normalizeSeries } from '../engine/prior.js';

const resolver = new Resolver();
const issueOf = (context) => context?.extension?.issue?.key ?? null;
const safe = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (error) {
    console.log(`resolver failed: ${error?.message}`);
    return { ok: false, error: error?.message ?? 'Something went wrong.' };
  }
};

/** Daily price points for a line's chart: one week before the window to the promotion start. */
async function chartFor(line, profile, market) {
  if (line.windowStart == null) return [];
  const rec = await kv.getSeries(market, line.sku);
  if (!rec) return [];
  const series = normalizeSeries(rec.rows, profile.timeZone);
  const points = [];
  const from = addLocalDays(line.windowStart, profile.timeZone, -7);
  for (let t = from; t <= line.windowEnd; t = addLocalDays(t, profile.timeZone, 1)) {
    const p = priceAt(series, t);
    const day = formatLocal(t, profile.timeZone, false).slice(5);
    if (p !== null) points.push({ day, value: p / 100, series: 'Price' });
    if (line.priorMinor != null && t >= line.windowStart) points.push({ day, value: line.priorMinor / 100, series: 'Prior price (lowest in window)' });
  }
  return points;
}

async function panelView(issueKey) {
  const got = await promotionFor(issueKey);
  if (!got.ok) return got;
  const markets = {};
  for (const m of MARKETS) markets[m] = await kv.listSkus(m);
  if (!got.promo) return { ok: true, issueKey, summary: got.item.summary, record: null, markets };
  const r = await recheck(issueKey, { promo: got.promo });
  if (!r.ok) return r;
  if (!r.result) return { ok: true, issueKey, summary: got.item.summary, record: { market: got.promo.market, startsAt: got.promo.startsAt, lines: [] }, message: r.message, markets };
  const out = resultOut(r.result, r.profile, { issueKey });
  const charts = {};
  for (const line of r.result.lines) charts[line.sku] = await chartFor(line, r.profile, r.profile.code);
  return {
    ok: true,
    issueKey,
    summary: got.item.summary,
    record: { market: got.promo.market, startsAt: got.promo.startsAt, lines: got.promo.lines },
    result: out,
    charts,
    markets,
    fixLog: (await kv.getFixLog(issueKey)).slice(0, 5),
  };
}

resolver.define('panel', safe(async ({ payload, context }) => panelView(payload?.issueKey || issueOf(context))));

resolver.define('saveLines', safe(async ({ payload, context }) => {
  const key = payload?.issueKey || issueOf(context);
  const r = await saveLines(key, { market: payload?.market, startsAt: payload?.startsAt, lines: payload?.lines ?? [], replace: true, via: 'panel' });
  if (!r.ok) return r;
  return panelView(key);
}));

resolver.define('applyFix', safe(async ({ payload, context }) => {
  const key = payload?.issueKey || issueOf(context);
  const r = await applyFix(key, { sku: payload?.sku, fix: payload?.fix, via: 'panel' });
  if (!r.ok) return r;
  return panelView(key);
}));

resolver.define('page', safe(async () => {
  const products = {};
  for (const m of MARKETS) {
    const profile = getProfile(m);
    const list = [];
    for (const sku of await kv.listSkus(m)) {
      const rec = await kv.getSeries(m, sku);
      if (!rec) continue;
      const last = rec.rows[rec.rows.length - 1];
      list.push({
        sku, name: rec.name, changes: rec.rows.length, source: rec.source ?? 'csv',
        first: rec.rows.length ? formatLocal(rec.rows[0].effectiveFrom, profile.timeZone, false) : null,
        latestPrice: last ? (last.priceMinor / 100).toFixed(2) : null,
        latestFrom: last ? formatLocal(last.effectiveFrom, profile.timeZone, false) : null,
        launchedAt: rec.launchedAt ? formatLocal(rec.launchedAt, profile.timeZone, false) : null,
      });
    }
    products[m] = list;
  }
  return { ok: true, promotions: await listPromotions(), profiles: ALL_PROFILES(), products, sample: await sampleStatus() };
}));

resolver.define('projects', safe(async () => ({ ok: true, projects: await listProjects() })));
resolver.define('importCsv', safe(async ({ payload }) => importCsv(payload?.text)));
resolver.define('loadSample', safe(async ({ payload }) => loadSample(payload?.projectKey)));
resolver.define('removeSample', safe(async () => removeSample()));
resolver.define('recheckAll', safe(async () => ({ ok: true, ...(await recheckAll({ asApp: false })) })));

export const handler = resolver.getDefinitions();

/** jira:workflowValidator (function): blocks the transition while any line fails or cannot be verified. */
export async function validatePromotion(event) {
  try {
    const key = event?.issue?.key ?? event?.issue?.id;
    if (!key) return { result: true };
    const r = await validate(String(key));
    console.log(`validator issue=${key} result=${r.result}`);
    return r;
  } catch (error) {
    console.log(`validator failed: ${error?.message}`);
    return { result: false, errorMessage: `Struck could not check this promotion: ${error?.message ?? 'unknown error'}` };
  }
}

/** Daily: re-check every promotion, so new price data or an interrupted campaign shows up before launch. */
export async function dailyRecheck() {
  const r = await recheckAll({ asApp: true });
  console.log(`daily re-check: ${r.checked} promotions`);
  return r;
}

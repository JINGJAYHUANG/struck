// "Load sample data": price histories for 8 products in two markets and 5 promotion work items in a project the
// person picks. "Remove sample data" deletes exactly what was created. Work items are created as the person.

import { SAMPLE_PRODUCTS, SAMPLE_PROMOTIONS, toMinor } from '../engine/demo.js';
import { getProfile } from '../engine/profiles.js';
import { parseLocal } from '../engine/time.js';
import { normalizeSeries } from '../engine/prior.js';
import * as kv from '../store/kv.js';
import { createItem, deleteItem, deleteProperty } from '../platform/jira.js';
import { saveLines, recheck } from './struck.js';

export async function sampleStatus() {
  const s = await kv.getSample();
  return s ? { loaded: true, projectKey: s.projectKey, issueKeys: s.issueKeys, loadedAt: s.loadedAt } : { loaded: false };
}

export async function loadSample(projectKey) {
  const key = String(projectKey || '').trim().toUpperCase();
  if (!key) return { ok: false, error: 'Pick a project for the sample promotions.' };
  const existing = await kv.getSample();
  if (existing) return { ok: false, error: `Sample data is already loaded in ${existing.projectKey} (${existing.issueKeys.join(', ')}). Remove it first.` };
  for (const p of SAMPLE_PRODUCTS) {
    const profile = getProfile(p.market);
    const rows = normalizeSeries(p.rows.map(([d, price]) => ({ effectiveFrom: parseLocal(d, profile.timeZone), priceMinor: toMinor(price) })), profile.timeZone);
    await kv.saveSeries({ market: p.market, sku: p.sku, name: p.name, launchedAt: p.launchedAt ? parseLocal(p.launchedAt, profile.timeZone) : null, rows, source: 'sample' });
  }
  const issueKeys = [];
  const problems = [];
  for (const promo of SAMPLE_PROMOTIONS) {
    const c = await createItem({ projectKey: key, summary: promo.summary, description: promo.brief, labels: ['struck-sample', 'promotion'] });
    if (!c.ok) {
      problems.push(`${promo.summary}: ${c.error}`);
      continue;
    }
    issueKeys.push(c.key);
    if (promo.lines.length) {
      const r = await saveLines(c.key, { market: promo.market, startsAt: promo.startsAt, lines: promo.lines, via: 'sample' });
      if (!r.ok) problems.push(`${c.key}: ${r.error}`);
    } else {
      // Brief only: store the market and start date so the agent can read the brief into lines.
      await recheck(c.key, { promo: { market: promo.market, startsAt: promo.startsAt, lines: [] } });
    }
  }
  await kv.setSample({ projectKey: key, issueKeys, skus: SAMPLE_PRODUCTS.map((p) => [p.market, p.sku]), loadedAt: new Date().toISOString() });
  if (!issueKeys.length) return { ok: false, error: `No work item could be created in ${key}. ${problems.join(' ')}` };
  return { ok: true, projectKey: key, issueKeys, problems };
}

export async function removeSample() {
  const s = await kv.getSample();
  if (!s) return { ok: true, removed: [] };
  const removed = [];
  for (const k of s.issueKeys) {
    await deleteProperty(k);
    const d = await deleteItem(k);
    if (d.ok) removed.push(k);
    await kv.removePromoKey(k);
    await kv.clearFixLog(k);
  }
  for (const [market, sku] of s.skus ?? []) {
    const rec = await kv.getSeries(market, sku);
    if (rec?.source === 'sample') await kv.deleteSeries(market, sku);
  }
  await kv.setSample(null);
  return { ok: true, removed };
}

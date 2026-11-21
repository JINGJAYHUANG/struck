// App storage (Forge KVS). No account IDs, names or email addresses are stored.
//   series:<MARKET>:<SKU>  price history of one product in one market: rows [{effectiveFrom, priceMinor}], name, launchedAt
//   skus:<MARKET>          the SKUs with a price history in a market
//   promos                 work-item keys that carry Struck promotion data (for the daily re-check)
//   sample                 what "Load sample data" created, for "Remove sample data"
//   fixlog:<KEY-n>         the last 50 fixes applied to a promotion's lines (before, after, when, via)

import { kvs } from '@forge/kvs';

const MARKETS_KEY = 'markets';

export const getSeries = async (market, sku) => (await kvs.get(`series:${market}:${sku}`)) ?? null;
export const listSkus = async (market) => (await kvs.get(`skus:${market}`)) ?? [];
export const listMarketsWithData = async () => (await kvs.get(MARKETS_KEY)) ?? [];

export async function saveSeries(record) {
  const { market, sku } = record;
  await kvs.set(`series:${market}:${sku}`, { ...record, updatedAt: new Date().toISOString() });
  const skus = await listSkus(market);
  if (!skus.includes(sku)) await kvs.set(`skus:${market}`, [...skus, sku].sort());
  const markets = await listMarketsWithData();
  if (!markets.includes(market)) await kvs.set(MARKETS_KEY, [...markets, market].sort());
}

export async function deleteSeries(market, sku) {
  await kvs.delete(`series:${market}:${sku}`);
  const left = (await listSkus(market)).filter((s) => s !== sku);
  await kvs.set(`skus:${market}`, left);
  if (!left.length) await kvs.set(MARKETS_KEY, (await listMarketsWithData()).filter((m) => m !== market));
}

export const listPromoKeys = async () => (await kvs.get('promos')) ?? [];

export async function addPromoKey(key) {
  const keys = await listPromoKeys();
  if (!keys.includes(key)) await kvs.set('promos', [...keys, key]);
}

export async function removePromoKey(key) {
  await kvs.set('promos', (await listPromoKeys()).filter((k) => k !== key));
}

export const getSample = async () => (await kvs.get('sample')) ?? null;
export const setSample = async (value) => (value ? kvs.set('sample', value) : kvs.delete('sample'));

export async function logFix(issueKey, entry) {
  const log = (await kvs.get(`fixlog:${issueKey}`)) ?? [];
  log.unshift({ ...entry, at: new Date().toISOString() });
  await kvs.set(`fixlog:${issueKey}`, log.slice(0, 50));
}

export const getFixLog = async (issueKey) => (await kvs.get(`fixlog:${issueKey}`)) ?? [];
export const clearFixLog = async (issueKey) => kvs.delete(`fixlog:${issueKey}`);

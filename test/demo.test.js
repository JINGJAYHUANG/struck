// The sample data must show exactly what the demo and TESTING.md say it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_PRODUCTS, SAMPLE_PROMOTIONS, toMinor, toEngineLine } from '../src/engine/demo.js';
import { checkPromotion } from '../src/engine/rules.js';
import { PROFILES } from '../src/engine/profiles.js';
import { parseLocal } from '../src/engine/time.js';

function world() {
  const seriesBySku = {};
  const products = {};
  for (const p of SAMPLE_PRODUCTS) {
    seriesBySku[p.sku] = p.rows.map(([d, price]) => ({ effectiveFrom: d, priceMinor: toMinor(price) }));
    products[p.sku] = { name: p.name, launchedAt: p.launchedAt ? parseLocal(p.launchedAt, PROFILES[p.market].timeZone) : undefined };
  }
  return { seriesBySku, products };
}

test('toMinor parses decimals without floating-point error', () => {
  assert.equal(toMinor('1.29'), 129);
  assert.equal(toMinor('1,29'), 129);
  assert.equal(toMinor('12.9'), 1290);
  assert.equal(toMinor('399'), 39900);
  assert.equal(toMinor(12), 1200);
  assert.equal(toMinor('0.07'), 7);
  assert.equal(toMinor('€ 10.99'), 1099);
  assert.throws(() => toMinor('1.299'));
  assert.throws(() => toMinor('-1'));
});

test('every sample promotion gives the documented verdicts', () => {
  const { seriesBySku, products } = world();
  for (const promo of SAMPLE_PROMOTIONS.filter((p) => p.expect)) {
    const r = checkPromotion({
      promotion: { market: promo.market, startsAt: promo.startsAt, lines: promo.lines.map(toEngineLine) },
      profile: PROFILES[promo.market], products, seriesBySku, now: 0,
    });
    assert.equal(r.overall, promo.expect.overall, promo.id);
    for (const line of r.lines) assert.equal(line.verdict, promo.expect.verdicts[line.sku], `${promo.id} ${line.sku}`);
  }
});

test('sample bananas: Court numbers and the fix', () => {
  const { seriesBySku, products } = world();
  const promo = SAMPLE_PROMOTIONS[0];
  const r = checkPromotion({ promotion: { market: 'DE', startsAt: promo.startsAt, lines: promo.lines.map(toEngineLine) }, profile: PROFILES.DE, products, seriesBySku });
  const banana = r.lines.find((l) => l.sku === 'BANANA-1KG');
  assert.equal(banana.priorMinor, 129);
  assert.equal(banana.maxPriceForClaimMinor, 99);
  assert.deepEqual(banana.suggestions.map((s) => s.fix), ['remove-claim', 'set-price']);
});

test('weekend brief: the Cyber Monday price of 699 is the prior price, so "was 799, -18%" fails', () => {
  const { seriesBySku, products } = world();
  const promo = SAMPLE_PROMOTIONS.find((p) => p.id === 'weekend-brief');
  const r = checkPromotion({ promotion: { market: promo.market, startsAt: promo.startsAt, lines: promo.briefLines.map(toEngineLine) }, profile: PROFILES['EU-BASE'], products, seriesBySku });
  assert.equal(r.overall, promo.briefExpect.overall);
  const tv = r.lines[0];
  assert.equal(tv.verdict, promo.briefExpect.verdicts['TV-55']);
  assert.equal(tv.priorMinor, 69900);
  assert.deepEqual(tv.codes.map((c) => c.code).sort(), ['S2', 'S4']);
  assert.equal(tv.maxPriceForClaimMinor, 57318); // floor(699.00 x 0.82)
  assert.equal(tv.supportedPercent, 7); // 649 against 699 is a 7.15% cut
});

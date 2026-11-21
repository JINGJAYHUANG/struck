// The agent's linesJson in the forms Rovo has sent it: plain JSON, wrapped in backticks or a code fence, or a JSON
// string with escaped quotes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLinesJson } from '../src/actions/lines-json.js';

const want = [{ sku: 'TV-55', newPrice: '649.00', shownPrior: '799.00', shownPercent: 18, claimType: 'percent' }];
const plain = JSON.stringify(want);

test('linesJson: plain, backticks, code fence and escaped forms give the same lines', () => {
  assert.deepEqual(parseLinesJson(plain), want);
  assert.deepEqual(parseLinesJson(`\`${plain}\``), want);
  assert.deepEqual(parseLinesJson(`\`\`\`json\n${plain}\n\`\`\``), want);
  assert.deepEqual(parseLinesJson(`\`${plain.replace(/"/g, '\\"')}\``), want);
  assert.deepEqual(parseLinesJson(JSON.stringify(plain)), want);
});

test('linesJson: anything else is rejected', () => {
  assert.equal(parseLinesJson('TV-55 at 649'), undefined);
  assert.equal(parseLinesJson(''), undefined);
  assert.equal(parseLinesJson('[{sku: TV-55}]'), undefined);
});

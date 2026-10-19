'use strict';
const assert = require('node:assert/strict');
const { steps } = require('../../scripts/recette/rct1/manifest');
const pricing = require('../../scripts/recette/rct1/steps-pricing');
const costs = require('../../scripts/recette/rct1/steps-costs');

const ids = steps.map((s) => s.id);
assert.equal(new Set(ids).size, ids.length, 'ids uniques');
for (const s of steps) {
  assert.equal(typeof s.inspect, 'function', s.id);
  assert.equal(typeof s.apply, 'function', s.id);
  for (const d of s.deps || []) assert.ok(ids.includes(d), `${s.id} depend de ${d} inconnu`);
}
for (const s of [...pricing.steps, ...costs.steps]) assert.ok(ids.includes(s.id), `${s.id} absent du manifeste`);
assert.ok(ids.some((i) => i.startsWith('cost.manual.RCT1-E1.')));
assert.ok(!ids.includes('cost.manual.RCT1-F.relay'), 'relais F jamais saisi : cas incomplet voulu');
process.stdout.write('RCT1 manifest graph PASS\n');

'use strict';
/** @test-kind unit @test-runner node @test-requires none */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scanNovelPatterns } = require('../../scripts/audits/lib/novel-bug-patterns');
const repoRoot = path.resolve(__dirname, '../..');
const scan = (src, name='services/example.js') => scanNovelPatterns(src, name);

test('real inventory seam is rediscovered without hardcoding the service', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'services/inventory-service.js'), 'utf8');
  const found = scan(src, 'services/inventory-service.js')
    .filter(f => f.kind === 'CALLER_IDENTITY_OVERRIDES_CANONICAL_ROW');
  assert.ok(found.some(f => f.input === 'order_id' && f.dbRow === 'oi' && f.dbField === 'order_id'));
});

test('caller precedence variants are detected but the canonical-first fallback is not', () => {
  assert.equal(scan('const effectiveOrderId = order_id ?? oi.order_id;').length, 1);
  assert.equal(scan('const effectiveOrderId = order_id || oi.order_id;').length, 1);
  assert.equal(scan('const effectiveOrderId = oi.order_id || order_id;').length, 0);
  assert.equal(scan('const count = supplied || item.quantity;').length, 0);
});

test('real auto-parcel silent insert is rediscovered independent of inventory', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'services/auto-parcel.js'), 'utf8');
  const found = scan(src, 'services/auto-parcel.js')
    .filter(f => f.kind === 'SILENT_CONFLICT_COUNT_AS_SUCCESS');
  assert.equal(found.length, 2);
  assert.ok(found.every(f => f.counter === 'assigned'));
});

test('silent conflicts without unconditional success counter and normal writes are ignored', () => {
  const guarded = [
    'const result = await client.query(`INSERT INTO parcel_items(id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);',
    'if (result.rowCount > 0) assigned++;'
  ].join('\n');
  const noConflict = 'await client.query(`INSERT INTO parcels(id) VALUES ($1)`, [id]); assigned++;';
  assert.equal(scan(guarded).length, 0);
  assert.equal(scan(noConflict).length, 0);
});

test('every finding is explicitly a lead, not a confirmed runtime bug', () => {
  const found = scan('const effectiveOrderId = order_id || oi.order_id;');
  assert.ok(found.every(f => f.severity === 'REVIEW' && /verify|verified/i.test(f.caveat)));
});

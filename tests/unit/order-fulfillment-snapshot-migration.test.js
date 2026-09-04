'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/162_order_items_fulfillment_source.sql'),
  'utf8'
);

test('migration 162 garde seulement LOCAL_STOCK / IMPORT et ne ment pas sur l’historique', () => {
  expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS fulfillment_source text/);
  expect(migration).toMatch(/fulfillment_source IN \('LOCAL_STOCK', 'IMPORT'\)/);
  expect(migration).not.toMatch(/DEFAULT\s+'IMPORT'/i);
  expect(migration).toMatch(/NULL signifie uniquement/i);
});

test('fulfillment_source est immuable après création', () => {
  expect(migration).toMatch(/BEFORE UPDATE OF fulfillment_source/);
  expect(migration).toMatch(/OLD\.fulfillment_source IS DISTINCT FROM NEW\.fulfillment_source/);
  expect(migration).toMatch(/RAISE EXCEPTION/);
});

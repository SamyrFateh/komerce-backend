'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/169_product_market_price_decision_events.sql'),
  'utf8'
);

test('la migration crée une décision de prix market-scoped sans dupliquer le produit', () => {
  expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS product_market_price_decision_events/i);
  expect(migration).toMatch(/market_id UUID NOT NULL REFERENCES markets\(id\)/i);
  expect(migration).toMatch(/product_id UUID NOT NULL REFERENCES products\(id\)/i);
  expect(migration).not.toMatch(/CREATE TABLE[^;]*product_market_prices\s*\(/i);
});

test('SET et RESET sont append-only et UPDATE DELETE sont interdits', () => {
  expect(migration).toMatch(/decision_type IN \('SET', 'RESET'\)/i);
  expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON product_market_price_decision_events/i);
  expect(migration).toMatch(/is append-only/i);
});

test('la DB verrouille le plancher variable et la durée sous CDR', () => {
  expect(migration).toMatch(/price_kmf_snapshot > variable_cost_kmf_snapshot/i);
  expect(migration).toMatch(/cdr_kmf_snapshot >= variable_cost_kmf_snapshot/i);
  expect(migration).toMatch(/strategy_position IS DISTINCT FROM 'UNDER_CDR' OR valid_until IS NOT NULL/i);
});

test('la décision conserve devise locale, snapshots économiques, justification et auteur', () => {
  for (const token of [
    'local_currency', 'price_kmf_snapshot', 'variable_cost_kmf_snapshot',
    'cdr_kmf_snapshot', 'rationale', 'decision_snapshot', 'recorded_by', 'recorded_at',
  ]) {
    expect(migration).toContain(token);
  }
});

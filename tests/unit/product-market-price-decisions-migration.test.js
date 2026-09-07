'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '169_product_market_price_decisions.sql'),
  'utf8'
);

test('migration 169 crée un overlay économique et ne modifie pas products', () => {
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS product_market_price_decisions');
  expect(sql).toContain('market_id             UUID NOT NULL REFERENCES markets(id)');
  expect(sql).toContain('product_id            UUID NOT NULL REFERENCES products(id)');
  expect(sql).not.toMatch(/ALTER\s+TABLE\s+products/i);
  expect(sql).not.toMatch(/ADD\s+COLUMN\s+market_id/i);
});

test('une seule décision active existe par produit et marché, l’historique est conservé', () => {
  expect(sql).toContain('ux_product_market_price_decisions_active');
  expect(sql).toMatch(/ON product_market_price_decisions \(market_id, product_id\)[\s\S]*WHERE revoked_at IS NULL/);
  expect(sql).toContain('revoked_at');
  expect(sql).toContain('revoked_by');
  expect(sql).toContain('revoke_reason');
});

test('une décision sous CDR exige preuve de couverture et durée', () => {
  expect(sql).toContain("pricing_zone IN ('at_or_above_cdr', 'under_cdr_contributive')");
  expect(sql).toContain("coverage_status = 'COVERED'");
  expect(sql).toContain("coverage_authorization = 'ALLOW_NEW_UNDER_CDR_POSITION'");
  expect(sql).toContain('decision_policy_version IS NOT NULL');
  expect(sql).toContain('decision_duration_days IS NOT NULL');
  expect(sql).toContain('effective_until IS NOT NULL');
});

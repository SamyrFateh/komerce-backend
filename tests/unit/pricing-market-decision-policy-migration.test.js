'use strict';

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/168_pricing_market_decision_policy_events.sql'),
  'utf8'
);

test('la politique de décision marché est append-only et sans seuil par défaut', () => {
  expect(migration).toContain('CREATE TABLE IF NOT EXISTS pricing_market_decision_policy_events');
  expect(migration).toContain('window_days INTEGER NOT NULL');
  expect(migration).toContain('maturity_threshold NUMERIC');
  expect(migration).toContain('coverage_threshold NUMERIC');
  expect(migration).toContain('max_disposition_ratio NUMERIC');
  expect(migration).toContain("disposed_contribution_treatment = 'EXCLUDE_FROM_NUMERATOR'");
  expect(migration).toContain('BEFORE UPDATE OR DELETE ON pricing_market_decision_policy_events');
  expect(migration).toContain('source TEXT NOT NULL');
  expect(migration).toContain('evidence_ref TEXT NOT NULL');
  expect(migration).toContain('rationale TEXT NOT NULL');
  expect(migration).not.toMatch(/coverage_threshold[^\n]*DEFAULT/i);
  expect(migration).not.toMatch(/maturity_threshold[^\n]*DEFAULT/i);
  expect(migration).not.toMatch(/max_disposition_ratio[^\n]*DEFAULT/i);
});

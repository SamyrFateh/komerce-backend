'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/167_economic_risk_period_truth.sql'),
  'utf8'
);

describe('migration 167 — economic risk period truth', () => {
  test('sépare provision configurée et risque réalisé', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS economic_risk_cost_events');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS economic_risk_watermark_events');
    expect(migration).toContain('risk_provision_id UUID NULL REFERENCES risk_provisions(id)');
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+risk_provisions[\s\S]*actual/i);
  });

  test('porte market, date économique, preuve, auteur et monnaie explicites', () => {
    expect(migration).toContain('market_id UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT');
    expect(migration).toContain('economic_at TIMESTAMPTZ NOT NULL');
    expect(migration).toContain('evidence_ref TEXT NOT NULL');
    expect(migration).toContain('recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT');
    expect(migration).toContain('amount_original NUMERIC(18,4) NOT NULL');
    expect(migration).toContain('fx_rate_to_kmf NUMERIC(18,6) NOT NULL');
  });

  test('permet de certifier explicitement un zéro via closed_through', () => {
    expect(migration).toContain('closed_through TIMESTAMPTZ NOT NULL');
    expect(migration).toContain('review_version TEXT NOT NULL');
    expect(migration).toContain('aucune absence de ligne ne vaut zéro');
  });

  test('les deux journaux sont append-only au niveau DB', () => {
    expect(migration).toContain('prevent_economic_risk_truth_mutation');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON economic_risk_cost_events');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON economic_risk_watermark_events');
  });

  test('une correction référence obligatoirement le fait original', () => {
    expect(migration).toContain('adjusts_event_id UUID NULL');
    expect(migration).toContain("event_kind IN ('ADJUSTMENT', 'REVERSAL') AND adjusts_event_id IS NOT NULL");
    expect(migration).toContain("event_kind = 'ACCRUAL' AND adjusts_event_id IS NULL");
  });
});

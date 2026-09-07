'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/166_economic_structure_cost_events.sql'),
  'utf8'
);

describe('migration 166 — economic structure cost events', () => {
  test('sépare GROUP et MARKET_DIRECT sans ajouter de market_id à charges', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS economic_structure_cost_events');
    expect(migration).toContain("scope_kind IN ('GROUP', 'MARKET_DIRECT')");
    expect(migration).toContain("scope_kind = 'GROUP' AND market_id IS NULL");
    expect(migration).toContain("scope_kind = 'MARKET_DIRECT' AND market_id IS NOT NULL");
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+charges[\s\S]*ADD\s+COLUMN\s+market_id/i);
  });

  test('exige période, preuve, auteur et conversion monétaire explicites', () => {
    expect(migration).toContain('economic_from TIMESTAMPTZ NOT NULL');
    expect(migration).toContain('economic_to TIMESTAMPTZ NOT NULL');
    expect(migration).toContain('evidence_ref TEXT NOT NULL');
    expect(migration).toContain('recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT');
    expect(migration).toContain('amount_original NUMERIC(18,4) NOT NULL');
    expect(migration).toContain('fx_rate_to_kmf NUMERIC(18,6) NOT NULL');
    expect(migration).toContain('amount_kmf NUMERIC(18,2) NOT NULL');
  });

  test('snapshotte famille, nom et récurrence sans fermer les familles N3 dans un enum', () => {
    expect(migration).toContain('charge_family_snapshot TEXT NOT NULL');
    expect(migration).toContain('charge_name_snapshot TEXT NOT NULL');
    expect(migration).toContain('recurrence_period_snapshot TEXT NULL');
    expect(migration).toContain('relais fixe périodique');

    // Borne l'assertion à la définition de la colonne famille. La regex
    // précédente traversait les colonnes suivantes et capturait à tort le
    // CHECK IN (...) de scope_kind.
    const familyColumn = migration.match(
      /charge_family_snapshot\s+TEXT\s+NOT NULL[\s\S]*?charge_name_snapshot\s+TEXT/i
    )?.[0] || '';
    expect(familyColumn).not.toBe('');
    expect(familyColumn).not.toMatch(/\bIN\s*\(/i);
  });

  test('rend la table append-only au niveau DB', () => {
    expect(migration).toContain('prevent_economic_structure_cost_event_mutation');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON economic_structure_cost_events');
    expect(migration).toContain('ADJUSTMENT');
    expect(migration).toContain('REVERSAL');
  });

  test('une correction référence obligatoirement le fait corrigé', () => {
    expect(migration).toContain('adjusts_event_id UUID NULL');
    expect(migration).toContain("event_kind IN ('ADJUSTMENT', 'REVERSAL') AND adjusts_event_id IS NOT NULL");
  });
});

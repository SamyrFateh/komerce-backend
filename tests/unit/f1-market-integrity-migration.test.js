'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(ROOT, 'migrations', '232_f1_market_integrity_guards_activation.sql'),
  'utf8'
);

describe('F1 — migration 232 active (market integrity guards)', () => {
  test('F1-B est activée append-only après live preflight propre', () => {
    expect(fs.existsSync(path.join(ROOT, 'migrations', '232_f1_market_integrity_guards_activation.sql'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'migrations', 'scheduled', '229_f1_market_integrity_guards.sql'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'migrations', '229_f1_market_integrity_guards.sql'))).toBe(false);
    expect(migration).toMatch(/F1-B — activation append-only/);
    expect(migration).toMatch(/orders_market_relais_mismatch = 0/);
  });

  test('F1.1 — orders.market_id immutable après INSERT', () => {
    expect(migration).toMatch(/NEW\.market_id IS DISTINCT FROM OLD\.market_id/);
    expect(migration).toMatch(/orders_market_id_immutable/);
    expect(migration).toMatch(/BEFORE UPDATE ON orders/);
  });

  test('F1.2 — cohérence relais\/Market vérifiée à INSERT et UPDATE, sous verrou', () => {
    expect(migration).toMatch(/TG_OP\s*=\s*'INSERT'/);
    expect(migration).toMatch(/NEW\.relais_id IS DISTINCT FROM OLD\.relais_id/);
    expect(migration).toMatch(/FOR SHARE/);
    expect(migration).toMatch(/orders_relais_reassignment_cross_market/);
    expect(migration).toMatch(/orders_relais_id_unresolvable/);
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE ON orders/);
  });

  test('F1.3 — drift de relais.market_id bloqué uniquement si référencé par une commande', () => {
    expect(migration).toMatch(/NEW\.market_id IS DISTINCT FROM OLD\.market_id/);
    expect(migration).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM orders WHERE relais_id = OLD\.id/);
    expect(migration).toMatch(/relais_market_id_immutable_once_referenced/);
    expect(migration).toMatch(/BEFORE UPDATE ON relais/);
  });

  test('aucune resynchronisation automatique de market_id depuis relais', () => {
    expect(migration).not.toMatch(/UPDATE\s+orders\s+SET\s+market_id\s*=\s*r(elais)?\.market_id/i);
  });

  test('pas de bypass applicatif discret', () => {
    expect(migration).not.toMatch(/current_setting\(\s*'app\./i);
    expect(migration).not.toMatch(/IF\s+.*bypass/i);
  });
});

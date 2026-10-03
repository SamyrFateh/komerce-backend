'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const { CAPABILITIES, EFFECTS, AMOUNT_BEARING } = require('../../config/market-delegation-capabilities');
const { validateRegistry } = require('../../services/capability-registry');

const ROOT = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(ROOT, 'migrations', '270_capability_registry_effect_amount_bearing.sql'), 'utf8');
const seed = fs.readFileSync(path.join(ROOT, 'scripts', 'seed-reference-data.js'), 'utf8');

const EXPECTED_READ = [
  'client.read', 'dashboard.global.read', 'dashboard.market.read', 'finance.read', 'logistics.read',
  'market_config.read', 'catalog.read', 'network.read', 'operations.read', 'pricing.read', 'team.read',
].sort();

function quotedList(sql, anchor) {
  const start = sql.indexOf('WHERE capability IN', sql.indexOf(anchor));
  const open = sql.indexOf('(', start);
  const close = sql.indexOf(')', open);
  return Array.from(sql.slice(open, close).matchAll(/'([^']+)'/g)).map(m => m[1]).sort();
}

describe('capability_registry — effect et amount_bearing déclarés', () => {
  test('chaque capability déclare explicitement son effet, et seulement elles', () => {
    expect(Object.keys(EFFECTS).sort()).toEqual(CAPABILITIES.map(c => c.capability).sort());
    for (const row of CAPABILITIES) expect(['READ', 'ACT']).toContain(row.effect);
  });

  test('les 11 capacités de lecture sont figées ; toute autre est ACT', () => {
    const reads = CAPABILITIES.filter(c => c.effect === 'READ').map(c => c.capability).sort();
    expect(reads).toEqual(EXPECTED_READ);
    expect(CAPABILITIES.filter(c => c.effect === 'ACT')).toHaveLength(CAPABILITIES.length - 11);
  });

  test('amount_bearing : exactement les trois capacités à montant de la V1', () => {
    expect(AMOUNT_BEARING.slice().sort()).toEqual(['execution.cash.confirm', 'finance.act', 'settlement.receive']);
    expect(CAPABILITIES.filter(c => c.amount_bearing).map(c => c.capability).sort()).toEqual(AMOUNT_BEARING.slice().sort());
    for (const name of AMOUNT_BEARING) expect(CAPABILITIES.find(c => c.capability === name).effect).toBe('ACT');
  });

  test('validateRegistry signale un effet ou un indicateur manquant', () => {
    const broken = [{ ...CAPABILITIES[0], effect: undefined, amount_bearing: undefined }];
    expect(validateRegistry(broken).errors).toEqual(
      expect.arrayContaining([`effect_missing:${CAPABILITIES[0].capability}`, `amount_bearing_missing:${CAPABILITIES[0].capability}`])
    );
    expect(validateRegistry(CAPABILITIES).ok).toBe(true);
  });
});

describe('migration 270 — alignée sur la configuration, sans effet d’autorisation', () => {
  test('les listes SQL READ et montant sont celles de la configuration', () => {
    expect(quotedList(migration, "SET effect = 'READ'")).toEqual(EXPECTED_READ);
    expect(quotedList(migration, 'SET amount_bearing = TRUE')).toEqual(AMOUNT_BEARING.slice().sort());
  });

  test('colonnes ajoutées de façon idempotente, effet contraint à READ|ACT, défaut ACT', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS effect text NOT NULL DEFAULT 'ACT'/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS amount_bearing boolean NOT NULL DEFAULT FALSE/);
    expect(migration).toMatch(/CHECK \(effect IN \('READ', 'ACT'\)\)/);
  });

  test('ne touche ni membership, ni plafond, ni affectation, ni audit, et ne supprime rien', () => {
    const code = migration.replace(/^--.*$/gm, '');
    expect(code).not.toMatch(/\b(DELETE|DROP|TRUNCATE)\b/i);
    expect(code).not.toMatch(/membership_capabilities|assignment_capability_ceiling|market_operating_assignments|market_delegation_audit|ceiling_template/);
  });

  test('le seed écrit effect et amount_bearing depuis la configuration, seulement si les colonnes existent', () => {
    expect(seed).toMatch(/columns\.push\('effect', 'amount_bearing'\)/);
    expect(seed).toMatch(/values\.push\(row\.effect, row\.amount_bearing\)/);
    expect(seed).toMatch(/columnExists\(client, 'capability_registry', 'effect'\)/);
  });

  test('seedCapabilities : schéma avant migration 270 = 7 colonnes ; après = 9 colonnes', async () => {
    const { seedCapabilities } = require('../../scripts/seed-reference-data');
    const run = async present => {
      const inserts = [];
      const client = { query: async (sql, params) => {
        if (/to_regclass/.test(sql)) return { rows: [{ present: true }] };
        if (/information_schema\.columns/.test(sql)) return { rows: [{ present }] };
        inserts.push({ sql, params });
        return { rows: [] };
      } };
      await seedCapabilities(client);
      return inserts;
    };
    const before = await run(false);
    const after = await run(true);
    expect(before).toHaveLength(CAPABILITIES.length);
    expect(before[0].params).toHaveLength(7);
    expect(before[0].sql).not.toMatch(/effect/);
    expect(after[0].params).toHaveLength(9);
    expect(after[0].params.slice(7)).toEqual([CAPABILITIES[0].effect, CAPABILITIES[0].amount_bearing]);
    expect(after[0].sql).toMatch(/effect = EXCLUDED\.effect/);
  });
});

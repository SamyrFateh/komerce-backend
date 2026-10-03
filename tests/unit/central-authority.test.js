'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const {
  CAPABILITIES, CENTRAL_AUTHORITY, GROUP_CAPABILITY_AUTHORITY, centralAuthorityFor,
} = require('../../config/market-delegation-capabilities');

const ROOT = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('registre — autorité centrale déclarée', () => {
  test('les cinq domaines pointent vers leur table et leur middleware existants', () => {
    expect(Object.keys(CENTRAL_AUTHORITY).sort()).toEqual(['catalog', 'dashboard', 'decision_signal', 'pricing', 'sourcing']);
    for (const { table, guard } of Object.values(CENTRAL_AUTHORITY)) {
      expect(fs.existsSync(path.join(ROOT, guard))).toBe(true);
      expect(read(guard)).toContain(table);
    }
  });

  test('toute capability de groupe ou CENTRAL_ONLY est déclarée, et seulement elles', () => {
    const central = CAPABILITIES.filter(c => c.authority_scope === 'GROUP' || c.delegation_mode === 'CENTRAL_ONLY')
      .map(c => c.capability).sort();
    expect(Object.keys(GROUP_CAPABILITY_AUTHORITY).sort()).toEqual(central);
  });

  test('dashboard.global.read pointe vers dashboard ; les autres sont null (constat, pas autorisation)', () => {
    expect(centralAuthorityFor('dashboard.global.read')).toMatchObject({ domain: 'dashboard', table: 'dashboard_global_access_grants' });
    for (const name of ['group_cost.allocate', 'user.role.set', 'market.create', 'market_config.update']) {
      expect(centralAuthorityFor(name)).toBeNull();
    }
    expect(centralAuthorityFor('pricing.read')).toBeNull();
  });
});

describe('services/central-authority — une seule porte, aucun SQL d’autorisation dupliqué', () => {
  const service = require('../../services/central-authority');

  test('LOOKUPS couvre exactement les domaines du registre', () => {
    expect(Object.keys(service.LOOKUPS).sort()).toEqual(service.domains().sort());
  });

  test('central() délègue au middleware du domaine et refuse un domaine inconnu', async () => {
    const original = service.LOOKUPS.pricing;
    expect(typeof original).toBe('function');
    await expect(service.central('u1', 'inconnu')).rejects.toThrow(/inconnu/);
  });

  test('le service ne contient aucun SELECT d’autorisation par utilisateur (seulement la vue d’ensemble)', () => {
    const source = read('services/central-authority.js');
    expect(source).not.toMatch(/WHERE\s+user_id\s*=/);
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  test('overview lit les titulaires actifs de chaque table du registre, en SELECT seulement', async () => {
    const calls = [];
    const db = { query: async sql => {
      calls.push(sql);
      return { rows: sql.includes('pricing_global_access_grants') ? [{ user_id: 'u1', granted_at: 't', reason: 'r' }] : [] };
    } };
    const view = await service.overview(db);
    expect(view.domains.map(d => d.domain)).toEqual(Object.keys(CENTRAL_AUTHORITY));
    expect(view.domains.find(d => d.domain === 'pricing')).toMatchObject({ count: 1 });
    expect(view.domains.find(d => d.domain === 'catalog')).toMatchObject({ count: 0 });
    expect(calls).toHaveLength(5);
    expect(calls.every(sql => /^\s*SELECT/.test(sql) && /revoked_at IS NULL/.test(sql))).toBe(true);
    expect(view.group_capabilities).toContainEqual({ capability: 'dashboard.global.read', authority: 'dashboard' });
    await expect(service.overview(null)).rejects.toThrow(TypeError);
  });
});

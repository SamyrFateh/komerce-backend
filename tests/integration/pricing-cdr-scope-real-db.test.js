'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * #3830 P0-2 : périmètre des coûts Comores / inter-îles sur KM, CM et CG,
 * avec la config RÉELLE chargée depuis PostgreSQL (loadGlobalConfig par marché).
 * Seul le FX est figé (autorité de taux non seedée en base de test).
 */
const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('P0-2 pricing scope (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  jest.mock('../../services/fx-engine-rates', () => ({
    withAuthorityRates: async (fc) => ({ ...(fc || {}), taux_change_eur_kmf: 495, taux_aed_kmf: 139, taux_usd_kmf: 450, fret_eur_per_m3: 180 }),
  }));

  const db = require('../../db');
  const { loadGlobalConfig, computeCDR } = require('../../services/pricing-cdr');

  jest.setTimeout(60000);

  const COMORES = [
    { key: 'transport_port_relais_kmf', island: null, label: 'Port vers relais (Grande Comore)' },
    { key: 'transport_inter_iles_moheli_kmf', island: null, label: 'Surcoût transport vers Mohéli' },
    { key: 'transport_inter_iles_anjouan_kmf', island: null, label: 'Surcoût transport vers Anjouan' },
  ];
  const markets = {};
  const createdComponentIds = [];
  const createdMarketIds = [];
  const createdOverrideIds = [];
  const product = { category: 'phones', cost_kmf: 3000, weight_kg: 1 };

  async function ensureMarket(code, name, currency) {
    let { rows } = await db.query('SELECT id FROM markets WHERE code = $1 LIMIT 1', [code]);
    if (!rows.length) {
      ({ rows } = await db.query(
        `INSERT INTO markets (code, name, currency, minor_unit, is_active, lifecycle_status) VALUES ($1,$2,$3,0,TRUE,'ACTIVE')
         ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`, [code, name, currency]));
      createdMarketIds.push(rows[0].id);
    }
    return rows[0].id;
  }

  async function ensureComponent({ key, label }) {
    const found = await db.query('SELECT id FROM cost_components WHERE key = $1', [key]);
    if (found.rows.length) {
      // Composant déjà présent : on le force actif et sans île pour un test déterministe (restauré en afterAll).
      return found.rows[0].id;
    }
    const { rows } = await db.query(
      `INSERT INTO cost_components (key, label, family, category, default_value, unit, scope, allocation_method, source, confidence, is_active)
       VALUES ($1,$2,'landed_relay','local_distribution',$3,'kmf_per_parcel','global','per_item','default','medium',TRUE)
       RETURNING id`, [key, label, key.includes('inter_iles') ? 800 : 500]);
    createdComponentIds.push(rows[0].id);
    return rows[0].id;
  }

  const cdrFor = async (code, ctx = {}, p = product) => {
    const config = await loadGlobalConfig({ marketId: markets[code] });
    return { config, cdr: computeCDR(p, { config, volume_m3: 0.001, channel: 'cash_relais', ...ctx }) };
  };
  const keys = (c) => c.details._allocations.map(a => a.component_key);

  beforeAll(async () => {
    markets.KM = await ensureMarket('KM', 'Comores', 'KMF');
    markets.CM = await ensureMarket('CM', 'Cameroun', 'XAF');
    markets.CG = await ensureMarket('CG', 'Congo', 'XAF');
    for (const c of COMORES) await ensureComponent(c);
  });

  afterAll(async () => {
    if (createdOverrideIds.length) await db.query('DELETE FROM cost_component_market_overrides WHERE id = ANY($1::uuid[])', [createdOverrideIds]);
    if (createdComponentIds.length) await db.query('DELETE FROM cost_components WHERE id = ANY($1::uuid[])', [createdComponentIds]);
    if (createdMarketIds.length) {
      try { await db.query('DELETE FROM markets WHERE id = ANY($1::uuid[])', [createdMarketIds]); } catch (_) { /* FK : laissé */ }
    }
    await db.pool?.end?.();
  });

  it('loadGlobalConfig porte le code du marché', async () => {
    for (const code of ['KM', 'CM', 'CG']) {
      const { config } = await cdrFor(code);
      expect(config.market_code).toBe(code);
    }
  });

  it('KM sans destination : port → relais appliqué, inter-îles UNKNOWN et signalés', async () => {
    const { cdr } = await cdrFor('KM');
    expect(keys(cdr)).toContain('transport_port_relais_kmf');
    expect(keys(cdr).filter(k => k.includes('inter_iles'))).toEqual([]);
    expect(cdr.cost_scope.unknown_components.map(u => u.component_key))
      .toEqual(expect.arrayContaining(['transport_inter_iles_moheli_kmf', 'transport_inter_iles_anjouan_kmf']));
    expect(cdr.warnings.join(' ')).toMatch(/Surcoût destination non déterminé/);
  });

  it('KM destination Mohéli : Mohéli appliqué, Anjouan non applicable', async () => {
    const { cdr } = await cdrFor('KM', { destination_island: 'moheli' });
    expect(keys(cdr)).toContain('transport_inter_iles_moheli_kmf');
    expect(keys(cdr)).not.toContain('transport_inter_iles_anjouan_kmf');
    expect(cdr.cost_scope.not_applicable_components.map(u => u.component_key)).toContain('transport_inter_iles_anjouan_kmf');
  });

  it.each(['CM', 'CG'])('%s : aucun composant Comores, tous UNKNOWN', async (code) => {
    const { cdr } = await cdrFor(code, { destination_island: 'moheli' });
    for (const c of COMORES) expect(keys(cdr)).not.toContain(c.key);
    expect(cdr.cost_scope.market_code).toBe(code);
    expect(cdr.cost_scope.unknown_components.map(u => u.component_key))
      .toEqual(expect.arrayContaining(COMORES.map(c => c.key)));
  });

  it('CM avec surcharge marché explicite : le port → relais local s\'applique', async () => {
    const comp = await db.query('SELECT id FROM cost_components WHERE key = $1', ['transport_port_relais_kmf']);
    const ov = await db.query(
      `INSERT INTO cost_component_market_overrides (market_id, component_id, default_value, is_active)
       VALUES ($1,$2,321,TRUE) ON CONFLICT (market_id, component_id) DO NOTHING RETURNING id`,
      [markets.CM, comp.rows[0].id]);
    if (ov.rows[0]) createdOverrideIds.push(ov.rows[0].id);
    const { cdr } = await cdrFor('CM');
    const line = cdr.details._allocations.find(a => a.component_key === 'transport_port_relais_kmf');
    expect(line).toBeDefined();
    expect(line.source).toBe('market_override');
  });

  it('LOCAL_STOCK en KM : aucun coût Hub, carton, temps acheteur, frais bancaires d\'achat ni port → relais', async () => {
    const { config, cdr } = await cdrFor('KM', { provenance: 'LOCAL_STOCK' });
    const excluded = new Set(['hub', 'packaging', 'sourcing', 'product_purchase']);
    expect(cdr.details._allocations.filter(a => excluded.has(a.category) || a.component_key === 'transport_port_relais_kmf')).toEqual([]);
    expect(cdr.details.hub + cdr.details.packaging + cdr.details.sourcing).toBe(0);
    expect(cdr.import_chain_not_applicable).toBe(true);
    expect(config.components.length).toBeGreaterThan(0);
  });

  it('catégorie absente : UNKNOWN explicite, pas de bascule vers phones', async () => {
    const { cdr } = await cdrFor('KM', {}, { cost_kmf: 3000, weight_kg: 1 });
    expect(cdr.category_status).toBe('UNKNOWN');
    expect(cdr._meta.category).toBeNull();
    expect(cdr.warnings.join(' ')).toMatch(/Catégorie absente/);
  });
}

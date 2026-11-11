'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * #3830 P0-2 : périmètre des composants (Comores / inter-îles / LOCAL_STOCK / catégorie absente).
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/fx-engine-rates', () => ({ withAuthorityRates: async (fc) => fc }));

const db = require('../../db');
const { computeCDR, loadGlobalConfig } = require('../../services/pricing-cdr');
const engine = require('../../services/pricing-engine');

const finance = {
  taux_change_eur_kmf: 495, taux_aed_kmf: 139, taux_usd_kmf: 450, fret_eur_per_m3: 180,
  objectif_commandes_mois: 100, avg_articles_per_order: 2.5, avg_articles_per_parcel: 4,
  avg_articles_per_shipment: 200, target_marge_brute_pct: 40, minimum_safety_margin_pct: 10,
};
const mk = (key, category, default_value, unit, extra = {}) =>
  ({ key, category, default_value, unit, allocation_method: null, applies_to: 'all', source: 'default', confidence: 'medium', ...extra });
const PORT = mk('transport_port_relais_kmf', 'local_distribution', 500, 'kmf_per_parcel');
const MOHELI = mk('transport_inter_iles_moheli_kmf', 'local_distribution', 800, 'kmf_per_parcel');
const ANJOUAN = mk('transport_inter_iles_anjouan_kmf', 'local_distribution', 800, 'kmf_per_parcel');
const OTHERS = [
  mk('sourcing_temps_acheteur_kmf', 'sourcing', 200, 'kmf_per_order'),
  mk('hub_controle_kmf', 'hub', 150, 'kmf_per_parcel'),
  mk('carton_kmf', 'packaging', 300, 'kmf_per_parcel'),
  mk('frais_bancaires_achat_pct', 'product_purchase', 1.5, 'pct'),
  mk('commission_relais_kmf', 'relay', 600, 'kmf_per_order'),
];
const config = (market_code, extra = {}, components = [...OTHERS, PORT, MOHELI, ANJOUAN]) => ({
  finance, categories: { phones: { default_margin_pct: 30 } }, components, provisions: [], charges: [], market_code, ...extra,
});
const product = { category: 'phones', cost_kmf: 3000, weight_kg: 1 };
const keys = (c) => c.details._allocations.map(a => a.component_key);
const run = (cfg, ctx = {}, p = product) => computeCDR(p, { config: cfg, volume_m3: 0.001, ...ctx });

describe('P0-2 · inter-îles selon l\'île de destination', () => {
  it('KM sans destination : port → relais appliqué, les deux inter-îles UNKNOWN et signalés (jamais les deux d\'office)', () => {
    const c = run(config('KM'));
    expect(keys(c)).toContain('transport_port_relais_kmf');
    expect(keys(c)).not.toContain('transport_inter_iles_moheli_kmf');
    expect(keys(c)).not.toContain('transport_inter_iles_anjouan_kmf');
    expect(c.cost_scope.unknown_components.map(u => u.component_key).sort())
      .toEqual(['transport_inter_iles_anjouan_kmf', 'transport_inter_iles_moheli_kmf']);
    expect(c.cost_scope.unknown_components[0]).toMatchObject({ status: 'UNKNOWN', reason: 'destination_island_unknown' });
    expect(c.warnings.join(' ')).toMatch(/Surcoût destination non déterminé/);
    expect(c.input_quality.unknown).toContain('scope:transport_inter_iles_moheli_kmf');
  });

  it.each([
    ['Mohéli', 'moheli', 'transport_inter_iles_moheli_kmf', 'transport_inter_iles_anjouan_kmf'],
    ['anjouan', 'anjouan', 'transport_inter_iles_anjouan_kmf', 'transport_inter_iles_moheli_kmf'],
  ])('KM destination %s : seul le surcoût de son île', (label, island, applied, other) => {
    const c = run(config('KM'), { destination_island: label });
    expect(keys(c)).toContain(applied);
    expect(keys(c)).not.toContain(other);
    expect(c.cost_scope.destination_island).toBe(island);
    expect(c.cost_scope.unknown_components).toEqual([]);
    expect(c.cost_scope.not_applicable_components).toEqual([
      expect.objectContaining({ component_key: other, status: 'NOT_APPLICABLE', reason: 'destination_island_differs' }),
    ]);
  });

  it('KM destination Grande Comore : aucun surcoût inter-îles', () => {
    const c = run(config('KM'), { destination_island: 'Grande Comore' });
    expect(keys(c).filter(k => k.includes('inter_iles'))).toEqual([]);
    expect(c.cost_scope.unknown_components).toEqual([]);
  });

  it('un composant avec island explicite suit la même règle', () => {
    const custom = mk('surcout_x', 'local_distribution', 100, 'kmf_per_parcel', { island: 'mayotte' });
    expect(keys(run(config('KM', {}, [custom]), { destination_island: 'mayotte' }))).toContain('surcout_x');
    expect(keys(run(config('KM', {}, [custom])))).not.toContain('surcout_x');
  });
});

describe('P0-2 · composants Comores limités au marché KM', () => {
  it.each(['CM', 'CG'])('%s sans surcharge marché : UNKNOWN, jamais la valeur des Comores', (code) => {
    const c = run(config(code), { destination_island: 'moheli' });
    for (const k of ['transport_port_relais_kmf', 'transport_inter_iles_moheli_kmf', 'transport_inter_iles_anjouan_kmf']) {
      expect(keys(c)).not.toContain(k);
    }
    expect(c.cost_scope.unknown_components).toHaveLength(3);
    expect(c.cost_scope.unknown_components.every(u => u.reason === 'comores_component_outside_km')).toBe(true);
    expect(c.warnings.join(' ')).toMatch(/hors marché KM/);
    expect(c.details.local_distribution).toBe(0);
  });

  it('une surcharge marché explicite (source market_override) s\'applique hors KM', () => {
    const own = { ...PORT, source: 'market_override', default_value: 321 };
    const c = run(config('CM', {}, [own]));
    expect(keys(c)).toContain('transport_port_relais_kmf');
    expect(c.cost_scope.unknown_components).toEqual([]);
  });

  it('marché non déterminé : UNKNOWN (inconnu ≠ KM)', () => {
    const c = run(config(null));
    expect(c.cost_scope.unknown_components[0].reason).toBe('market_unknown');
  });

  it('le coût KM dépasse celui de CM de la seule part Comores', () => {
    const km = run(config('KM'), { destination_island: 'moheli' });
    const cm = run(config('CM'), { destination_island: 'moheli' });
    expect(km.variable_cost_estimated_kmf).toBeGreaterThan(cm.variable_cost_estimated_kmf);
  });
});

describe('P0-2 · LOCAL_STOCK', () => {
  it('aucun coût Hub, carton, temps acheteur, frais bancaires d\'achat, port → relais ; commission conservée', () => {
    const c = run(config('KM'), { provenance: 'LOCAL_STOCK' });
    expect(keys(c)).toEqual(['commission_relais_kmf']);
    expect(c.details.hub).toBe(0);
    expect(c.details.packaging).toBe(0);
    expect(c.details.sourcing).toBe(0);
    expect(c.details.product_cost).toBe(3000);
    expect(c.import_chain_not_applicable).toBe(true);
  });
});

describe('P0-2 · catégorie absente', () => {
  it('category_status UNKNOWN, plus de bascule silencieuse vers phones', () => {
    const c = run(config('KM'), {}, { cost_kmf: 3000, weight_kg: 1 });
    expect(c.category_status).toBe('UNKNOWN');
    expect(c._meta.category).toBeNull();
    expect(c.warnings.join(' ')).toMatch(/Catégorie absente/);
    expect(c.input_quality.level).toBe('low');
  });

  it('catégorie connue → KNOWN ; catégorie non configurée → UNKNOWN', () => {
    expect(run(config('KM')).category_status).toBe('KNOWN');
    expect(run(config('KM'), {}, { ...product, category: 'inconnue' }).category_status).toBe('UNKNOWN');
  });

  it('recommend expose category_status et cost_scope', async () => {
    const res = await engine.recommend({ cost_kmf: 3000, weight_kg: 1, volume_m3: 0.001 }, { config: config('KM') });
    expect(res.category).toBeNull();
    expect(res.category_status).toBe('UNKNOWN');
    expect(res.cost_scope.unknown_components).toHaveLength(2);
  });
});

describe('P0-2 · destination via relais et code marché', () => {
  beforeEach(() => db.query.mockReset());

  it('recommend lit l\'île du relais du même marché', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ island: 'Anjouan', market_id: 'm1' }] });
    const res = await engine.recommend({ category: 'phones', cost_kmf: 3000, relais_id: 'r1' },
      { config: config('KM', { market_id: 'm1' }) });
    expect(res.cost_scope.destination_island).toBe('anjouan');
    expect(res.allocations.map(a => a.component_key)).toContain('transport_inter_iles_anjouan_kmf');
  });

  it('relais d\'un autre marché ou erreur : destination inconnue', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ island: 'Anjouan', market_id: 'autre' }] });
    let res = await engine.recommend({ category: 'phones', cost_kmf: 3000, relais_id: 'r1' },
      { config: config('KM', { market_id: 'm1' }) });
    expect(res.cost_scope.destination_island).toBeNull();
    db.query.mockRejectedValueOnce(new Error('boom'));
    res = await engine.recommend({ category: 'phones', cost_kmf: 3000, relais_id: 'r1' }, { config: config('KM') });
    expect(res.cost_scope.destination_island).toBeNull();
  });

  it('destination_island explicite prioritaire', async () => {
    const res = await engine.recommend({ category: 'phones', cost_kmf: 3000, destination_island: 'Mohéli' }, { config: config('KM') });
    expect(res.cost_scope.destination_island).toBe('moheli');
  });

  it('loadGlobalConfig(marketId) charge le code marché', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM cost_components cc/.test(sql)) return { rows: [] };
      if (/FROM markets/.test(sql)) return { rows: [{ code: 'CM' }] };
      return { rows: [] };
    });
    const cfg = await loadGlobalConfig({ marketId: 'm-cm' });
    expect(cfg.market_code).toBe('CM');
    db.query.mockImplementation(async (sql) => {
      if (/FROM markets/.test(sql)) throw new Error('boom');
      return { rows: [] };
    });
    expect((await loadGlobalConfig({ marketId: 'm-cm' })).market_code).toBeNull();
  });
});

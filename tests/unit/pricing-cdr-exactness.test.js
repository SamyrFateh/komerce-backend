'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * #3830 P0-1 : exactitude du CDR à hypothèses et données constantes.
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/fx-engine-rates', () => ({
  withAuthorityRates: async (fc) => fc,
}));

const { computeCDR } = require('../../services/pricing-cdr');
const { computePrices, computeScenarios } = require('../../services/pricing-output');
const engine = require('../../services/pricing-engine');

const finance = {
  taux_change_eur_kmf: 495, taux_aed_kmf: 139, taux_usd_kmf: 450, fret_eur_per_m3: 180,
  objectif_commandes_mois: 100, avg_articles_per_order: 2.5, avg_articles_per_parcel: 4,
  avg_articles_per_shipment: 200, target_marge_brute_pct: 40, minimum_safety_margin_pct: 10,
};
const cat = { default_margin_pct: 30, default_weight_kg: 0.4 };
const mk = (key, category, default_value, unit, allocation_method = null, extra = {}) =>
  ({ key, category, default_value, unit, allocation_method, applies_to: 'all', source: 'default', confidence: 'medium', ...extra });
const COMPONENTS = [
  mk('frais_bancaires_achat_pct', 'product_purchase', 1.5, 'pct'),
  mk('sourcing_temps_acheteur_kmf', 'sourcing', 200, 'kmf_per_order', null, { confidence: 'low' }),
  mk('hub_controle_kmf', 'hub', 150, 'kmf_per_parcel'),
  mk('fret_maritime_eur_m3', 'freight', 180, 'eur', 'by_volume'),
  mk('assurance_transport_pct', 'freight', 0.5, 'pct'),
  mk('frais_inspection_douane_kmf', 'customs', 5000, 'kmf_per_shipment'),
  mk('transitaire_kmf', 'port_transitary', 3, 'pct'),
  mk('transport_port_relais_kmf', 'local_distribution', 500, 'kmf_per_parcel'),
  mk('commission_relais_kmf', 'relay', 600, 'kmf_per_order'),
  mk('stripe_pct', 'payment', 1.5, 'pct'),
  mk('cash_collecte_kmf', 'payment', 200, 'kmf_per_order'),
  mk('provision_non_collecte_pct', 'risk_provision', 2, 'pct'),
  mk('provision_casse_transport_pct', 'risk_provision', 1, 'pct'),
  mk('charges_fixes_mensuelles_kmf', 'fixed_overhead', 100, 'kmf_per_order'),
];
const cfg = (components = COMPONENTS, extra = {}) => ({
  finance, categories: { phones: cat }, components, provisions: [], charges: [], market_code: 'KM', ...extra,
});
const run = (config, product = { category: 'phones', cost_kmf: 3000, weight_kg: 1 }, volume = 0.001, channel = 'cash_relais') =>
  computeCDR(product, { config, volume_m3: volume, channel });
const sumLines = (d) => d.product_cost + d.sourcing + d.hub + d.packaging + d.freight + d.customs
  + d.port_transitaire + d.local_distribution + d.relay + d.payment + d.risks;

describe('P0-1 · fret unique', () => {
  it('un composant de fret au volume exclut le calcul en dur', () => {
    const c = run(cfg());
    expect(c._meta.freight_source).toBe('component');
    expect(c.details._allocations.find(a => a.component_key === 'freight_default_estimate')).toBeUndefined();
    // 0,001 m3 x 180 EUR x 495 = 89,1 (une seule fois) + assurance
    const fret = c.details._allocations.find(a => a.component_key === 'fret_maritime_eur_m3');
    expect(fret.allocated_cost_kmf).toBe(89);
    expect(c.details.freight).toBeLessThan(89 * 2);
  });

  it('sans composant de fret au volume : estimation par repli, marquée et signalée', () => {
    const c = run(cfg(COMPONENTS.filter(x => x.key !== 'fret_maritime_eur_m3')));
    expect(c._meta.freight_source).toBe('fallback_estimate');
    const est = c.details._allocations.find(a => a.component_key === 'freight_default_estimate');
    expect(est.allocated_cost_kmf).toBe(89);
    expect(est.source).toBe('estimate');
    expect(c.warnings.join(' ')).toMatch(/Fret estimé par repli/);
    expect(c.input_quality.fallbacks.map(f => f.field)).toContain('freight');
  });

  it('stock local : aucun fret', () => {
    const c = computeCDR({ category: 'phones', cost_kmf: 3000, weight_kg: 1 },
      { config: cfg(), volume_m3: 0.001, provenance: 'LOCAL_STOCK' });
    expect(c.details.freight).toBe(0);
    expect(c._meta.freight_source).toBe('not_applicable');
  });
});

describe('P0-1 · total visible = total du plancher', () => {
  it.each([
    ['fixture', { category: 'phones', cost_kmf: 3000, weight_kg: 1 }, 0.001],
    ['60 000', { category: 'phones', cost_kmf: 60000, weight_kg: 0.4 }, 0.002],
    ['volumineux', { category: 'phones', cost_kmf: 25000, weight_kg: 12 }, 0.15],
  ])('Σ lignes affichées = variable = base de computePrices (%s)', (_l, product, vol) => {
    const c = run(cfg(), product, vol);
    expect(sumLines(c.details)).toBe(c.variable_cost_estimated_kmf);
    expect(c.details.risks).toBeGreaterThan(0);
    expect(c.risk_provision_estimated_kmf).toBe(c.details.risks);
    const p = computePrices(c, cat, finance);
    // plancher = variable x (1 + marge de sécurité), au rond psychologique près
    expect(p.minimum_safe_price_kmf).toBeGreaterThanOrEqual(Math.round(c.variable_cost_estimated_kmf * 1.1));
    expect(p.minimum_safe_price_kmf).toBeLessThan(Math.round(c.variable_cost_estimated_kmf * 1.1) + 1000);
  });

  it('fixed_overhead reste en structure : hors variable, visible dans fixed_costs', () => {
    const c = run(cfg());
    expect(c.details.fixed_costs).toBeGreaterThan(0);
    const sans = run(cfg(COMPONENTS.filter(x => x.category !== 'fixed_overhead')));
    expect(c.variable_cost_estimated_kmf).toBe(sans.variable_cost_estimated_kmf);
    const line = c.details._allocations.find(a => a.component_key === 'charges_fixes_mensuelles_kmf');
    expect(line.economic_nature).toBe('fixed');
    // le filtre de computeScenarios devient opérant
    const prices = computePrices(c, cat, finance);
    const sc = computeScenarios(c, prices, cat, finance);
    expect(sc.length).toBeGreaterThan(0);
  });

  it('les provisions de la table risk_provisions s\'ajoutent au risque affiché', () => {
    const c = run(cfg(COMPONENTS, { provisions: [{ id: 1, rate_pct: 1 }] }));
    const sans = run(cfg());
    expect(c.details.risks).toBeGreaterThan(sans.details.risks);
    expect(sumLines(c.details)).toBe(c.variable_cost_estimated_kmf);
  });
});

describe('P0-1 · assiettes % explicites, indépendantes de l\'ordre', () => {
  it('permuter l\'ordre des composants donne le même résultat', () => {
    const a = run(cfg(COMPONENTS));
    const b = run(cfg(COMPONENTS.slice().reverse()));
    const c = run(cfg([...COMPONENTS.slice(5), ...COMPONENTS.slice(0, 5)]));
    for (const x of [b, c]) {
      expect(x.variable_cost_estimated_kmf).toBe(a.variable_cost_estimated_kmf);
      expect(x.details).toMatchObject({ ...a.details, _allocations: expect.any(Array) });
    }
  });

  it('achat / CIF / prix : chaque % a sa base', () => {
    const c = run(cfg(), { category: 'phones', cost_kmf: 10000, weight_kg: 1 }, 0.01, 'diaspora');
    const line = (k) => c.details._allocations.find(a => a.component_key === k);
    expect(line('frais_bancaires_achat_pct')).toMatchObject({ pct_basis: 'purchase', allocated_cost_kmf: 150 });
    const fret = line('fret_maritime_eur_m3').allocated_cost_kmf; // 0,01 x 180 x 495 = 891
    expect(fret).toBe(891);
    const cif = 10000 + 891;
    expect(line('assurance_transport_pct')).toMatchObject({ pct_basis: 'cif', allocated_cost_kmf: Math.round(cif * 0.005) });
    expect(line('transitaire_kmf')).toMatchObject({ pct_basis: 'cif', allocated_cost_kmf: Math.round(cif * 0.03) });
    expect(line('stripe_pct')).toMatchObject({ pct_basis: 'price', allocation_basis: 'price' });
    expect(line('provision_non_collecte_pct').pct_basis).toBe('price');
    expect(line('provision_casse_transport_pct')).toMatchObject({ pct_basis: 'cif', allocated_cost_kmf: Math.round(cif * 0.01) });
  });
});

describe('P0-1 · frais de paiement et non-collecte sur le prix', () => {
  it('plancher = V·(1+s)/(1−Σ%prix·(1+s)) et frais = taux x prix de résolution', () => {
    const c = run(cfg(), undefined, 0.001, 'diaspora');
    const rate = 0.015 + 0.02; // stripe + non-collecte ; la casse (1 %) est sur CIF
    const v0 = c.price_independent_cost_kmf;
    const pFloor = (v0 * 1.1) / (1 - rate * 1.1);
    expect(c._meta.price_basis_kmf).toBe(Math.round(pFloor));
    const stripe = c.details._allocations.find(a => a.component_key === 'stripe_pct');
    expect(stripe.allocated_cost_kmf).toBe(Math.round(pFloor * 0.015));
    expect(c.variable_cost_estimated_kmf * 1.1).toBeCloseTo(pFloor, -1);
  });

  it('référence = V0 / (1 − Σ%prix − marge cible) ; marge de sécurité et cible restent séparées', () => {
    const c = run(cfg(), undefined, 0.001, 'diaspora');
    const p = computePrices(c, cat, finance);
    const raw = c.price_independent_cost_kmf / (1 - 0.035 - 0.3);
    expect(p.economic_reference_price_kmf).toBeGreaterThanOrEqual(Math.round(raw));
    expect(p.economic_reference_price_kmf).toBeLessThan(raw + 1000);
    expect(p.target_margin_pct).toBe(30);
    expect(p.safety_margin_pct).toBe(10);
    expect(p.minimum_safe_price_kmf).toBeLessThan(p.economic_reference_price_kmf);
    // à ce prix, la marge après frais sur le prix vaut la cible
    const costAtRef = c.price_independent_cost_kmf + 0.035 * raw;
    expect((raw - costAtRef) / raw).toBeCloseTo(0.3, 5);
  });

  it('sans % sur le prix : formule historique inchangée', () => {
    const sans = run(cfg(COMPONENTS.filter(x => !['payment', 'risk_provision'].includes(x.category) || x.unit !== 'pct')));
    expect(sans.price_based_cost_rate).toBe(0);
    const p = computePrices(sans, cat, finance);
    expect(p.economic_reference_price_kmf).toBeGreaterThanOrEqual(Math.round(sans.variable_cost_estimated_kmf / 0.7));
  });

  it('taux sur le prix non résoluble : signalé, pas de division par zéro', () => {
    const c = run(cfg([...COMPONENTS, mk('x_pct', 'payment', 95, 'pct')]));
    expect(c.warnings.join(' ')).toMatch(/non résoluble/);
    expect(Number.isFinite(c.variable_cost_estimated_kmf)).toBe(true);
  });

  it('computeScenarios évalue le coût au prix du scénario', () => {
    const c = run(cfg());
    const prices = computePrices(c, cat, finance);
    const base = computeScenarios(c, prices, cat, finance)[0];
    expect(base.cost_imputed_kmf).toBeGreaterThanOrEqual(c.variable_cost_estimated_kmf);
    expect(base.margin_pct).toBeGreaterThan(0);
  });
});

describe('P0-1 · statut douane et qualité des entrées', () => {
  it('une inspection ne suffit pas : droits non estimés, inspection exposée à part', () => {
    const c = run(cfg());
    expect(c.customs_estimate_status).toBe('not_estimated');
    expect(c.customs_inspection_kmf).toBe(25);
    expect(c.customs_duties_kmf).toBe(0);
    expect(c.details.customs).toBe(25);
    expect(c.warnings.join(' ')).toMatch(/Douane non estimée/);
    expect(c.input_quality.unknown).toContain('customs_duties');
  });

  it('un composant de droits rend le statut cost_component', () => {
    const c = run(cfg([...COMPONENTS, mk('droits_douane_pct', 'customs', 10, 'pct')]));
    expect(c.customs_estimate_status).toBe('cost_component');
    expect(c.customs_duties_kmf).toBeGreaterThan(0);
  });

  it('composant douane hors liste fermée d\'inspection = droits (même avec « frais » dans la clé)', () => {
    const c = run(cfg([...COMPONENTS, mk('frais_droits_douane', 'customs', 10, 'pct')]));
    expect(c.customs_estimate_status).toBe('cost_component');
    expect(c.customs_duties_kmf).toBeGreaterThan(0);
    expect(c.customs_inspection_kmf).toBe(25);
  });

  it('qualité : règle sans seuil — high / medium / low', () => {
    const real = (x) => ({ ...x, source: 'real', confidence: 'high' });
    const base = COMPONENTS.map(real);
    const p = { category: 'phones', cost_kmf: 3000, weight_kg: 1 };
    const q = (comps, prod = p, ctxCfg = {}) => computeCDR(prod, { config: cfg(comps, ctxCfg), volume_m3: 0.001 }).input_quality;
    expect(q(base).level).toBe('high');
    // une ligne estimée (source default, confiance medium) sans repli ⇒ medium
    expect(q(base.map((x, i) => (i === 1 ? { ...x, source: 'default', confidence: 'medium' } : x))).level).toBe('medium');
    // une ligne de confiance low ⇒ low
    expect(q(base.map((x, i) => (i === 1 ? { ...x, confidence: 'low' } : x))).level).toBe('low');
    // achat inconnu / catégorie inconnue / repli default ⇒ low
    expect(q(base, { ...p, cost_kmf: 0 }).level).toBe('low');
    expect(q(base, { ...p, category: 'zzz' }).level).toBe('low');
    expect(computeCDR({ category: 'phones', cost_kmf: 3000 }, { config: { ...cfg(base), categories: { phones: {} } } }).input_quality.level).toBe('low');
  });

  it('qualité des entrées : fixture 100 % estimée → low ; entrées mesurées → high', () => {
    expect(run(cfg()).input_quality).toMatchObject({ level: 'low' });
    const measured = COMPONENTS.map(x => ({ ...x, source: 'real', confidence: 'high' }))
      .concat([{ ...mk('droits_pct', 'customs', 10, 'pct'), source: 'real', confidence: 'high' }]);
    const c = computeCDR({ category: 'phones', cost_kmf: 3000, weight_kg: 1 },
      { config: cfg(measured), volume_m3: 0.001 });
    expect(c.input_quality.level).toBe('high');
    expect(c.input_quality.estimated_cost_share_pct).toBe(0);
  });
});

describe('P0-1 · propagation par pricing-engine.recommend', () => {
  it('expose statut douane, inspection, qualité et confiance de la santé', async () => {
    const res = await engine.recommend(
      { category: 'phones', cost_kmf: 3000, weight_kg: 1, volume_m3: 0.001, current_price_kmf: 10000 },
      { config: cfg() },
    );
    expect(res.customs_estimate_status).toBe('not_estimated');
    expect(res.customs_inspection_kmf).toBe(25);
    expect(res.health_status).toBe('strong');
    expect(res.health_status_confidence).toBe('low');
    expect(res.input_quality.estimated_cost_share_pct).toBeGreaterThan(50);
    expect(res.warnings.join(' ')).toMatch(/Santé « strong »/);
    expect(res.variable_cost_complete_kmf).toBe(res.variable_cost_estimated_kmf);
  });
});

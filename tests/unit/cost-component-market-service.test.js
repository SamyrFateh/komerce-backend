'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const db = require('../../db');
const service = require('../../services/cost-component-market-service');

describe('cost-component-market-service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('projection hérite du global sans override et qualifie la charge', () => {
    expect(service.effectiveRow({
      id: 'cc-1', key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight',
      economic_nature: 'variable', allocation_perimeter: 'direct',
      base_default_value: '1000', unit: 'kmf_per_shipment', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false, override_id: null,
    })).toMatchObject({
      key: 'freight', default_value: 1000, is_active: true, inherited: true,
      economic_nature: 'variable', allocation_perimeter: 'direct',
    });
  });

  test('projection garde un fallback de compatibilité pour les lignes non migrées', () => {
    expect(service.effectiveRow({
      id: 'cc-2', key: 'fixed', label: 'Structure', family: 'business', category: 'fixed_overhead',
      base_default_value: '5000', unit: 'kmf', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false, override_id: null,
    })).toMatchObject({ economic_nature: 'fixed', allocation_perimeter: 'direct' });
  });

  test('projection applique valeur et activation du marché', () => {
    expect(service.effectiveRow({
      id: 'cc-1', key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight',
      economic_nature: 'variable', allocation_perimeter: 'mutualized',
      base_default_value: '1000', unit: 'kmf_per_shipment', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false,
      override_id: 'ov-1', override_default_value: '1250', override_is_active: false, override_notes: 'CM',
    })).toMatchObject({
      key: 'freight', default_value: 1250, is_active: false, base_default_value: 1000, inherited: false,
      economic_nature: 'variable', allocation_perimeter: 'mutualized',
    });
  });

  test('listEffectiveComponents borne la jointure par market_id et sélectionne la classification économique', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await service.listEffectiveComponents('market-cm');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('o.market_id = $1'), ['market-cm']);
    expect(db.query.mock.calls[0][0]).toContain('cc.economic_nature');
    expect(db.query.mock.calls[0][0]).toContain('cc.allocation_perimeter');
  });
});


describe('#3994 P0 — audit du marché et de la commission, sans décision de prix', () => {
  const market = code => ({ id: 'market-' + code.toLowerCase(), code, currency: code === 'KM' ? 'KMF' : 'XAF' });
  const base = (key, category, overrides = {}) => service.effectiveRow({
    id: 'cc-' + key, key, label: key, category, family: 'landed_relay',
    base_default_value: '600', base_is_active: true, unit: 'kmf_per_order',
    allocation_method: 'per_order', source: 'default', confidence: 'medium',
    scope: 'global', override_id: null, is_exceptional: false, ...overrides,
  });

  test('CM/CG : fret hérité indécidable, override ne prouve jamais un devis', () => {
    for (const code of ['CM', 'CG']) {
      const inherited = base('fret_dubai', 'freight');
      const override = base('transit_local', 'transit', {
        override_id: 'override-' + code, override_default_value: '900',
        override_is_active: true, override_notes: 'Tarif hypothétique marché',
      });
      const a = service.auditEffectiveMarketCosts({
        market: market(code), components: [inherited, override], asOf: '2026-11-13',
      });
      expect(a).toMatchObject({
        read_only: true, certified: false, no_price_activation: true,
        status: 'NON_DECISIONNEL', market_code: code, market_currency: 'XAF',
      });
      expect(a.issues).toContainEqual({
        code: 'INHERITED_CORRIDOR_UNVERIFIED', component_key: 'fret_dubai',
      });
      expect(a.components.find(c => c.key === 'transit_local')).toMatchObject({
        market_override: true, cost_evidence_status: 'NOT_VERIFIED',
        scope_status: 'MARKET_OVERRIDE_SCOPE_ONLY',
      });
      expect(a.issues).not.toContainEqual(expect.objectContaining({ component_key: 'transit_local' }));
    }
  });

  test('KM ne transforme pas un composant hérité en devis certifié; hors KM signale les clés et îles', () => {
    const port = base('transport_port_relais_kmf', 'local_distribution');
    const moheli = base('transport_inter_iles_moheli_kmf', 'local_distribution', { island: 'moheli' });
    const km = service.auditEffectiveMarketCosts({ market: market('KM'), components: [port], asOf: '2026-11-13' });
    expect(km.components[0].scope_status).toBe('BASE_CORRIDOR_QUOTE_UNVERIFIED');
    expect(km.components[0].cost_evidence_status).toBe('NOT_VERIFIED');
    const cm = service.auditEffectiveMarketCosts({ market: market('CM'), components: [port, moheli], asOf: '2026-11-13' });
    expect(cm.issues.filter(i => i.code === 'KM_SPECIFIC_UNVERIFIED_OUTSIDE_KM')).toHaveLength(2);
  });

  test('commission canonique per_order : runtime cohérent, mais facture non certifiée', () => {
    const perOrder = base('commission_relais_kmf', 'relay', {
      base_provenance: 'hypothèse projet', base_default_value: '500',
    });
    const result = service.auditEffectiveMarketCosts({
      market: market('KM'), components: [perOrder], asOf: '2026-11-13',
    });
    expect(result.components[0]).toMatchObject({
      relay_forecast_unit: 'per_order', relay_real_current_unit: 'per_order',
      relay_unit_consistent: true, base_provenance_declared: true,
      cost_evidence_status: 'NOT_VERIFIED',
    });
    expect(result.issues).toEqual([]);
    expect(result.certified).toBe(false);

    const perItem = base('commission_par_article', 'relay', {
      unit: 'kmf', allocation_method: 'per_item',
    });
    const comparison = service.auditEffectiveMarketCosts({
      market: market('KM'), components: [perItem], asOf: '2026-11-13',
    });
    expect(comparison.components[0].relay_unit_consistent).toBe(false);
    expect(comparison.issues).toContainEqual({
      code: 'RELAY_FORECAST_REAL_UNIT_MISMATCH', component_key: 'commission_par_article',
    });
  });

  test('composants désactivés, exceptionnels ou hors date : listés mais jamais imputés aux alertes actives', () => {
    const cases = [
      base('freight_disabled', 'freight', { base_is_active: false }),
      base('freight_exception', 'freight', { is_exceptional: true }),
      base('freight_future', 'freight', { active_from: '2026-12-01' }),
      base('freight_expired', 'freight', { active_until: '2026-10-31' }),
    ];
    const r = service.auditEffectiveMarketCosts({ market: market('CM'), components: cases, asOf: '2026-11-13' });
    expect(r.summary.active_components).toBe(0);
    expect(r.summary.unresolved_issues).toBe(0);
    expect(r.components.every(x => x.is_effective === false)).toBe(true);
  });

  test('une seule requête SELECT scoppée par le market_id résolu côté serveur', async () => {
    db.query.mockResolvedValueOnce({ rows: [{
      id: 'comp-1', key: 'fret', category: 'freight', family: 'landed_relay',
      base_default_value: '500', base_is_active: true, override_id: null,
    }] });
    const result = await service.buildMarketEconomicP0Audit(market('CM'), {
      q: db, asOf: '2026-11-13',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0].trimStart()).toMatch(/^SELECT /);
    expect(db.query.mock.calls[0][0]).toContain('o.market_id = $1');
    expect(db.query.mock.calls[0][1]).toEqual(['market-cm']);
    expect(result.market_code).toBe('CM');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INHERITED_CORRIDOR_UNVERIFIED' }));
  });
});

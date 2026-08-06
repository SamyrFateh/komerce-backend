'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/_helpers.test.js
 * Couvre services/dashboard-metrics/_helpers.js
 *
 * Note : _round() est definie dans le module mais n'est ni exportee ni
 * appelee ailleurs dans ce fichier (code mort ou reserve a un usage futur) —
 * non testable directement, hors scope de ce test.
 */
const {
  buildFiltersClause,
  buildPreviousPeriod,
  computeDelta,
  makeKpi,
  ACTIVE_ORDER_STATUSES,
  VALID_PAID_STATUSES,
  TRANSIT_PARCEL_STATUSES,
  EXCLUDED_FROM_REVENUE,
  EXPECTED_VARIABLE_COSTS,
  EXPECTED_FIXED_COSTS,
  EXPECTED_PAYMENT_COSTS,
} = require('../../services/dashboard-metrics/_helpers');

describe('constantes', () => {
  it('exposent des tableaux figes (Object.freeze)', () => {
    expect(Object.isFrozen(ACTIVE_ORDER_STATUSES)).toBe(true);
    expect(Object.isFrozen(VALID_PAID_STATUSES)).toBe(true);
    expect(Object.isFrozen(TRANSIT_PARCEL_STATUSES)).toBe(true);
    expect(Object.isFrozen(EXCLUDED_FROM_REVENUE)).toBe(true);
    expect(Object.isFrozen(EXPECTED_VARIABLE_COSTS)).toBe(true);
    expect(Object.isFrozen(EXPECTED_FIXED_COSTS)).toBe(true);
    expect(Object.isFrozen(EXPECTED_PAYMENT_COSTS)).toBe(true);
  });

  it('ACTIVE_ORDER_STATUSES contient les statuts attendus', () => {
    expect(ACTIVE_ORDER_STATUSES).toEqual([
      'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available',
    ]);
  });

  it('EXCLUDED_FROM_REVENUE et VALID_PAID_STATUSES sont disjoints', () => {
    const overlap = EXCLUDED_FROM_REVENUE.filter(s => VALID_PAID_STATUSES.includes(s));
    expect(overlap).toEqual([]);
  });
});

describe('buildFiltersClause', () => {
  it('aucun filtre → where "1=1", params vides, nextParamIndex 1', () => {
    const result = buildFiltersClause({});
    expect(result.where).toBe('1=1');
    expect(result.params).toEqual([]);
    expect(result.nextParamIndex).toBe(1);
  });

  it('filtres absents (appel sans argument) → meme resultat par defaut', () => {
    const result = buildFiltersClause();
    expect(result.where).toBe('1=1');
    expect(result.params).toEqual([]);
  });

  it('tous les filtres fournis → clause complete avec alias par defaut "o"', () => {
    const result = buildFiltersClause({
      from: '2026-01-01', to: '2026-01-31', island: 'Ngazidja',
      relais_id: 'r1', status: 'shipped', payment_status: 'paid',
    });
    expect(result.where).toBe(
      '1=1 AND o.created_at >= $1 AND o.created_at <= $2 AND o.destination_island = $3 ' +
      'AND o.relais_id = $4 AND o.status::text = $5 AND o.payment_status::text = $6'
    );
    expect(result.params).toEqual(['2026-01-01', '2026-01-31', 'Ngazidja', 'r1', 'shipped', 'paid']);
    expect(result.nextParamIndex).toBe(7);
  });

  it('alias personnalise → utilise dans toutes les clauses', () => {
    const result = buildFiltersClause({ island: 'Anjouan' }, 'ord');
    expect(result.where).toBe('1=1 AND ord.destination_island = $1');
  });

  it('filtre partiel → seuls les params fournis generent une clause', () => {
    const result = buildFiltersClause({ status: 'paid' });
    expect(result.where).toBe('1=1 AND o.status::text = $1');
    expect(result.params).toEqual(['paid']);
  });
});

describe('buildPreviousPeriod', () => {
  it('from ou to manquant → retourne null', () => {
    expect(buildPreviousPeriod({ from: '2026-01-01' })).toBeNull();
    expect(buildPreviousPeriod({ to: '2026-01-31' })).toBeNull();
    expect(buildPreviousPeriod({})).toBeNull();
  });

  it('dates invalides → retourne null (pas de crash)', () => {
    expect(buildPreviousPeriod({ from: 'pas-une-date', to: '2026-01-31' })).toBeNull();
  });

  it('to anterieur ou egal a from (duree <= 0) → retourne null', () => {
    expect(buildPreviousPeriod({ from: '2026-01-31', to: '2026-01-01' })).toBeNull();
    expect(buildPreviousPeriod({ from: '2026-01-01', to: '2026-01-01' })).toBeNull();
  });

  it('periode de 30 jours → periode anterieure de meme duree juste avant', () => {
    const result = buildPreviousPeriod({ from: '2026-04-01T00:00:00.000Z', to: '2026-05-01T00:00:00.000Z' });
    expect(result.to).toBe('2026-04-01T00:00:00.000Z');
    expect(result.from).toBe('2026-03-02T00:00:00.000Z');
  });

  it('conserve les autres filtres (island, status, etc.)', () => {
    const result = buildPreviousPeriod({ from: '2026-01-01', to: '2026-01-31', island: 'Moheli' });
    expect(result.island).toBe('Moheli');
  });
});

describe('computeDelta', () => {
  it('previousValue null → non comparable, direction flat', () => {
    const result = computeDelta(100, null, 'periode precedente');
    expect(result).toEqual({ value: null, unit: '%', direction: 'flat', vs_period: 'periode precedente', is_comparable: false });
  });

  it('previousValue = 0 → non comparable (division par zero evitee)', () => {
    const result = computeDelta(100, 0, 'periode precedente');
    expect(result.is_comparable).toBe(false);
    expect(result.value).toBeNull();
  });

  it('hausse → direction "up", pourcentage positif arrondi a 2 decimales', () => {
    const result = computeDelta(150, 100, 'M-1');
    expect(result.direction).toBe('up');
    expect(result.value).toBe(50);
    expect(result.is_comparable).toBe(true);
  });

  it('baisse → direction "down", pourcentage negatif', () => {
    const result = computeDelta(50, 100, 'M-1');
    expect(result.direction).toBe('down');
    expect(result.value).toBe(-50);
  });

  it('valeur identique → direction "flat", value 0', () => {
    const result = computeDelta(100, 100, 'M-1');
    expect(result.direction).toBe('flat');
    expect(result.value).toBe(0);
  });

  it('previousValue negatif → utilise la valeur absolue pour le denominateur', () => {
    const result = computeDelta(-50, -100, 'M-1');
    // diff = 50, |previous| = 100 → +50%
    expect(result.value).toBe(50);
    expect(result.direction).toBe('up');
  });
});

describe('makeKpi', () => {
  it('format minimal sans options → defaults appliques', () => {
    const kpi = makeKpi('ca_total', 'CA total', 125000, 'KMF');
    expect(kpi).toEqual({
      key: 'ca_total',
      label: 'CA total',
      value: 125000,
      unit: 'KMF',
      delta: null,
      data_quality: { completeness: 'complete', items_total: null, items_with_data: null, warning: null },
      drill_to: null,
    });
  });

  it('options completes → toutes les valeurs reportees', () => {
    const delta = { value: 12.5, unit: '%', direction: 'up', vs_period: 'M-1', is_comparable: true };
    const kpi = makeKpi('marge', 'Marge', 5000, 'KMF', {
      delta, completeness: 'partial', itemsTotal: 10, itemsWithData: 7,
      warning: 'donnees incompletes', drillTo: '/dashboard/marge',
    });
    expect(kpi.delta).toBe(delta);
    expect(kpi.data_quality).toEqual({ completeness: 'partial', items_total: 10, items_with_data: 7, warning: 'donnees incompletes' });
    expect(kpi.drill_to).toBe('/dashboard/marge');
  });

  it('value null (donnee absente) → ne crash pas, value reste null', () => {
    expect(() => makeKpi('x', 'X', null, 'KMF')).not.toThrow();
    expect(makeKpi('x', 'X', null, 'KMF').value).toBeNull();
  });

  it('itemsTotal/itemsWithData = 0 → conserve 0, pas de fallback null (verifie le != null)', () => {
    const kpi = makeKpi('x', 'X', 0, 'KMF', { itemsTotal: 0, itemsWithData: 0 });
    expect(kpi.data_quality.items_total).toBe(0);
    expect(kpi.data_quality.items_with_data).toBe(0);
  });
});

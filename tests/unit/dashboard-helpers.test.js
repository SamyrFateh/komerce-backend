'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
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

describe('dashboard-metrics/_helpers', () => {
  it('buildFiltersClause compose un WHERE parametre dans lordre attendu', () => {
    const result = buildFiltersClause({
      from: '2026-06-01',
      to: '2026-06-30',
      island: 'Anjouan',
      relais_id: 'relais-001',
      status: 'available',
      payment_status: 'paid',
    }, 'ord');

    expect(result).toEqual({
      where: '1=1 AND ord.created_at >= $1 AND ord.created_at <= $2 AND ord.destination_island = $3 AND ord.relais_id = $4 AND ord.status::text = $5 AND ord.payment_status::text = $6',
      params: ['2026-06-01', '2026-06-30', 'Anjouan', 'relais-001', 'available', 'paid'],
      nextParamIndex: 7,
    });
  });

  it('buildFiltersClause retourne une clause neutre sans filtre', () => {
    expect(buildFiltersClause()).toEqual({ where: '1=1', params: [], nextParamIndex: 1 });
  });

  it('buildPreviousPeriod retourne la periode precedente de meme duree', () => {
    const previous = buildPreviousPeriod({ from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T00:00:00.000Z', island: 'Anjouan' });

    expect(previous.island).toBe('Anjouan');
    expect(previous.to).toBe('2026-04-01T00:00:00.000Z');
    expect(previous.from).toBe('2026-03-03T00:00:00.000Z');
  });

  it('buildPreviousPeriod retourne null si periode invalide ou incomplete', () => {
    expect(buildPreviousPeriod({ from: '2026-04-01' })).toBeNull();
    expect(buildPreviousPeriod({ from: 'bad', to: '2026-04-01' })).toBeNull();
    expect(buildPreviousPeriod({ from: '2026-04-30', to: '2026-04-01' })).toBeNull();
  });

  it('computeDelta gere hausse, baisse, flat et absence de comparaison', () => {
    expect(computeDelta(150, 100, 'prev')).toEqual({ value: 50, unit: '%', direction: 'up', vs_period: 'prev', is_comparable: true });
    expect(computeDelta(50, 100, 'prev')).toMatchObject({ value: -50, direction: 'down', is_comparable: true });
    expect(computeDelta(100, 100, 'prev')).toMatchObject({ value: 0, direction: 'flat', is_comparable: true });
    expect(computeDelta(100, 0, 'prev')).toEqual({ value: null, unit: '%', direction: 'flat', vs_period: 'prev', is_comparable: false });
  });

  it('makeKpi applique la structure dashboard standard', () => {
    expect(makeKpi('ca', 'CA', 1000, 'KMF', {
      delta: { value: 10 }, completeness: 'partial', itemsTotal: 10, itemsWithData: 8, warning: 'missing', drillTo: '/admin/ca',
    })).toEqual({
      key: 'ca',
      label: 'CA',
      value: 1000,
      unit: 'KMF',
      delta: { value: 10 },
      data_quality: { completeness: 'partial', items_total: 10, items_with_data: 8, warning: 'missing' },
      drill_to: '/admin/ca',
    });
  });

  it('expose les constantes metier attendues', () => {
    expect(ACTIVE_ORDER_STATUSES).toContain('available');
    expect(VALID_PAID_STATUSES).toEqual(['paid']);
    expect(TRANSIT_PARCEL_STATUSES).toContain('in_transit');
    expect(EXCLUDED_FROM_REVENUE).toEqual(['cancelled', 'refunded']);
    expect(EXPECTED_VARIABLE_COSTS).toEqual(expect.arrayContaining(['product_purchase', 'freight', 'customs']));
    expect(EXPECTED_FIXED_COSTS).toContain('fixed_overhead');
    expect(EXPECTED_PAYMENT_COSTS).toEqual(['payment']);
  });
});

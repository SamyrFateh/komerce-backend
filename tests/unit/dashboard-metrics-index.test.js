'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
describe('dashboard-metrics/index', () => {
  it('re-exporte linterface publique canonique du dashboard', () => {
    const metrics = require('../../services/dashboard-metrics');

    [
      'buildFiltersClause', 'buildPreviousPeriod', 'computeDelta', 'makeKpi',
      'getCAEncaisse', 'getCmdsCreees', 'getCmdsActives', 'getColisEnTransit',
      'getAlertesCritiques', 'getCmdsBloquees', 'getTauxCompletudeScans', 'getTauxCompletudeCouts',
      'getCAVendu', 'getCoutEstime', 'getCoutReel', 'getMargeEstimee', 'getMargeVariableReelle',
      'getMargeConsolidee', 'getCmdsCoutIncompletCount', 'getCmdsCoutIncompletIds', 'getCoutMoyParCmd',
      'getCmdsAujourdhui', 'getPaiementsEnAttente', 'getColisPreparation', 'getColisTransit',
      'getDisponiblesRelais', 'getRetardsCritiques', 'getTauxCollecteRelais',
    ].forEach((name) => expect(typeof metrics[name]).toBe('function'));

    expect(metrics.ACTIVE_ORDER_STATUSES).toContain('available');
    expect(metrics.TRANSIT_PARCEL_STATUSES).toContain('in_transit');
    expect(metrics.EXPECTED_VARIABLE_COSTS).toContain('freight');
    expect(metrics.EXPECTED_FIXED_COSTS).toContain('fixed_overhead');
    expect(metrics.EXPECTED_PAYMENT_COSTS).toEqual(['payment']);
  });
});

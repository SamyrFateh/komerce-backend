'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SERVICE = path.join(ROOT, 'services', 'dashboard-finance-canonical.js');
const UI = path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'finance.js');

describe('Finance Canonical coverage boundary', () => {
  test('Finance ne consomme pas les calculs économiques ni les snapshots Legacy', () => {
    const source = fs.readFileSync(SERVICE, 'utf8');
    expect(source).not.toContain("require('./economic-engine-queries')");
    expect(source).not.toContain("require('../services/economic-engine-queries')");
    expect(source).not.toContain('buildExecutiveSummary');
    expect(source).not.toContain('redistribute(');
    expect(source).not.toContain('economic_snapshots');
    expect(source).not.toContain('finance_config');
    expect(source).not.toContain('FROM charges');
  });

  test('les diagnostics commandes restent filtrés, distincts du résultat ECO mensuel', () => {
    const source = fs.readFileSync(SERVICE, 'utf8');
    expect(source).toContain("buildFiltersClause(filters, 'o')");
    expect(source).toContain('JOIN orders o ON o.id = alc.order_id');
    expect(source).toContain('EXPECTED_COST_TYPES');
    expect(source).toContain("order_margin_basis: 'historical_order_creation_cohort_diagnostic_not_eco_period_result'");
    expect(source).toContain('economic_global_engine_consumed: !market && economicPeriodResult.value != null');
    expect(source).toContain("require('./economic-cost-center-read-model')");
    expect(source).toContain('authority.readGroupPeriodDecision(actor, periodStart)');
    expect(source).toContain('authority.readMarketPeriodDecision(actor, market.code, periodStart)');
    expect(source).toContain('loadEconomicPeriodResult(options.actor, market, window,');
    expect(source).toContain('economic_period_result: Object.freeze(economicPeriodResult)');
    expect(source).toContain("return unavailable('SIMULATION_EXCLUDED')");
    expect(source).toContain("if (!actor?.id) return unavailable('UNAVAILABLE')");
  });

  test('le frontend ne contacte aucun endpoint économique ou costing Legacy', () => {
    const source = fs.readFileSync(UI, 'utf8');
    expect(source).not.toContain('/api/admin/economic');
    expect(source).not.toContain('/api/admin/costing');
    expect(source).toContain("href: '/admin/workspaces/accounting'");
    expect(source).toContain("href: '/admin/workspaces/pricing'");
  });
});

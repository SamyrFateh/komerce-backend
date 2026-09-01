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
  test('Finance ne consomme pas le moteur économique global ni les snapshots Legacy', () => {
    const source = fs.readFileSync(SERVICE, 'utf8');
    expect(source).not.toContain('economic-engine-queries');
    expect(source).not.toContain('buildExecutiveSummary');
    expect(source).not.toContain('redistribute(');
    expect(source).not.toContain('economic_snapshots');
    expect(source).not.toContain('finance_config');
    expect(source).not.toContain('FROM charges');
  });

  test('les nouvelles projections sont toutes reliées à orders et au filtre serveur', () => {
    const source = fs.readFileSync(SERVICE, 'utf8');
    expect(source).toContain("buildFiltersClause(filters, 'o')");
    expect(source).toContain('JOIN orders o ON o.id = alc.order_id');
    expect(source).toContain('EXPECTED_COST_TYPES');
    expect(source).toContain('economic_global_engine_consumed: false');
  });

  test('le frontend ne recrée aucune formule économique et drill vers les workspaces propriétaires', () => {
    const source = fs.readFileSync(UI, 'utf8');
    expect(source).not.toContain('economic-engine');
    expect(source).not.toContain('/api/admin/economic');
    expect(source).not.toContain('/api/admin/costing');
    expect(source).toContain("href: '/admin/workspaces/accounting'");
    expect(source).toContain("href: '/admin/workspaces/pricing'");
  });
});

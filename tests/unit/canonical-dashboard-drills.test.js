'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const pilotage = require('../../public/dashboards/canonical/js/pilotage');
const commerce = require('../../public/dashboards/canonical/js/commerce');
const operations = require('../../public/dashboards/canonical/js/operations');
const finance = require('../../public/dashboards/canonical/js/finance');

const PRIMARY_DASHBOARD_PATHS = new Set([
  '/admin/pilotage',
  '/admin/commerce',
  '/admin/operations',
  '/admin/finance',
]);

function hrefs(schema) {
  return schema.drill.map(item => item.href);
}

describe('Canonical dashboard drills', () => {
  test('Pilotage ne duplique plus la navigation globale', () => {
    expect(pilotage.PILOTAGE_SCHEMA.drill).toEqual([]);
  });

  test('Commerce approfondit vers ses surfaces métier', () => {
    expect(commerce.COMMERCE_SCHEMA.drill).toEqual([
      { id: 'catalog-workspace', label: 'Catalogue', href: '/admin/workspaces/catalog' },
      { id: 'sourcing-workspace', label: 'Sourcing', href: '/admin/workspaces/sourcing' },
      { id: 'pricing-workspace', label: 'Pricing', href: '/admin/workspaces/pricing' },
      { id: 'clients', label: 'Clients', href: '/admin/clients' },
    ]);
  });

  test('Opérations approfondit vers les deux workspaces opérationnels', () => {
    expect(operations.OPERATIONS_SCHEMA.drill).toEqual([
      { id: 'operations-workspace', label: 'Exécution Hub & Relais', href: '/admin/workspaces/operations' },
      { id: 'shipping-customs-workspace', label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs' },
    ]);
  });

  test('Finance approfondit uniquement vers Comptabilité', () => {
    expect(finance.FINANCE_SCHEMA.drill).toEqual([
      { id: 'accounting-workspace', label: 'Comptabilité & encaissements', href: '/admin/workspaces/accounting' },
    ]);
  });

  test('aucun drill ne recrée une navigation dashboard ou un alias de construction', () => {
    const schemas = [
      pilotage.PILOTAGE_SCHEMA,
      commerce.COMMERCE_SCHEMA,
      operations.OPERATIONS_SCHEMA,
      finance.FINANCE_SCHEMA,
    ];

    for (const schema of schemas) {
      for (const href of hrefs(schema)) {
        expect(href.startsWith('/admin-next')).toBe(false);
        expect(PRIMARY_DASHBOARD_PATHS.has(href)).toBe(false);
      }
    }
  });
});

'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const commerce = require('../../public/dashboards/canonical/js/commerce');
const operations = require('../../public/dashboards/canonical/js/operations');
const finance = require('../../public/dashboards/canonical/js/finance');

function ids(schema) {
  return schema.drill.map(item => item.id);
}

describe('Approfondir (drill) — filtrage par rôle (docs/admin-nav-capability-map.md)', () => {
  describe('Commerce', () => {
    test('admin voit les 4 liens', () => {
      const schema = commerce.visibleDrillSchema(commerce.COMMERCE_SCHEMA, { role: 'admin' });
      expect(ids(schema)).toEqual(['catalog-workspace', 'sourcing-workspace', 'pricing-workspace', 'clients']);
    });

    test('market_operator ne voit que Pricing — pas Catalogue, Sourcing ni Clients (admin only côté serveur)', () => {
      const schema = commerce.visibleDrillSchema(commerce.COMMERCE_SCHEMA, { role: 'market_operator' });
      expect(ids(schema)).toEqual(['pricing-workspace']);
    });

    test('sourcing ne voit que Sourcing', () => {
      const schema = commerce.visibleDrillSchema(commerce.COMMERCE_SCHEMA, { role: 'sourcing' });
      expect(ids(schema)).toEqual(['sourcing-workspace']);
    });

    test('rôle sans accès (support) ne voit aucun lien', () => {
      const schema = commerce.visibleDrillSchema(commerce.COMMERCE_SCHEMA, { role: 'support' });
      expect(ids(schema)).toEqual([]);
    });

    test('utilisateur absent (role vide) ne voit aucun lien', () => {
      const schema = commerce.visibleDrillSchema(commerce.COMMERCE_SCHEMA, null);
      expect(ids(schema)).toEqual([]);
    });
  });

  describe('Opérations', () => {
    test('admin voit les 2 liens', () => {
      const schema = operations.visibleDrillSchema(operations.OPERATIONS_SCHEMA, { role: 'admin' });
      expect(ids(schema)).toEqual(['operations-workspace', 'shipping-customs-workspace']);
    });

    test('market_operator voit Exécution Hub & Relais mais pas Expéditions & Douane', () => {
      const schema = operations.visibleDrillSchema(operations.OPERATIONS_SCHEMA, { role: 'market_operator' });
      expect(ids(schema)).toEqual(['operations-workspace']);
    });

    test('agent_hub voit les 2 liens (les deux guards l’incluent)', () => {
      const schema = operations.visibleDrillSchema(operations.OPERATIONS_SCHEMA, { role: 'agent_hub' });
      expect(ids(schema)).toEqual(['operations-workspace', 'shipping-customs-workspace']);
    });

    test('agent_relais voit Exécution Hub & Relais mais pas Expéditions & Douane', () => {
      const schema = operations.visibleDrillSchema(operations.OPERATIONS_SCHEMA, { role: 'agent_relais' });
      expect(ids(schema)).toEqual(['operations-workspace']);
    });

    test('agent_transitaire voit Expéditions & Douane mais pas Exécution Hub & Relais', () => {
      const schema = operations.visibleDrillSchema(operations.OPERATIONS_SCHEMA, { role: 'agent_transitaire' });
      expect(ids(schema)).toEqual(['shipping-customs-workspace']);
    });
  });

  describe('Finance', () => {
    test('admin voit les 2 liens', () => {
      const schema = finance.visibleDrillSchema(finance.FINANCE_SCHEMA, { role: 'admin' });
      expect(ids(schema)).toEqual(['accounting-workspace', 'pricing-workspace']);
    });

    test('finance voit Comptabilité mais pas Pricing (pricing-workspace est admin/market_operator only côté serveur)', () => {
      const schema = finance.visibleDrillSchema(finance.FINANCE_SCHEMA, { role: 'finance' });
      expect(ids(schema)).toEqual(['accounting-workspace']);
    });

    test('agent_relais voit Comptabilité mais pas Pricing', () => {
      const schema = finance.visibleDrillSchema(finance.FINANCE_SCHEMA, { role: 'agent_relais' });
      expect(ids(schema)).toEqual(['accounting-workspace']);
    });

    test('market_operator voit Pricing mais pas Comptabilité', () => {
      const schema = finance.visibleDrillSchema(finance.FINANCE_SCHEMA, { role: 'market_operator' });
      expect(ids(schema)).toEqual(['pricing-workspace']);
    });
  });

  test('visibleDrillSchema ne mute jamais le schema d’origine', () => {
    const before = JSON.stringify(commerce.COMMERCE_SCHEMA);
    commerce.visibleDrillSchema(commerce.COMMERCE_SCHEMA, { role: 'support' });
    expect(JSON.stringify(commerce.COMMERCE_SCHEMA)).toBe(before);
  });
});

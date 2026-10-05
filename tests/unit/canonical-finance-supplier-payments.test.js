'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const finance = require('../../public/dashboards/canonical/js/finance');

test('projette les montants fournisseur comme texte exact, sans conversion multi-devise', () => {
  const rows = finance.projectSupplierPaymentExceptions({
    supplier_payment_exceptions: [{
      provider: 'CJ',
      purchase_order_id: 'po-1',
      exception_type: 'ambiguous_result',
      status: 'ambiguous',
      reconciliation_status: 'unverified',
      expected_amount: '19.9900',
      observed_amount: null,
      currency: 'USD',
      real_debit_verified: false,
    }],
  });

  expect(rows).toEqual([{
    provider: 'CJ',
    po: 'po-1',
    exception: 'ambiguous_result',
    statut: 'ambiguous',
    rapprochement: 'unverified',
    attendu: '19.9900 USD',
    observe: '—',
    'debit-verifie': 'Non',
  }]);
});

test('le drill Achats fournisseurs est visible uniquement à admin', () => {
  const admin = finance.visibleDrillSchema(finance.FINANCE_SCHEMA, { role: 'admin' });
  const marketOperator = finance.visibleDrillSchema(finance.FINANCE_SCHEMA, { role: 'market_operator' });
  const financeRole = finance.visibleDrillSchema(finance.FINANCE_SCHEMA, { role: 'finance' });

  expect(admin.drill).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'purchasing-workspace', href: '/admin/workspaces/purchasing' }),
  ]));
  expect(marketOperator.drill.some(item => item.id === 'purchasing-workspace')).toBe(false);
  expect(financeRole.drill.some(item => item.id === 'purchasing-workspace')).toBe(false);
});

test('le schéma Finance expose une table dédiée sans KPI ou total fournisseur inventé', () => {
  const section = finance.FINANCE_SCHEMA.sections.find(item => item.id === 'paiements-fournisseur-exceptions');
  expect(section).toMatchObject({
    source: 'finance.supplier-payment-exceptions',
    type: 'table',
  });
  expect(section.description).toContain('Aucun total multi-devise');
});

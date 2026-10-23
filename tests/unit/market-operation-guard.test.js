'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature markets
 * @brief L13 — câblage du garde Q2 aux seules opérations ⛔ ; les obligations n'y passent pas.
 */
const fs = require('fs');
const path = require('path');
const { assertMarketOperationAllowed, OPERATION_STATUSES } = require('../../services/market-operation-guard');

const read = f => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

function executorFor(status) {
  return { query: jest.fn(async () => ({ rows: status ? [{ id: '11111111-1111-1111-1111-111111111111', code: 'KM', lifecycle_status: status }] : [] })) };
}

test('refuse typé 409 selon le statut, 404 si marché inconnu, opération inconnue = erreur de programmation', async () => {
  await expect(assertMarketOperationAllowed(executorFor('SUSPENDED'), 'KM', 'local_price_activate')).rejects.toMatchObject({ status: 409, code: 'MARKET_SUSPENDED' });
  await expect(assertMarketOperationAllowed(executorFor('CLOSED'), 'KM', 'local_price_reset')).rejects.toMatchObject({ status: 409, code: 'MARKET_NOT_ACTIVE' });
  await expect(assertMarketOperationAllowed(executorFor(null), 'KM', 'local_price_draft')).rejects.toMatchObject({ status: 404 });
  await expect(assertMarketOperationAllowed(executorFor('ACTIVE'), 'KM', 'inconnue')).rejects.toThrow('market_operation_unknown');
});

test('le garde est câblé sur les seules opérations ⛔ (prix local, exposition, nouvelle expédition douane)', () => {
  const pricing = read('routes/admin-pricing-workspace.js');
  expect(pricing).toContain("requireMarketOperation('local_price_draft')");
  expect(pricing).toContain("requireMarketOperation('local_price_activate')");
  expect(pricing).toContain("requireMarketOperation('local_price_reset')");
  expect(read('routes/market-delegation-catalog.js')).toContain("'catalog_exposure_enable'");
  expect(read('services/customs-shipment-service.js')).toContain("'customs_shipment_create'");
});

test('aucune obligation (hub, relais, comptabilité, remboursement, règlement) n’utilise le garde', () => {
  ['services/hub-operations.js', 'services/scan-operations.js', 'routes/admin-operations-workspace.js', 'routes/scans.js',
    'services/order-checkout-service.js'].forEach((file) => {
    expect(read(file)).not.toContain('market-operation-guard');
  });
  expect(Object.keys(OPERATION_STATUSES)).not.toEqual(expect.arrayContaining(['hub_receive', 'relay_collect', 'refund']));
});

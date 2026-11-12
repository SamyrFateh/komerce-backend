'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '../../routes/admin-operations-workspace.js'), 'utf8');

test('réception Hub : le scanner identifie le SKU exact de la PO, pas une commande client', () => {
  expect(ui).toContain('kmc-workspace-receive-scanner');
  expect(ui).toContain("endpointFor(context.marketCode, 'supply/physical-code')");
  expect(ui).toContain('matched.product_sku_id');
  expect(ui).toContain('Number(line.remaining_quantity) > 0');
  expect(ui).toContain('quantité réellement reçue');
  expect(ui).toContain("event.key !== 'Enter'");
  // seul l'endpoint de confirmation canonique (feat/hub-confirm-physical-code) est autorisé, jamais le lookup non scopé
  expect(ui.replace('/api/hub/physical-codes/confirm', '')).not.toContain('/api/hub/physical-codes');
});

test('lookup du code à la réception : Hub uniquement et marché imposé par le serveur', () => {
  const i = route.indexOf("'/market/:marketCode/supply/physical-code'");
  expect(i).toBeGreaterThan(-1);
  const scopedRoute = route.slice(i, i + 1800);
  expect(scopedRoute).toContain("attachHubExecutionCapability('execution.parcel.receive')");
  expect(scopedRoute).toContain('requireHubWorkspaceAction');
  expect(scopedRoute).toContain('purchase_orders WHERE id=$1 AND market_id=$2');
  expect(scopedRoute).toContain('physicalCodes.resolvePhysicalCode');
  expect(scopedRoute).not.toContain('market_id: req.body');
});

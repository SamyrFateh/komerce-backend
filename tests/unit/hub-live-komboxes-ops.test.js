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

test('A2 : l’initialisation de COMBOX envoie une Idempotency-Key conservée après échec et la route l’exige', () => {
  expect(ui).toContain("'Idempotency-Key': options.idempotencyKey");
  expect(ui).toContain('idempotencyKey: prior.key');
  expect(ui).toContain('keys.set(keyScope,prior)');
  expect(ui).toContain('onSuccess: () => { keys.delete(keyScope);prior=null; }');
  expect(route).toContain("req.get('Idempotency-Key')");
});

test('Hub Live compose directement les COMBOX via les routes Workspace marché', () => {
  expect(ui).toContain("endpointFor(context.marketCode, 'boxes')");
  expect(ui).toContain("'boxes/'+encodeURIComponent(box.unit_id)+'/fill'");
  expect(ui).toContain("'boxes/'+encodeURIComponent(box.unit_id)+'/close'");
  expect(ui).not.toContain("'/bags'");
  expect(ui).toContain('/advance`');
  // Exception de lecture Direction, strictement hors atelier physique.
  const decision=ui.slice(ui.indexOf('async function renderDirectionVariance'),ui.indexOf('function renderPayload'));
  expect(decision).toContain("jsonRequest(context.fetch,'/api/hub/administration')");
  expect(decision).not.toContain("method:'POST'");
  const physical=ui.replace(decision,'');
  expect(physical.replace('/api/hub/physical-codes/confirm','')).not.toContain('/api/hub/');
});

test('les routes de composition sont gardées par la capacité parcel.ship et le marché serveur', () => {
  for (const suffix of ['/market/:marketCode/boxes\'', '/boxes/:unitId/fill\'', '/boxes/:unitId/close\'', '/boxes/:unitId/advance\'']) {
    const i = route.indexOf(suffix);
    expect(i).toBeGreaterThan(-1);
    const block = route.slice(i, i + 220);
    expect(block).toContain("attachHubExecutionCapability('execution.parcel.ship')");
    expect(block).toContain('requireHubWorkspaceAction');
  }
  expect(route).toContain('BOX_MARKET_MISMATCH');
  expect(route).toContain('ALLOCATION_MARKET_MISMATCH');
});

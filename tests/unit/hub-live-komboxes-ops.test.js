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

test('Hub Live compose les KOM-BOX uniquement via les routes Workspace marché', () => {
  expect(ui).toContain("endpointFor(context.marketCode, 'boxes')");
  expect(ui).toContain("'boxes/'+encodeURIComponent(box.unit_id)+'/bags'");
  expect(ui).toContain("'bags/'+encodeURIComponent(bag.unit_id)+'/deposit'");
  expect(ui).not.toContain("'fill-box'");
  expect(ui).toContain('/advance`');
  // Exception H4 strictement en lecture seule : GET director-todo ; les écritures Hub restent dans le Workspace marché.
  expect(ui.replace('/api/hub/physical-codes/confirm', '').replace('/api/hub/director-todo', '')).not.toContain('/api/hub/');
});

test('les routes de composition sont gardées par la capacité parcel.ship et le marché serveur', () => {
  for (const suffix of ['/market/:marketCode/boxes\'', '/boxes/:unitId/bags\'', '/boxes/:unitId/advance\'']) {
    const i = route.indexOf(suffix);
    expect(i).toBeGreaterThan(-1);
    const block = route.slice(i, i + 220);
    expect(block).toContain("attachHubExecutionCapability('execution.parcel.ship')");
    expect(block).toContain('requireHubWorkspaceAction');
  }
  expect(route).toContain('BOX_MARKET_MISMATCH');
  expect(route).toContain('ALLOCATION_MARKET_MISMATCH');
});

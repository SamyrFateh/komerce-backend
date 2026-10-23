'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

test('L2 : la route Client 360 transmet le périmètre de recette demandé au service (vue réelle par défaut)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../routes/admin-client-360.js'), 'utf8');
  expect(src).toContain('client360.resolveClient(phone, { marketIds, simulationScope: req.query.simulation_scope })');
  expect(src).toContain('simulationScope: req.client360Access.simulationScope');
});

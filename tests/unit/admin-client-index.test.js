'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

test('L2 : la route index Clients transmet le périmètre de recette au service (marché et global)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../routes/admin-client-index.js'), 'utf8');
  expect(src.match(/simulationScope: req\.query\.simulation_scope/g)).toHaveLength(2);
});

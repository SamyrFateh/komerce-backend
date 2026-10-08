'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'contract-generate.js'), 'utf8');
const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'contract', 'openapi.json'), 'utf8'));

test('le contrat généré enregistre Supplier 360 avec sa forme top-level prouvée', () => {
  expect(source).toContain("/api/admin/entities/suppliers/{supplierId}");
  expect(source).toContain("fields: ['supplier','mappings','purchase_orders','execution','payments','data_quality']");
  const operation = contract.paths['/api/admin/entities/suppliers/{supplierId}'].get;
  expect(operation['x-route-file']).toBe('routes/admin-supplier-360.js');
  expect(operation.responses['200'].content['application/json'].schema['x-contract-status']).toBe('test');
  expect(Object.keys(operation.responses['200'].content['application/json'].schema.properties)).toEqual([
    'supplier', 'mappings', 'purchase_orders', 'execution', 'payments', 'data_quality',
  ]);
});


test('le contrat Pilotage marché expose le résumé control_chain', () => {
  expect(source).toContain(
    "fields: ['scope','kpis_global','view_blocks','economic_flow','principles','control_chain','system_alerts','data_quality']"
  );
});

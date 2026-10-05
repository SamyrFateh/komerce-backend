'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'navigation.js'), 'utf8');

test('Supplier 360 appartient au Catalogue et revient au Sourcing', () => {
  expect(source).toContain("'supplier-360': 'catalog'");
  expect(source).toContain("'supplier-360': Object.freeze({ href:'/admin/workspaces/sourcing'");
});

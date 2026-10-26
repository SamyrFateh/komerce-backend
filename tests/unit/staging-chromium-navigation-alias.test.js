'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const path=require('path');
const {KNOWN_CANONICAL_ALIASES,expectedPath}=
  require('../../tests/staging-canonical/navigation-audit-policy');

test('les trois alias opérationnels proviennent de la déclaration serveur canonique',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','..','bootstrap','html-routes.js'),'utf8');
  for(const [legacy,canonical]of Object.entries(KNOWN_CANONICAL_ALIASES)){
    const declaration=`'${legacy}': '${canonical}'`;
    expect(source).toContain(declaration);
  }
});
test('rediriger vers Opérations est nominal et non un WRONG_ROUTE',()=>{
  expect(expectedPath('/admin/orders-logistics')).toBe('/admin/operations');
  expect(expectedPath('/admin/orders-logistics?status=active')).toBe('/admin/operations');
  expect(expectedPath('/admin/hub-relais')).toBe('/admin/workspaces/operations');
});
test('legacy=1 désactive le traitement d alias',()=>{
  expect(expectedPath('/admin/orders-logistics?legacy=1')).toBe('/admin/orders-logistics');
});
test('une route produit inconnue ne peut pas être classée comme alias nominal',()=>{
  expect(expectedPath('/admin/products/KPR-000094')).toBe('/admin/products/KPR-000094');
  expect(expectedPath('/admin/orders/AUDIT-ND5VE6-NORMAL')).toBe('/admin/orders/AUDIT-ND5VE6-NORMAL');
});
test('origines externes refusées',()=>{
  expect(()=>expectedPath('https://example.org/admin/orders-logistics')).toThrow('OUT_OF_SCOPE_NAVIGATION_ORIGIN');
});

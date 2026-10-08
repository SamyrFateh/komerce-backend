'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs'); const path=require('path');
const s=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','admin','js','app.js'),'utf8');
test('admin app registers MarketsView route',()=>{
  expect(s).toMatch(/\/admin\/markets[\s\S]*MarketsView/);
});


const canonicalApp=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','app.js'),'utf8');
test('canonical app route Supplier 360 vers sa surface dédiée',()=>{
  expect(canonicalApp).toContain("SUPPLIER_360: 'supplier-360'");
  expect(canonicalApp).toContain("return SURFACES.SUPPLIER_360");
  expect(canonicalApp).toContain('KomerceCanonicalSupplier360.mount');
});

test('canonical app route Providers (Administration) vers sa surface dédiée', () => {
  expect(canonicalApp).toContain("PROVIDERS_ADMIN: 'providers-admin'");
  expect(canonicalApp).toContain("if (path === '/admin/providers') return SURFACES.PROVIDERS_ADMIN");
});

test('canonical app route Utilisateurs (Administration) vers sa surface dédiée lecture seule', () => {
  expect(canonicalApp).toContain("USERS_ADMIN: 'users-admin'");
  expect(canonicalApp).toContain("if (path === '/admin/users') return SURFACES.USERS_ADMIN");
});

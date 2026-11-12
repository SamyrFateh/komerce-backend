'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const path=require('path');
describe('G6 P2 — le devis serveur anonyme n est pas une commande',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../scripts/recette/g6-p2-buyer-cart-checkout-readonly.js'),'utf8');
 const server=fs.readFileSync(path.join(__dirname,'../../routes/orders/create.js'),'utf8');
 const auth=fs.readFileSync(path.join(__dirname,'../../middleware/auth-guest.js'),'utf8');
 test('seul POST /api/orders/preview est autorisé dans la sonde readonly',()=>{
  expect(src).toContain("hit.path==='/api/orders/preview'");
  expect(src).toContain("hit.type==='fetch'");
  expect(src).toContain("return route.continue();");
  expect(src).toContain("return route.abort();");
  expect(src).toContain("UNEXPECTED_BROWSER_WRITE_ATTEMPTS");
  expect(src).toContain("UNAUTHENTICATED_PREVIEW_MUST_BE_401");
 });
 test('le serveur utilise previewOnly et refuse une identité absente',()=>{
  expect(server).toContain("router.post('/preview', authenticateOrCreateGuest");
  expect(server).toContain("previewOnly: true");
  expect(auth).toContain("code: 'identity_required'");
  expect(src).toContain('UNAUTHENTICATED_CONFIRM_ENABLED');
  expect(src).toContain('READONLY_BIZ_DB_CHANGED');
 });
});

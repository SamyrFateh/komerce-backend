'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const path=require('path');
describe('G6 P2 — le devis serveur anonyme n est pas une commande',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../scripts/recette/g6-p2-buyer-cart-checkout-readonly.js'),'utf8');
 const server=fs.readFileSync(path.join(__dirname,'../../routes/orders/create.js'),'utf8');
 const auth=fs.readFileSync(path.join(__dirname,'../../middleware/auth-guest.js'),'utf8');
 const realBuyer=fs.readFileSync(path.join(__dirname,'../../scripts/recette/g6-p2-buyer-order-real-chromium.js'),'utf8');
 test('seul POST /api/orders/preview est autorisé dans la sonde readonly',()=>{
  expect(src).toContain("hit.path==='/api/orders/preview'");
  expect(src).toContain("hit.type==='fetch'");
  expect(src).toContain("return route.continue();");
  expect(src).toContain("return route.abort();");
  expect(src).toContain("UNEXPECTED_BROWSER_WRITE_ATTEMPTS");
  expect(src).toContain("UNAUTHENTICATED_PREVIEW_MUST_BE_401");
 });
 test('préflight prix : explique zéro ou plusieurs lignes sans contourner le garde',()=>{
  expect(src).toContain('BUYER_PRICE_SNAPSHOT_NO_MATCH');
  expect(src).toContain('BUYER_PRICE_SNAPSHOT_MULTIPLE_ROWS');
  expect(src).toContain('report.snapshot_diagnostic');
  expect(src).toContain('matching_rows:rows.length');
  expect(src).toContain("ORDER BY p.product_ref LIMIT 8");
  expect(src).toContain('default_transaction_read_only=on');
  expect(src).not.toContain("rows.length!==1?rows[0]:");
 });
 test('la cible KM vient d un produit réel et résout son UUID depuis la référence',()=>{
  expect(src).toContain("const REF='KPR-000165'");
  expect(src).toContain('const EXPECTED_PRICE=5990');
  expect(src).toContain('"WHERE p.product_ref=$1",[REF]');
  expect(src).toContain('BUYER_PRODUCT_ID_CHANGED');
  expect(src).not.toContain("const REF='KPR-000099'");
 });
 test('le serveur utilise previewOnly et refuse une identité absente',()=>{
  expect(server).toContain("router.post('/preview', authenticateOrCreateGuest");
  expect(server).toContain("previewOnly: true");
  expect(auth).toContain("code: 'identity_required'");
  expect(src).toContain('UNAUTHENTICATED_CONFIRM_ENABLED');
  expect(src).toContain('READONLY_BIZ_DB_CHANGED');
  expect(realBuyer).toContain("'/api/orders/preview'");
  expect(realBuyer).toContain('G6_AUTHENTICATED_SERVER_QUOTE_NOT_200');
  expect(realBuyer).toContain('G6_CANONICAL_ORDER_POST_NOT_201');
  expect(realBuyer).toContain('G6_EXACTLY_ONE_ORDER_NOT_SATISFIED');
 });
});

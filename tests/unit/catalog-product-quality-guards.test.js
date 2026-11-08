'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const path=require('path');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const guard=read('services/order-checkout-item-resolution.js');
const sellable=read('services/product-sellable-service.js');
const publicView=read('services/catalog-public-view.js');
const detail=read('services/catalog-product-detail.js');
const migration=read('migrations/400_catalog_product_quality_holds.sql');
const routes=read('routes/admin-catalog-workspace.js');
const workspace=read('services/catalog-workspace.js');
const catalogUI=read('public/dashboards/canonical/js/catalog-workspace.js');

test('un gel est une vraie interdiction de nouvelle vente, pas un badge seulement',()=>{
  expect(migration).toContain('BEFORE INSERT ON public.order_items');
  expect(migration).toContain('FOR SHARE');
  expect(migration).toContain('WHERE h.product_id = NEW.product_id AND h.released_at IS NULL');
  expect(guard).toContain('EXISTS (SELECT 1 FROM catalog_product_sale_holds');
  expect(guard).toContain('catalog_quality_frozen');
  expect(guard).toContain('status: 409');
  expect(guard).toContain('FOR UPDATE OF p');
  expect(sellable).toContain('catalog_quality_frozen');
  expect(sellable).toContain("e.code = product.catalog_quality_frozen ? 'catalog_product_quality_frozen'");
  expect(publicView).toContain('NOT EXISTS (SELECT 1 FROM catalog_product_sale_holds');
  expect(detail).toContain('catalog_product_sale_holds');
});

test('gel / dégel uniquement via autorité Catalogue globale existante',()=>{
  expect(routes).toContain('router.use(...guard, rejectMarketDimension)');
  expect(routes).toContain("router.get('/products/:productRef/quality'");
  expect(routes).toContain("router.post('/products/:productRef/quality/:action'");
  expect(routes).toContain("const guard = [authenticate, requireRole(['admin']), requireCatalogGlobalAuthority]");
});

test('retour SAV automatiquement signalé sans gel automatique',()=>{
  expect(workspace).toContain('quality.batchSignals([');
  expect(workspace).toContain('products: withQuality(registry.products)');
  expect(catalogUI).toContain('data-catalog-quality-signal');
  expect(catalogUI).toContain('data-catalog-quality-frozen');
  expect(catalogUI).toContain("attachQualityControls(context, doc, panel, row)");
  expect(catalogUI).toContain("actionEndpoint + '/' + action");
  expect(migration).toContain("released_at IS NULL");
  expect(migration).toContain("release_comment");
});

test('les commentaires d origine sont scellés, seul le premier dégel motive peut modifier le cycle',()=>{
  expect(migration).toContain('CREATE TRIGGER trg_immutable_catalog_quality_note');
  expect(migration).toContain('BEFORE UPDATE OR DELETE ON public.catalog_product_quality_notes');
  expect(migration).toContain('CATALOG_QUALITY_NOTE_IMMUTABLE');
  expect(migration).toContain('CREATE TRIGGER trg_immutable_catalog_sale_hold');
  expect(migration).toContain('NEW.reason IS DISTINCT FROM OLD.reason');
  expect(migration).toContain('OLD.released_at IS NOT NULL');
  expect(migration).toContain('NEW.release_comment IS NULL');
});

test('gel sans suppression de stock, commandes historiques ni retours fournisseurs',()=>{
  expect(migration).not.toMatch(/DELETE FROM (orders|order_items|products)/i);
  expect(migration).not.toMatch(/TRUNCATE/i);
  expect(routes).not.toContain("walletService.credit(");
  expect(catalogUI).not.toContain('return_automatic_freeze');
});

'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

describe('public catalog route exposure gate', () => {
  test('la liste, les compteurs et le détail legacy partagent le prédicat canonique', () => {
    const productsRoute = source('routes/products.js');

    expect(productsRoute).toContain("const conditions = [publicCatalogVisibilitySql('p', marketCodeParamIndex ? { marketCodeParamIndex } : {})]");
    expect(productsRoute).toContain("WHERE ${publicCatalogVisibilitySql('p')}");
    expect(productsRoute).toContain("const conditions = [publicCatalogVisibilitySql('p'), 'p.subcategory IS NOT NULL']");
    expect(productsRoute).toContain("const detailConditions = [publicCatalogVisibilitySql('p', marketCode ? { marketCodeParamIndex: 2 } : {})]");
  });

  test('la fiche canonique market-scoped utilise la même frontière publique que la grille', () => {
    const detailRoute = source('routes/catalog-product-detail.js');
    expect(detailRoute).toContain('publicCatalogVisibilitySql');
    expect(detailRoute).toContain('if (marketCode)');
    expect(detailRoute).toContain("publicCatalogVisibilitySql('p', { marketCodeParamIndex: 2 })");
    expect(detailRoute).toContain('AND ${visibilitySql}');
    expect(detailRoute).not.toContain('isProductExposedForMarketCode');
  });

  test('sans marché, la fiche conserve le contrat historique sans prétendre être Visible dans un pays', () => {
    const detailRoute = source('routes/catalog-product-detail.js');
    expect(detailRoute).toContain('const detail = await getProductDetail(db, req.params.id)');
    expect(detailRoute).toContain('Sans marché, on conserve le contrat historique du détail public');
    expect(detailRoute).not.toContain("marketCode ? { marketCodeParamIndex: 2 } : {}");
  });

  test('le prédicat canonique reste la seule fonction qui construit la clause de visibilité — aucune réimplémentation inline', () => {
    const productsRoute = source('routes/products.js');
    expect(productsRoute).not.toMatch(/is_active = TRUE'.*image_url/s);
  });

  test('le contrat détail canonique refuse aussi fixtures et médias synthétiques', () => {
    const detailRoute = source('routes/catalog-product-detail.js');

    expect(detailRoute).toContain('isExcludedPublicProductRef');
    expect(detailRoute).toContain('isSyntheticPublicMediaUrl');
    expect(detailRoute).toContain('if (!isPublicDetail(detail))');
  });

  test('aucune route publique ne réactive directement SHOWCASE-V2', () => {
    const productsRoute = source('routes/products.js');
    const detailRoute = source('routes/catalog-product-detail.js');

    expect(productsRoute).not.toContain("product_ref LIKE 'SHOWCASE-V2-%'");
    expect(detailRoute).not.toContain("product_ref LIKE 'SHOWCASE-V2-%'");
  });
});

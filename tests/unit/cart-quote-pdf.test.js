/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const fs = require('fs');
const path = require('path');
const { renderCartQuotePdf, variantLabel } = require('../../services/documents/cart-quote-pdf');

const canonicalPreview = {
  market_code: 'KM',
  relais_name: 'Relais Moroni',
  items_total_kmf: 17990,
  transport_price_kmf: 130,
  discount_kmf: 0,
  total_kmf: 18120,
  items: [{
    product_id: 'product-1',
    product_name: 'Tissu de fête',
    quantity: 1,
    unit_price_kmf: 17990,
    line_total_kmf: 17990,
    variant_combo: { Taille: 'S' },
  }],
};

describe('devis boutique — document non transactionnel', () => {
  test('PDF A4 généré depuis les lignes et le total canonique serveur', async () => {
    const pdf = await renderCartQuotePdf(canonicalPreview, new Date('2026-11-12T10:00:00Z'));
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(variantLabel({ Taille: 'S', Couleur: 'Rouge' })).toBe('Taille : S / Couleur : Rouge');
  });
  test('rejette les montants et lignes incohérents sans émettre de document', async () => {
    expect(() => renderCartQuotePdf({ ...canonicalPreview, items: [] })).toThrow('Lignes');
    expect(() => renderCartQuotePdf({ ...canonicalPreview, total_kmf: null, items: canonicalPreview.items.map(x => ({...x, unit_price_kmf: Infinity})) })).toThrow();
  });
  test('l’API PDF requiert une identité, le calcul preview-only et aucun POST de commande', () => {
    const route = fs.readFileSync(path.join(__dirname, '../../routes/orders/create.js'), 'utf8');
    const service = fs.readFileSync(path.join(__dirname, '../../services/order-checkout-service.js'), 'utf8');
    expect(route).toMatch(/router\.post\('\/quote-pdf', authenticateOrCreateGuest, validate\(orderCreateSchema\)/);
    expect(route).toContain('previewOnly: true');
    expect(route).toContain('renderCartQuotePdf(result.preview)');
    expect(service).toContain("if (previewOnly)");
    expect(service).toContain("await client.query('ROLLBACK')");
  });
});

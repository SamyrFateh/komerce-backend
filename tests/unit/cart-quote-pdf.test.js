/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const fs = require('fs');
const path = require('path');
const { renderCartQuotePdf, variantLabel } = require('../../services/documents/cart-quote-pdf');

const canonicalPreview = {
  market_code: 'KM',
  items_total_kmf: 7990,
  transport_price_kmf: 0,
  discount_kmf: 0,
  total_kmf: 7990,
  items: [{
    product_id: 'product-1',
    product_name: 'Tissu de fête',
    quantity: 1,
    unit_price_kmf: 7990,
    line_total_kmf: 7990,
    variant_combo: { cj_color: 'Rouge', cj_size: 'S' },
  }],
};

describe('devis boutique public non transactionnel', () => {
  test('PDF A4 depuis la vérité serveur et variantes humaines', async () => {
    const pdf = await renderCartQuotePdf(canonicalPreview, new Date('2026-11-12T10:00:00Z'));
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(variantLabel({ cj_color: 'Rouge', cj_size: 'S' })).toBe('Couleur : Rouge / Taille : S');
  });
  test('refuse les incohérences et tout transport maritime facturé', () => {
    expect(() => renderCartQuotePdf({ ...canonicalPreview, items: [] })).toThrow('Lignes');
    expect(() => renderCartQuotePdf({ ...canonicalPreview, transport_price_kmf: 26 })).toThrow(/incohérent/);
    expect(() => renderCartQuotePdf({ ...canonicalPreview, total_kmf: null })).toThrow();
  });
  test('les API de devis autonomes sont publiques et ne créent jamais une commande', () => {
    const route = fs.readFileSync(path.join(__dirname, '../../routes/orders/create.js'), 'utf8');
    const service = fs.readFileSync(path.join(__dirname, '../../services/public-cart-quote-service.js'), 'utf8');
    expect(route).toMatch(/router\.post\('\/quote-pdf', async/);
    expect(route).toContain('quotePublicCart(req.body)');
    expect(route).toContain("includes('application/json')");
    expect(route).toContain('renderCartQuotePdf(quote)');
    expect(service).toContain("await client.query('ROLLBACK')");
    expect(service).not.toContain("await client.query('COMMIT')");
  });
});

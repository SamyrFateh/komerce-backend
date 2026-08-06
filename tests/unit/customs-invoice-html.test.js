'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../utils/documents/logo-base64', () => ({ LOGO_KOMERCE_DATA_URI: 'data:image/png;base64,LOGO' }));

const { buildInvoiceHTML, escapeHTML } = require('../../utils/documents/customs-invoice-html');

describe('customs-invoice-html', () => {
  const doc = {
    reference: 'DOU-2026-000001',
    metadata: {
      shipment_reference: 'SHIP-001',
      shipment_date: '2026-06-01T00:00:00Z',
      transport_mode: 'air',
      transitaire_name: 'Transitaire A',
      parcel_reference: 'P-001',
      order_reference: 'CMD-001',
      relais_name: 'Relais A',
      relais_island: 'Anjouan',
      cif_kmf: 50000,
      customs_share_kmf: 7500,
      allocation_basis: 'by_cif_value',
      issued_at: '2026-06-02T00:00:00Z',
      declared_at: '2026-06-02T00:00:00Z',
      has_defaulted_lines: true,
      lines: [
        { product_name: 'Riz', quantity: 2, unit_price_kmf: 10000, line_total_kmf: 20000, sh_code: '1901', douane_pct: 5, tva_pct: 10, classification_defaulted: false },
        { product_name: '<Produit>', quantity: 1, unit_price_kmf: 30000, line_total_kmf: 30000, sh_code: null, douane_pct: 0, tva_pct: 0, classification_defaulted: true },
      ],
    },
  };

  it('escapeHTML neutralise les caracteres dangereux', () => {
    expect(escapeHTML(`<x>'&"</x>`)).toBe('&lt;x&gt;&#39;&amp;&quot;&lt;/x&gt;');
  });

  it('genere une facture douaniere A4 avec logo, expedition, colis, lignes et totaux', () => {
    const html = buildInvoiceHTML(doc);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('data:image/png;base64,LOGO');
    expect(html).toContain('Facture douanière');
    expect(html).toContain('DOU-2026-000001');
    expect(html).toContain('SHIP-001');
    expect(html).toContain('Transport aérien');
    expect(html).toContain('Transitaire A');
    expect(html).toContain('P-001');
    expect(html).toContain('CMD-001');
    expect(html).toContain('Relais A');
    expect(html).toContain('Anjouan');
    expect(html).toContain('Riz');
    expect(html).toContain('&lt;Produit&gt;');
    expect(html).toContain('1901');
    expect(html).toContain('50 000 KMF');
    expect(html).toContain('7 500 KMF');
    expect(html).toContain('classification de repli');
  });

  it('accepte metadata string, transport inconnu et absence de lignes', () => {
    const html = buildInvoiceHTML({
      reference: '<REF>',
      metadata: JSON.stringify({ transport_mode: 'drone', issued_at: '2026-06-02T00:00:00Z', lines: [] }),
    });

    expect(html).toContain('&lt;REF&gt;');
    expect(html).toContain('drone');
    expect(html).toContain('Aucune ligne');
    expect(html).not.toContain('classification de repli');
  });

  it('echappe les champs injectes dans les blocs info et lignes', () => {
    const html = buildInvoiceHTML({
      reference: 'DOU-X',
      metadata: {
        shipment_reference: '<SHIP>',
        transitaire_name: '<script>x</script>',
        parcel_reference: '<P>',
        order_reference: '<CMD>',
        relais_name: '<R>',
        relais_island: '<I>',
        lines: [{ product_name: '<b>bad</b>', quantity: 1, unit_price_kmf: 1, line_total_kmf: 1 }],
      },
    });

    expect(html).toContain('&lt;SHIP&gt;');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
    expect(html).not.toContain('<script>x</script>');
  });
});

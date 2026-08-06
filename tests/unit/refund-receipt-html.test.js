'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../utils/documents/logo-base64', () => ({ LOGO_KOMERCE_DATA_URI: 'data:image/png;base64,LOGO' }));

const { buildReceiptHTML, escapeHTML } = require('../../utils/documents/refund-receipt-html');

describe('refund-receipt-html', () => {
  const baseData = {
    reference: 'REM-2026-000001',
    order_reference: 'CMD-001',
    invoice_number: 'FAC-001',
    refund_type: 'partial',
    confirmed_at: '01/06/2026',
    issued_at: '02/06/2026',
    amount_kmf: '5 000 KMF',
    amount_eur: '10.16 EUR',
    method: 'Stripe (virement EUR)',
    reason: 'Annulation client',
    stripe_refund_id: 're_001',
  };

  it('escapeHTML neutralise les caracteres dangereux', () => {
    expect(escapeHTML(`<script>alert('x') & "y"</script>`))
      .toBe('&lt;script&gt;alert(&#39;x&#39;) &amp; &quot;y&quot;&lt;/script&gt;');
  });

  it('buildReceiptHTML genere un document imprimable avec logo et donnees principales', () => {
    const html = buildReceiptHTML(baseData);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('data:image/png;base64,LOGO');
    expect(html).toContain('REÇU DE REMBOURSEMENT');
    expect(html).toContain('REM-2026-000001');
    expect(html).toContain('CMD-001');
    expect(html).toContain('FAC-001');
    expect(html).toContain('Remboursement partiel');
    expect(html).toContain('5 000 KMF');
    expect(html).toContain('10.16 EUR');
    expect(html).toContain('Stripe (virement EUR)');
    expect(html).toContain('re_001');
  });

  it('n’affiche pas facture, euro, motif ou stripe si absents', () => {
    const html = buildReceiptHTML({
      ...baseData,
      invoice_number: null,
      amount_eur: null,
      reason: null,
      stripe_refund_id: null,
    });

    expect(html).not.toContain('N° facture');
    expect(html).not.toContain('<div class="amount-eur">');
    expect(html).not.toContain('Motif :');
    expect(html).not.toContain('Ref Stripe');
  });

  it('echappe les donnees injectees dans le HTML', () => {
    const html = buildReceiptHTML({
      ...baseData,
      reference: '<REM>',
      order_reference: '<CMD>',
      reason: '<b>bad</b>',
    });

    expect(html).toContain('&lt;REM&gt;');
    expect(html).toContain('&lt;CMD&gt;');
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
    expect(html).not.toContain('<b>bad</b>');
  });

  it('mappe les types et methodes inconnus sans planter', () => {
    const html = buildReceiptHTML({ ...baseData, refund_type: 'custom', method: 'crypto' });

    expect(html).toContain('custom');
    expect(html).toContain('crypto');
    expect(html).toContain('↩');
  });
});

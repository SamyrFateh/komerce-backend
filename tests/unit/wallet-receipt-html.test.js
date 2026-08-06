'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../utils/documents/logo-base64', () => ({ LOGO_KOMERCE_DATA_URI: 'data:image/png;base64,LOGO' }));

const { buildReceiptHTML, escapeHTML } = require('../../utils/documents/wallet-receipt-html');

describe('wallet-receipt-html', () => {
  const doc = {
    reference: 'WAL-2026-000001',
    issued_at: '2026-06-01T10:00:00.000Z',
    metadata: {
      user_name: 'Ali',
      user_phone: '+269000',
      order_id: 'order-001',
      amount_kmf: 5000,
      direction: 'credit',
      reason: 'refund',
      note: 'Annulation',
      issued_at: '2026-06-01T10:00:00.000Z',
    },
  };

  it('escapeHTML neutralise les caracteres dangereux', () => {
    expect(escapeHTML(`<b>'x' & "y"</b>`)).toBe('&lt;b&gt;&#39;x&#39; &amp; &quot;y&quot;&lt;/b&gt;');
  });

  it('genere un recu wallet imprimable avec logo et champs principaux', () => {
    const html = buildReceiptHTML(doc);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('data:image/png;base64,LOGO');
    expect(html).toContain('REÇU WALLET / AVOIR');
    expect(html).toContain('WAL-2026-000001');
    expect(html).toContain('Ali');
    expect(html).toContain('+269000');
    expect(html).toContain('order-001');
    expect(html).toContain('CRÉDIT');
    expect(html).toContain('Avoir remboursement');
    expect(html).toContain('Annulation');
  });

  it('genere un debit reversal avec libelle debit', () => {
    const html = buildReceiptHTML({ ...doc, metadata: { ...doc.metadata, direction: 'debit', reason: 'reversal', user_phone: null, order_id: null } });

    expect(html).toContain('DÉBIT');
    expect(html).toContain('Reprise avoir (reversal)');
    expect(html).not.toContain('Tél :');
    expect(html).not.toContain('Commande liée :');
  });

  it('accepte metadata string et fallback reason inconnu', () => {
    const html = buildReceiptHTML({
      reference: 'WAL-2026-000002',
      metadata: JSON.stringify({ amount_kmf: 1234, direction: 'credit', reason: 'custom_reason', user_name: '<Ali>' }),
    });

    expect(html).toContain('custom_reason');
    expect(html).toContain('&lt;Ali&gt;');
    expect(html).toContain('WAL-2026-000002');
  });

  it('echappe reference, note et fallback utilisateur', () => {
    const html = buildReceiptHTML({
      reference: '<WAL>',
      metadata: { amount_kmf: 1, direction: 'credit', reason: 'admin_gift', note: '<script>x</script>' },
    });

    expect(html).toContain('&lt;WAL&gt;');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('Avoir administrateur');
    expect(html).not.toContain('<script>x</script>');
  });
});

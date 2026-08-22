'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const crypto = require('crypto');
const invoiceService = require('../../services/invoice-service');
const { renderPdf, safeFilename, invoiceFromHtml, logoFromHtml } = require('../../services/documents/pdf-renderer');

test('génère un vrai PDF de facture et son empreinte SHA-256', async () => {
  const result = await renderPdf({ documentType: 'invoice', document: {
    invoice_number: 'KOM-INV-2026-000001', order_reference: 'CMD-001',
    client_name: 'Ali', relay_name: 'Moroni', payment_mode: 'wallet', total_kmf: 12000,
    created_at: '2026-08-14T10:00:00.000Z',
    items_snapshot: [{ name: 'Article', qty: 2, total: 12000 }],
  } });
  expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF');
  expect(result.buffer.length).toBeGreaterThan(500);
  expect(result.sha256).toBe(crypto.createHash('sha256').update(result.buffer).digest('hex'));
  expect(result.filename).toBe('KOM-INV-2026-000001.pdf');
});

test('normalise un nom de fichier sans séparateur dangereux', () => {
  expect(safeFilename('../../Reçu été 01')).not.toContain('/');
  expect(safeFilename('../../Reçu été 01')).toContain('Recu-ete-01');
});

test('génère la facture PDF depuis le HTML canonique et son vrai logo', async () => {
  const invoice = {
    invoice_number: 'KOM-INV-2026-000002', order_reference: 'K7A78R6',
    client_name: 'Ali', client_phone: '+269', relay_name: 'Moroni',
    payment_mode: 'wallet', payment_status: 'paid', total_kmf: 1754000,
    created_at: '2026-08-14T10:00:00.000Z',
    items_snapshot: [{ name: 'Article', qty: 1, unit_price: 1754000, total: 1754000 }],
  };
  const html = invoiceService.generateHTML(invoice);
  expect(invoiceFromHtml(html)).toMatchObject({ order_reference: 'K7A78R6', total_kmf: 1754000 });
  expect(logoFromHtml(html).length).toBeGreaterThan(1000);
  const result = await renderPdf({ documentType: 'invoice', document: invoice, html });
  expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF');
  expect(result.templateVersion).toBe('2026-08-html-logo-v2');
});

// ── P4 (freeze 22-08-2026) — Payment Boundary : la facture affiche ce qui
// a été réellement payé, jamais 'KMF' codé en dur. Ne touche ni P1 ni P3.
describe('P4 — devise de la facture selon payment_mode réel', () => {
  const baseInvoice = {
    invoice_number: 'KOM-INV-2026-000003', order_reference: 'ORD-P4',
    client_name: 'Client Test', relay_name: 'Relais Test', payment_status: 'paid',
    total_kmf: 15000, total_eur: 30.49,
    created_at: '2026-08-22T10:00:00.000Z',
    items_snapshot: JSON.stringify([{ name: 'Article', qty: 1, unit_price: 15000, total: 15000 }]),
  };

  test('cash_relais : total affiché en KMF, jamais EUR', () => {
    const html = invoiceService.generateHTML({ ...baseInvoice, payment_mode: 'cash_relais' });
    expect(html).toContain('15\u202f000 KMF');
    expect(html).not.toContain('30,49 €');
  });

  test('stripe_eur : total affiché en EUR (total_eur), jamais total_kmf littéral', () => {
    const html = invoiceService.generateHTML({ ...baseInvoice, payment_mode: 'stripe_eur' });
    expect(html).toContain('30,49 €');
  });

  test('paypal_eur : même comportement que stripe_eur', () => {
    const html = invoiceService.generateHTML({ ...baseInvoice, payment_mode: 'paypal_eur' });
    expect(html).toContain('30,49 €');
  });

  test('wallet (autre mode non-EUR) : repli KMF, cohérent (wallet toujours KMF)', () => {
    const html = invoiceService.generateHTML({ ...baseInvoice, payment_mode: 'wallet' });
    expect(html).toContain('15\u202f000 KMF');
  });

  test('le payload machine-readable embarqué porte total_amount/total_currency_label', () => {
    const html = invoiceService.generateHTML({ ...baseInvoice, payment_mode: 'stripe_eur' });
    const extracted = invoiceFromHtml(html);
    expect(extracted.total_amount).toBe(30.49);
    expect(extracted.total_currency_label).toBe('€');
    expect(extracted.total_kmf).toBe(15000); // toujours présent, jamais retiré
  });

  test('renderPdf() : document avec total_amount/total_currency_label (facture post-P4) — PDF valide', async () => {
    const result = await renderPdf({
      documentType: 'invoice',
      document: {
        invoice_number: 'X', total_kmf: 15000, total_amount: 30.49, total_currency_label: '€',
        payment_mode: 'stripe_eur', created_at: '2026-08-22T10:00:00.000Z', items_snapshot: '[]',
      },
    });
    expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  test('renderPdf() : document SANS total_amount/total_currency_label (facture pré-P4, legacy) — repli formatAmount(total_kmf), PDF valide, jamais une exception', async () => {
    const result = await renderPdf({
      documentType: 'invoice',
      document: {
        invoice_number: 'Y', total_kmf: 15000, // pas de total_amount/total_currency_label
        payment_mode: 'cash_relais', created_at: '2026-08-22T10:00:00.000Z', items_snapshot: '[]',
      },
    });
    expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});

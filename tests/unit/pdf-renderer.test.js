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

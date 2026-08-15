'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn() }) }));
const mockRenderPdf = jest.fn();
jest.mock('../../services/documents/pdf-renderer', () => ({ renderPdf: (...args) => mockRenderPdf(...args) }));
const invoiceService = require('../../services/invoice-service');

beforeEach(() => {
  jest.clearAllMocks();
  mockRenderPdf.mockResolvedValue({
    buffer: Buffer.from('%PDF-private'), sha256: 'sha256',
    filename: 'KOM-INV-2026-000001.pdf', templateVersion: '2026-08-v1',
  });
});

test('retourne la facture existante de façon idempotente', async () => {
  const existing = { id: 'inv-1', order_id: 'order-1' };
  mockQuery.mockResolvedValueOnce({ rows: [existing] });
  await expect(invoiceService.getOrCreateInvoice('order-1')).resolves.toBe(existing);
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('refuse de facturer une commande non payée', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{
    id: 'order-1', reference: 'CMD-1', payment_status: 'pending',
  }] });
  await expect(invoiceService.getOrCreateInvoice('order-1')).rejects.toThrow('non payée');
});

test('crée un snapshot propriétaire avec totaux de lignes exacts', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'order-1', reference: 'CMD-1', total_kmf: 34000,
      payment_status: 'paid', payment_mode: 'wallet', user_id: 'user-1',
      client_name: 'Ali', client_phone: '+269', relay_name: 'Moroni',
    }] })
    .mockResolvedValueOnce({ rows: [{ quantity: 2, price_kmf: 17000, product_name: 'Article' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ seq: 1 }] })
    .mockResolvedValueOnce({ rows: [{ id: 'inv-1', invoice_number: 'KOM-INV-2026-000001' }] });
  await invoiceService.getOrCreateInvoice('order-1');
  const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO invoices/i.test(sql));
  expect(JSON.parse(insert[1][6])[0].total).toBe(34000);
  expect(insert[1][12]).toBe('user-1');
  expect(insert[0]).toContain('ON CONFLICT (order_id)');
});

test('issueInvoice produit un PDF privé sans notification ni URL publique', async () => {
  const snapshot = { id: 'inv-1', invoice_number: 'KOM-INV-2026-000001', items_snapshot: [], total_kmf: 1000 };
  const ready = { ...snapshot, pdf_content: Buffer.from('%PDF-private'), pdf_sha256: 'sha256' };
  mockQuery.mockResolvedValueOnce({ rows: [snapshot] }).mockResolvedValueOnce({ rows: [ready] });
  await expect(invoiceService.issueInvoice('order-1')).resolves.toEqual(expect.objectContaining({ pdf_sha256: 'sha256' }));
  expect(mockRenderPdf).toHaveBeenCalledWith(expect.objectContaining({
    documentType: 'invoice', document: snapshot, html: expect.stringContaining('class="brand-logo"'),
  }));
  expect(JSON.stringify(mockQuery.mock.calls)).not.toContain('public_token');
});

test('ensurePdf conserve un PDF existant sans le régénérer', async () => {
  const existing = { id: 'inv-1', pdf_content: Buffer.from('%PDF-existing') };
  await expect(invoiceService.ensurePdf(existing)).resolves.toBe(existing);
  expect(mockRenderPdf).not.toHaveBeenCalled();
  expect(mockQuery).not.toHaveBeenCalled();
});

test('le rendu HTML historique échappe les noms de produit', () => {
  const html = invoiceService.generateHTML({
    invoice_number: 'INV-1', client_name: 'Ali', relay_name: 'Moroni',
    items_snapshot: [{ name: '<script>alert(1)</script>', qty: 1, unit_price: 1000, total: 1000 }],
    subtotal_kmf: 1000, total_kmf: 1000, payment_mode: 'wallet', payment_status: 'paid', created_at: '2026-08-14',
  });
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('class="brand-logo"');
  expect(html).toContain('data:image/png;base64,');
  expect(html).toContain('name="komerce-invoice-payload"');
});

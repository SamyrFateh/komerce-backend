'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
const mockRenderPdf = jest.fn();
jest.mock('../../services/documents/pdf-renderer', () => ({ renderPdf: (...args) => mockRenderPdf(...args) }));

const pool = require('../../db');
const { findExistingDocument, persistDocument, ensurePdf } = require('../../services/documents/document-service');

beforeEach(() => {
  jest.clearAllMocks();
  mockRenderPdf.mockResolvedValue({
    buffer: Buffer.from('%PDF-private'), sha256: 'abc123', filename: 'REM-001.pdf', templateVersion: '2026-08-v1',
  });
});

test('findExistingDocument retourne le document existant', async () => {
  const doc = { id: 'doc-001', reference: 'REM-001' };
  pool.query.mockResolvedValueOnce({ rows: [doc] });
  await expect(findExistingDocument({ documentType: 'refund_receipt', subjectType: 'refund', subjectId: 'refund-001' })).resolves.toBe(doc);
});

test('persistDocument attache propriétaire, PDF et empreinte', async () => {
  const pending = { id: 'doc-001', document_type: 'refund_receipt', reference: 'REM-001', status: 'pending' };
  const available = { ...pending, status: 'available', pdf_content: Buffer.from('%PDF-private'), pdf_sha256: 'abc123' };
  pool.query.mockResolvedValueOnce({ rows: [pending] }).mockResolvedValueOnce({ rows: [available] });

  await expect(persistDocument({
    documentType: 'refund_receipt', subjectType: 'refund', subjectId: 'refund-001',
    orderId: 'order-001', refundId: 'refund-001', reference: 'REM-001',
    issuedBy: 'admin-001', ownerUserId: 'user-001', metadata: { amount_kmf: 5000 },
  })).resolves.toEqual(available);

  expect(pool.query.mock.calls[0][1]).toEqual([
    'refund_receipt', 'refund', 'refund-001', 'order-001', 'refund-001',
    'REM-001', 'admin-001', 'user-001', JSON.stringify({ amount_kmf: 5000 }),
  ]);
  expect(pool.query.mock.calls[1][0]).toContain("status           = 'available'");
});

test('ensurePdf ne remplace jamais un PDF déjà disponible', async () => {
  const existing = { id: 'doc-1', status: 'available', pdf_content: Buffer.from('%PDF-existing') };
  await expect(ensurePdf(existing)).resolves.toBe(existing);
  expect(mockRenderPdf).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
});

test('une erreur de rendu place le document en error', async () => {
  mockRenderPdf.mockRejectedValueOnce(new Error('render failed'));
  pool.query.mockResolvedValueOnce({ rows: [] });
  await expect(ensurePdf({ id: 'doc-1', document_type: 'refund_receipt' })).rejects.toThrow('render failed');
  expect(pool.query.mock.calls[0][0]).toContain("SET status = 'error'");
});

'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));
jest.mock('../../services/documents/document-service', () => ({
  findExistingDocument: jest.fn(),
  persistDocument: jest.fn(),
}));

const pool = require('../../db');
const documentService = require('../../services/documents/document-service');
const { issue, buildDisplayData } = require('../../services/documents/refund-receipt');

describe('refund-receipt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse un refundId manquant', async () => {
    await expect(issue()).rejects.toThrow('refundId requis');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('refuse demettre un recu pour remboursement non confirme', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'refund-001', status: 'pending' }] });

    await expect(issue('refund-001')).rejects.toThrow('non confirmé');
    expect(documentService.persistDocument).not.toHaveBeenCalled();
  });

  it('retourne le document existant si deja emis', async () => {
    const existing = { id: 'doc-001', reference: 'REM-2026-000001' };
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'refund-001', status: 'completed' }] });
    documentService.findExistingDocument.mockResolvedValueOnce(existing);

    await expect(issue('refund-001')).resolves.toBe(existing);
    expect(documentService.persistDocument).not.toHaveBeenCalled();
  });

  it('emet un recu de remboursement confirme avec reference stable', async () => {
    const refund = {
      id: 'refund-001', order_id: 'order-001', status: 'completed',
      order_reference: 'CMD-001', invoice_number: 'FAC-001', invoice_id: 'inv-001',
      amount_kmf: 5000, amount_eur: 10.16, refund_method: 'stripe', refund_type: 'partial',
      stripe_refund_id: 're_001', reason: 'annulation', completed_at: '2026-06-01T00:00:00Z',
      order_payment_mode: 'card',
    };
    const doc = { id: 'doc-001', reference: 'REM-2026-000042' };
    pool.query
      .mockResolvedValueOnce({ rows: [refund] })
      .mockResolvedValueOnce({ rows: [{ seq: 42 }] });
    documentService.findExistingDocument.mockResolvedValueOnce(null);
    documentService.persistDocument.mockResolvedValueOnce(doc);

    await expect(issue('refund-001', { issuedBy: 'admin-001' })).resolves.toBe(doc);
    expect(documentService.persistDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentType: 'refund_receipt',
      subjectType: 'refund',
      subjectId: 'refund-001',
      orderId: 'order-001',
      refundId: 'refund-001',
      reference: 'REM-2026-000042',
      issuedBy: 'admin-001',
      metadata: expect.objectContaining({ order_reference: 'CMD-001', amount_kmf: 5000, refund_method: 'stripe' }),
    }));
  });

  it('buildDisplayData formate les champs visibles du recu', () => {
    const data = buildDisplayData({
      reference: 'REM-2026-000001',
      issued_at: '2026-06-02T00:00:00Z',
      metadata: JSON.stringify({
        order_reference: 'CMD-001', invoice_number: 'FAC-001', amount_kmf: 5000,
        amount_eur: 10.16, refund_method: 'wallet_credit', refund_type: 'partial',
        reason: 'geste', confirmed_at: '2026-06-01T00:00:00Z', stripe_refund_id: null,
      }),
    });

    expect(data).toMatchObject({
      reference: 'REM-2026-000001',
      document_type: 'Reçu de remboursement',
      order_reference: 'CMD-001',
      invoice_number: 'FAC-001',
      amount_kmf: '5 000 KMF',
      amount_eur: '10.16 EUR',
      method: 'Avoir Komerce (wallet)',
      refund_type: 'partial',
      reason: 'geste',
    });
  });
});

'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const pool = require('../../db');
const {
  findExistingDocument,
  persistDocument,
  markDelivered,
} = require('../../services/documents/document-service');

describe('document-service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('findExistingDocument retourne le document existant', async () => {
    const doc = { id: 'doc-001', reference: 'REM-001' };
    pool.query.mockResolvedValueOnce({ rows: [doc] });

    await expect(findExistingDocument({
      documentType: 'refund_receipt', subjectType: 'refund', subjectId: 'refund-001',
    })).resolves.toBe(doc);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM transaction_documents'), [
      'refund_receipt', 'refund', 'refund-001',
    ]);
  });

  it('findExistingDocument retourne null si absent', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(findExistingDocument({ documentType: 'x', subjectType: 'y', subjectId: 'z' })).resolves.toBeNull();
  });

  it('persistDocument insere un document transactionnel avec metadata stringify', async () => {
    const doc = { id: 'doc-001', reference: 'REM-001' };
    pool.query.mockResolvedValueOnce({ rows: [doc] });

    await expect(persistDocument({
      documentType: 'refund_receipt',
      subjectType: 'refund',
      subjectId: 'refund-001',
      orderId: 'order-001',
      refundId: 'refund-001',
      reference: 'REM-001',
      issuedBy: 'admin-001',
      metadata: { amount_kmf: 5000 },
    })).resolves.toBe(doc);

    expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO transaction_documents');
    expect(pool.query.mock.calls[0][1]).toEqual([
      'refund_receipt', 'refund', 'refund-001', 'order-001', 'refund-001', 'REM-001', 'admin-001', JSON.stringify({ amount_kmf: 5000 }),
    ]);
  });

  it('persistDocument retourne lexistant en cas de conflit', async () => {
    const existing = { id: 'doc-existing', reference: 'REM-OLD' };
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [existing] });

    await expect(persistDocument({
      documentType: 'refund_receipt', subjectType: 'refund', subjectId: 'refund-001', reference: 'REM-001',
    })).resolves.toBe(existing);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('markDelivered marque le canal de delivrance', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await markDelivered('doc-001', 'whatsapp');

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("SET status     = 'delivered'"), ['doc-001', 'whatsapp']);
  });
});

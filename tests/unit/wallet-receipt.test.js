'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/documents/document-service', () => ({
  findExistingDocument: jest.fn(),
  persistDocument: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })) }));

const pool = require('../../db');
const documentService = require('../../services/documents/document-service');
const { issue } = require('../../services/documents/wallet-receipt');

describe('wallet-receipt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse un walletTransactionId manquant', async () => {
    await expect(issue()).rejects.toThrow('walletTransactionId requis');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('throw si transaction wallet introuvable', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(issue('tx-missing')).rejects.toThrow('Transaction wallet tx-missing introuvable');
    expect(pool.query.mock.calls[0][0]).toContain('JOIN   wallets w ON w.id = wt.wallet_id');
    expect(pool.query.mock.calls[0][0]).not.toContain('wt.user_id');
  });

  it('retourne null si le mouvement nest pas eligible a un recu', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'tx-001', reason: 'checkout_debit' }] });

    await expect(issue('tx-001')).resolves.toBeNull();
    expect(documentService.findExistingDocument).not.toHaveBeenCalled();
  });

  it('retourne le document existant si recu deja emis', async () => {
    const existing = { id: 'doc-001', reference: 'WAL-2026-000001' };
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'tx-001', reason: 'refund' }] });
    documentService.findExistingDocument.mockResolvedValueOnce(existing);

    await expect(issue('tx-001')).resolves.toBe(existing);
    expect(documentService.persistDocument).not.toHaveBeenCalled();
  });

  it('genere une reference WAL et persiste un snapshot metadata fige', async () => {
    const tx = {
      id: 'tx-001', user_id: 'user-001', user_name: 'Ali', user_phone: '+269000',
      amount_kmf: 5000, type: 'credit', reason: 'refund', note: 'annulation',
      reference_id: 'order-001',
    };
    const doc = { id: 'doc-001', reference: 'WAL-2026-000042' };
    pool.query
      .mockResolvedValueOnce({ rows: [tx] })
      .mockResolvedValueOnce({ rows: [{ seq: 42 }] });
    documentService.findExistingDocument.mockResolvedValueOnce(null);
    documentService.persistDocument.mockResolvedValueOnce(doc);

    await expect(issue('tx-001', { issuedBy: 'admin-001' })).resolves.toBe(doc);
    expect(documentService.persistDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentType: 'wallet_receipt',
      subjectType: 'wallet_tx',
      subjectId: 'tx-001',
      orderId: null,
      ownerUserId: 'user-001',
      reference: expect.stringMatching(/^WAL-\d{4}-000042$/),
      issuedBy: 'admin-001',
      metadata: expect.objectContaining({
        wallet_transaction_id: 'tx-001', user_id: 'user-001', user_name: 'Ali', user_phone: '+269000',
        amount_kmf: 5000, direction: 'credit', reason: 'refund', note: 'annulation', order_id: 'order-001', lot_id: null,
      }),
      dbClient: pool,
    }));
  });

  it('utilise dbClient fourni sans passer par pool pour query/persist', async () => {
    const dbClient = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'tx-001', reason: 'loyalty', user_id: 'u1', amount_kmf: 1000, type: 'credit' }] })
      .mockResolvedValueOnce({ rows: [{ seq: 7 }] }) };
    documentService.findExistingDocument.mockResolvedValueOnce(null);
    documentService.persistDocument.mockResolvedValueOnce({ id: 'doc-007' });

    await expect(issue('tx-001', { dbClient })).resolves.toEqual({ id: 'doc-007' });
    expect(pool.query).not.toHaveBeenCalled();
    expect(documentService.persistDocument).toHaveBeenCalledWith(expect.objectContaining({ dbClient, reference: expect.stringMatching(/000007$/) }));
  });
});

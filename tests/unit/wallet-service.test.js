'use strict';

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/documents/wallet-receipt', () => ({ issue: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const db = require('../../db');
const walletReceiptService = require('../../services/documents/wallet-receipt');
const wallet = require('../../services/wallet-service');

describe('wallet-service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getOrCreateWallet retourne le wallet existant avec FOR UPDATE si demande', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'wallet-001', balance_kmf: 1000 }] }) };

    await expect(wallet.getOrCreateWallet(client, 'user-001', { forUpdate: true })).resolves.toMatchObject({ id: 'wallet-001' });
    expect(client.query).toHaveBeenCalledWith('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', ['user-001']);
  });

  it('credit est idempotent si idempotency_key existe deja', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'tx-dup', idempotency_key: 'k1' }] }) };

    await expect(wallet.credit(client, { userId: 'u1', amountKmf: 5000, reason: 'refund', idempotencyKey: 'k1' }))
      .resolves.toEqual({ transaction: { id: 'tx-dup', idempotency_key: 'k1' }, duplicate: true });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('credit cree wallet, transaction et lot de credit', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-001', balance_kmf: 0 }] })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-001', balance_after_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lot-001', remaining_kmf: 5000 }] }) };

    const result = await wallet.credit(client, { userId: 'u1', amountKmf: 5000, reason: 'refund', referenceId: 'order-001', metadata: { source: 'test' }, createdBy: 'admin' });

    expect(result).toMatchObject({ transaction: { id: 'tx-001' }, lot: { id: 'lot-001' }, duplicate: false });
    expect(client.query.mock.calls[2][0]).toContain('balance_kmf = balance_kmf + $1');
    expect(client.query.mock.calls[3][1][7]).toBe(JSON.stringify({ source: 'test' }));
  });

  it('debit refuse un solde insuffisant', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'wallet-001', balance_kmf: 1000 }] }) };

    await expect(wallet.debit(client, { userId: 'u1', amountKmf: 5000, reason: 'checkout' })).rejects.toThrow('Solde insuffisant');
  });

  it('debit consomme les lots FIFO et cree les consommations order', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-001', balance_kmf: 8000 }] })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 3000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-debit', balance_after_kmf: 3000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1', remaining_kmf: 3000 }, { id: 'lot-2', remaining_kmf: 4000 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'cons-1', amount_kmf: 3000 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'cons-2', amount_kmf: 2000 }] }) };

    const result = await wallet.debit(client, { userId: 'u1', amountKmf: 5000, reason: 'checkout', referenceId: 'order-001' });

    expect(result).toMatchObject({ transaction: { id: 'tx-debit' }, duplicate: false });
    expect(result.consumptions).toEqual([{ id: 'cons-1', amount_kmf: 3000 }, { id: 'cons-2', amount_kmf: 2000 }]);
    expect(client.query.mock.calls[4][1]).toEqual([0, 'used', 'lot-1']);
    expect(client.query.mock.calls[6][1]).toEqual([2000, 'active', 'lot-2']);
  });

  it('applyToOrder verifie ownership, debite au max utile et marque paid si reste zero', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'order-001', user_id: 'u1', total_kmf: 4000, reference: 'CMD-001' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-001', balance_kmf: 6000 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-001', balance_kmf: 6000 }] })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 2000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-debit' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1', remaining_kmf: 4000 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'cons-1' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };

    const result = await wallet.applyToOrder(client, { userId: 'u1', orderId: 'order-001', amountKmf: 9999 });

    expect(result).toMatchObject({ applied_kmf: 4000, remaining_to_pay: 0 });
    expect(client.query.mock.calls[9][1]).toEqual([4000, 0, 'order-001']);
  });

  it('applyToOrder bloque une commande appartenant a un autre utilisateur', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'order-001', user_id: 'other', total_kmf: 4000 }] }) };

    await expect(wallet.applyToOrder(client, { userId: 'u1', orderId: 'order-001', amountKmf: 1000 }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('removeFromOrder est no-op idempotent sans consommation non reversee', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(wallet.removeFromOrder(client, { orderId: 'order-001' })).resolves.toEqual({ transaction: null, reversed_kmf: 0, noop: true });
  });

  it('removeFromOrder reverse les consommations sans suppression physique', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ wallet_id: 'wallet-001', credit_lot_id: 'lot-1', amount_kmf: 3000 }, { wallet_id: 'wallet-001', credit_lot_id: 'lot-2', amount_kmf: 2000 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-rev' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };

    const result = await wallet.removeFromOrder(client, { orderId: 'order-001' });

    expect(result).toEqual({ transaction: { id: 'tx-rev' }, reversed_kmf: 5000 });
    expect(client.query.mock.calls[3][0]).toContain('reversed_at = NOW()');
    expect(client.query.mock.calls[6][0]).toContain('wallet_applied_kmf = 0');
  });

  it('reverseLot bloque un lot deja consomme et reverse un lot actif non consomme', async () => {
    const clientBlocked = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1', status: 'active', wallet_id: 'wallet-001', remaining_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ c: 1 }] }) };
    await expect(wallet.reverseLot(clientBlocked, { lotId: 'lot-1' })).rejects.toThrow('Reversal bloqué');

    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1', status: 'active', wallet_id: 'wallet-001', remaining_kmf: 5000, source_order_id: 'order-001' }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 6000 }] })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 1000 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-reverse' }] }) };

    await expect(wallet.reverseLot(client, { lotId: 'lot-1', adminId: 'admin', note: 'err' }))
      .resolves.toEqual({ transaction: { id: 'tx-reverse' }, reversed_kmf: 5000, walletTxId: 'tx-reverse' });
    expect(client.query.mock.calls[3][0]).toContain('balance_kmf = balance_kmf - $1');
  });

  it('queries lecture retournent balance, transactions, wallets et detail', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 1234 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-001' }] })
      .mockResolvedValueOnce({ rows: [{ c: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1' }] })
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-001', full_name: 'Ali' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-001', full_name: 'Ali' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1' }] });

    await expect(wallet.getBalance('u1')).resolves.toBe(1234);
    await expect(wallet.getTransactions('u-missing')).resolves.toEqual({ transactions: [], total: 0 });
    await expect(wallet.getTransactions('u1')).resolves.toEqual({ transactions: [{ id: 'tx-1' }], total: 2 });
    await expect(wallet.listWallets({ search: 'Ali' })).resolves.toEqual({ wallets: [{ id: 'wallet-001', full_name: 'Ali' }], total: 1 });
    await expect(wallet.getWalletDetail('u1')).resolves.toEqual({ wallet: { id: 'wallet-001', full_name: 'Ali' }, transactions: [{ id: 'tx-1' }], lots: [{ id: 'lot-1' }] });
  });

  it('issueReceiptForCredit delegue au document wallet receipt', async () => {
    walletReceiptService.issue.mockResolvedValueOnce({ id: 'doc-001' });

    await expect(wallet.issueReceiptForCredit('tx-001', 'admin')).resolves.toEqual({ id: 'doc-001' });
    expect(walletReceiptService.issue).toHaveBeenCalledWith('tx-001', { issuedBy: 'admin' });
  });
});

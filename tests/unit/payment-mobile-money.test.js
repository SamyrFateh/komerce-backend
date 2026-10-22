'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockDb = {
  query: jest.fn(),
  getClient: jest.fn(),
};
const mockAdapter = {
  name: 'orange_money',
  label: 'Orange Money',
  requiresMsisdn: false,
  isConfigured: jest.fn(() => true),
  publicConfig: jest.fn(() => ({
    provider: 'orange_money', label: 'Orange Money', market_code: 'CM',
    requires_msisdn: false, configured: true, flow: 'redirect',
  })),
  initiate: jest.fn(),
  getStatus: jest.fn(),
};

jest.mock('../../db', () => mockDb);
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../utils/currency', () => ({
  projectAmount: jest.fn(),
  roundToMinorUnit: jest.fn((n) => Math.round(n)),
}));
jest.mock('../../services/mobile-money/registry', () => ({
  getAdapter: jest.fn(() => mockAdapter),
}));
jest.mock('../../services/order-payment-confirmation', () => ({ confirmPaymentCycle: jest.fn() }));
jest.mock('../../services/order-mutation-service', () => ({ appendOrderNote: jest.fn() }));
jest.mock('../../utils/alerts', () => ({ createAlert: jest.fn() }));
jest.mock('../../services/pickup-secret-service', () => ({
  generateAndStoreSecret: jest.fn(),
  cacheCodeForReveal: jest.fn(() => Promise.resolve()),
}));

const currency = require('../../utils/currency');
const mobileMoney = require('../../services/payment-mobile-money');

function q(rows) { return Promise.resolve({ rows }); }

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockReset();
  mockDb.getClient.mockReset();
  mockAdapter.getStatus.mockReset();
  mockAdapter.initiate.mockReset();
  mockAdapter.isConfigured.mockReturnValue(true);
  process.env.PUBLIC_BASE_URL = 'https://staging.komerce.test';
});

describe('Mobile Money amount contract', () => {
  test('rejette montant provider différent du snapshot figé', () => {
    const tx = { amount_minor: 13280, minor_unit: 0, currency: 'XAF' };
    expect(mobileMoney.providerContractMatches(tx, { amount: 13280, currency: 'XAF' })).toEqual({ ok: true });
    expect(mobileMoney.providerContractMatches(tx, { amount: 13281, currency: 'XAF' })).toEqual({ ok: false, reason: 'amount_mismatch' });
    expect(mobileMoney.providerContractMatches(tx, { amount: 13280, currency: 'EUR' })).toEqual({ ok: false, reason: 'currency_mismatch' });
  });

  test('absence montant/devise dans un status provider ne fabrique pas de mismatch', () => {
    const tx = { amount_minor: 13280, minor_unit: 0, currency: 'XAF' };
    expect(mobileMoney.providerContractMatches(tx, {})).toEqual({ ok: true });
  });
});

describe('getAvailability', () => {
  test('provider DB + adapter runtime configuré = disponible', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{
      market_id: 'market-cm', market_code: 'CM', market_name: 'Cameroun',
      market_currency: 'XAF', minor_unit: 0,
      provider: 'orange_money', payment_currency: 'XAF', priority: 10,
    }] });

    await expect(mobileMoney.getAvailability('cm')).resolves.toEqual({
      market_code: 'CM', currency: 'XAF', available: true, reason: null,
      provider: 'orange_money', label: 'Orange Money',
      requires_msisdn: false, flow: 'redirect',
    });
  });

  test('provider activé en DB mais secrets absents = fail-closed', async () => {
    mockAdapter.isConfigured.mockReturnValue(false);
    mockDb.query.mockResolvedValueOnce({ rows: [{
      market_id: 'market-cm', market_code: 'CM', market_name: 'Cameroun',
      market_currency: 'XAF', minor_unit: 0,
      provider: 'orange_money', payment_currency: 'XAF', priority: 10,
    }] });

    const result = await mobileMoney.getAvailability('CM');
    expect(result.available).toBe(false);
    expect(result.reason).toBe('provider_not_configured');
  });
});

describe('initiateMobileMoney', () => {
  const order = {
    id: 'order-1', reference: 'K-CM-001', user_id: 'user-1',
    payment_mode: 'mobile_money', payment_status: 'pending',
    total_kmf: 10000, market_id: 'market-cm', relais_id: 'relay-cm',
    fx_snapshot: { market: { currency: 'XAF', amount: 13334.1, amount_text: '13334.1', minor_unit: 0 } },
    market_code: 'CM', market_currency: 'XAF', market_minor_unit: 0,
  };

  test('projette côté serveur puis fige le montant avant appel provider', async () => {
    mockAdapter.initiate.mockResolvedValueOnce({
      externalTransactionId: 'PAY-1', status: 'pending', providerStatus: 'PENDING',
      safePayload: {}, clientAction: { type: 'redirect', url: 'https://orange.test/pay/PAY-1' },
    });

    mockDb.query
      .mockImplementationOnce(() => q([order])) // load order
      .mockImplementationOnce(() => q([{ // provider market
        provider: 'orange_money', currency: 'XAF', priority: 10,
        market_code: 'CM', market_currency: 'XAF', minor_unit: 0,
      }]))
      .mockImplementationOnce(() => q([])) // no active attempt
      .mockImplementationOnce(() => q([{ // INSERT transaction
        id: '11111111-1111-4111-8111-111111111111', order_id: 'order-1', market_id: 'market-cm',
        provider: 'orange_money', msisdn: null, currency: 'XAF', minor_unit: 0,
        amount_minor: 13334, status: 'initiated', provider_payload: {},
      }]))
      .mockImplementationOnce(() => q([{ // UPDATE provider result
        id: '11111111-1111-4111-8111-111111111111', order_id: 'order-1', market_id: 'market-cm',
        provider: 'orange_money', currency: 'XAF', minor_unit: 0, amount_minor: 13334,
        external_transaction_id: 'PAY-1', status: 'pending', provider_status: 'PENDING',
        provider_payload: { client_action: { type: 'redirect', url: 'https://orange.test/pay/PAY-1' } },
      }]));

    const result = await mobileMoney.initiateMobileMoney({ orderReference: 'K-CM-001' });

    expect(currency.projectAmount).not.toHaveBeenCalled(); // montant figé à la commande, jamais reconverti
    expect(mockAdapter.initiate).toHaveBeenCalledWith(expect.objectContaining({
      orderReference: 'K-CM-001',
      amount: 13334,
      currency: 'XAF',
    }));
    expect(result.transaction.amount).toBe(13334);
    expect(result.transaction.currency).toBe('XAF');
    expect(result.transaction.client_action.type).toBe('redirect');
  });

  test('replay réseau réutilise la tentative active et ne rappelle pas le provider', async () => {
    mockDb.query
      .mockImplementationOnce(() => q([order]))
      .mockImplementationOnce(() => q([{
        provider: 'orange_money', currency: 'XAF', priority: 10,
        market_code: 'CM', market_currency: 'XAF', minor_unit: 0,
      }]))
      .mockImplementationOnce(() => q([{
        id: '22222222-2222-4222-8222-222222222222', order_id: 'order-1',
        provider: 'orange_money', currency: 'XAF', minor_unit: 0, amount_minor: 13334,
        status: 'pending', provider_status: 'PENDING', order_reference: 'K-CM-001',
        provider_payload: { client_action: { type: 'redirect', url: 'https://orange.test/pay/existing' } },
      }]));

    const result = await mobileMoney.initiateMobileMoney({ orderReference: 'K-CM-001' });
    expect(result.reused).toBe(true);
    expect(result.transaction.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(mockAdapter.initiate).not.toHaveBeenCalled();
    expect(currency.projectAmount).not.toHaveBeenCalled();
  });
});

describe('S5 Mobile Money ordering and replay', () => {
  const terminalTx = {
    id: '33333333-3333-4333-8333-333333333333', order_id: 'order-1', market_id: 'market-cm',
    provider: 'orange_money', currency: 'XAF', minor_unit: 0, amount_minor: 13334,
    external_transaction_id: 'PAY-LATE', status: 'failed', provider_status: 'FAILED',
    order_reference: 'K-CM-001', payment_status: 'pending', provider_payload: {},
  };

  test('late provider success after local failed observation is reconciled, not ignored', async () => {
    mockDb.query
      .mockImplementationOnce(() => q([terminalTx]))
      .mockImplementationOnce(() => q([{ ...terminalTx, status: 'succeeded', provider_status: 'SUCCESSFUL' }]));
    mockAdapter.getStatus.mockResolvedValueOnce({ status: 'succeeded', providerStatus: 'SUCCESSFUL', amount: 13334, currency: 'XAF', safePayload: {} });
    const client = { query: jest.fn(), release: jest.fn() };
    mockDb.getClient.mockResolvedValueOnce(client);
    client.query
      .mockImplementationOnce(() => q([])) // BEGIN
      .mockImplementationOnce(() => q([{ ...terminalTx, status: 'failed' }])) // lock
      .mockImplementationOnce(() => q([])) // mark succeeded
      .mockImplementationOnce(() => q([])) // ROLLBACK after mocked cycle rejection below
    require('../../services/order-payment-confirmation').confirmPaymentCycle.mockResolvedValueOnce({ success: false, error: 'stop after proving finalizer reached' });
    require('../../utils/alerts').createAlert.mockResolvedValueOnce(undefined);
    await expect(mobileMoney.reconcileMobileMoneyTransaction(terminalTx.id)).rejects.toMatchObject({ code: 'mobile_money_cycle_rejected' });
    expect(mockAdapter.getStatus).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET status='succeeded'"))).toBe(true);
  });

  test('concurrent replay that finds payment already finalized does not rerun payment cycle', async () => {
    mockDb.query
      .mockImplementationOnce(() => q([{ ...terminalTx, status: 'pending' }]))
      .mockImplementationOnce(() => q([{ ...terminalTx, status: 'succeeded', payment_status: 'paid' }]));
    mockAdapter.getStatus.mockResolvedValueOnce({ status: 'succeeded', providerStatus: 'SUCCESSFUL', amount: 13334, currency: 'XAF', safePayload: {} });
    const client = { query: jest.fn(), release: jest.fn() };
    mockDb.getClient.mockResolvedValueOnce(client);
    client.query
      .mockImplementationOnce(() => q([]))
      .mockImplementationOnce(() => q([{ ...terminalTx, status: 'succeeded', payment_status: 'paid' }]))
      .mockImplementationOnce(() => q([]));

    const result = await mobileMoney.reconcileMobileMoneyTransaction(terminalTx.id);
    expect(result.reconciled).toBe(true);
    expect(require('../../services/order-payment-confirmation').confirmPaymentCycle).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('already succeeded transaction is idempotent and does not call provider again', async () => {
    mockDb.query.mockImplementationOnce(() => q([{ ...terminalTx, status: 'succeeded', payment_status: 'paid' }]));
    const result = await mobileMoney.reconcileMobileMoneyTransaction(terminalTx.id);
    expect(result.reconciled).toBe(false);
    expect(result.transaction.status).toBe('succeeded');
    expect(mockAdapter.getStatus).not.toHaveBeenCalled();
  });
});

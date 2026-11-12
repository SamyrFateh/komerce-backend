'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief Compensation SAV après remise : admin motivé, un mouvement wallet dans la devise du marché, jamais automatique, reçu après commit.
 */

const mockCredit = jest.fn();
const mockReceipt = jest.fn().mockResolvedValue(null);
const mockResolveCurrency = jest.fn();
jest.mock('../../services/wallet-service', () => ({
  credit: (...a) => mockCredit(...a),
  issueReceiptForCredit: (...a) => mockReceipt(...a),
  resolveOrderWalletCurrency: (...a) => mockResolveCurrency(...a),
}));
jest.mock('../../services/fx-authority', () => ({
  prorate: (amount, num, den) => Math.round((Number(amount) * Number(num)) / Number(den)),
}));

const svc = require('../../services/relay-return-compensation-service');

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = { id: uuid(1), role: 'admin' };
const REQ = uuid(2);
const dossier = (extra = {}) => ({
  id: REQ, status: 'open', type: 'product_return', return_quantity: 1, order_id: uuid(3), payer_user_id: uuid(4),
  market_id: uuid(5), total_kmf: 10000, reference: 'CMD-1', unit_price_kmf: 4000, qty_collected: 1,
  fx_snapshot: { market: { currency: 'XAF', amount: 15000, minor_unit: 0 } }, ...extra,
});

function makeDb({ row = dossier(), existing = null } = {}) {
  const calls = [];
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM disputes d/.test(sql)) return { rows: row ? [row] : [] };
      if (/FROM relay_return_compensations/.test(sql)) return { rows: existing ? [existing] : [] };
      if (/business_rules/.test(sql)) return { rows: [] };
      if (/relay_product_return_receipts/.test(sql)) return { rows: [{ id: uuid(9) }] };
      if (/INSERT INTO relay_return_compensations/.test(sql)) return { rows: [{ id: uuid(8), request_id: REQ, amount: params[3], currency: params[4] }] };
      return { rows: [] };
    }),
  };
  return { db: { getClient: async () => client, query: client.query }, calls, client };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveCurrency.mockResolvedValue('XAF');
  mockCredit.mockResolvedValue({ transaction: { id: uuid(7) } });
});

describe('decideCompensation', () => {
  const base = { actor: ADMIN, requestId: REQ, movement: 'wallet_credit', amount: 3000, reason: 'Défaut cosmétique constaté au relais' };

  it('exige un admin', async () => {
    const { db } = makeDb();
    await expect(svc.decideCompensation({ ...base, actor: { id: uuid(1), role: 'agent_relais' }, db })).rejects.toMatchObject({ code: 'COMPENSATION_ADMIN_REQUIRED', status: 403 });
  });

  it('exige une décision motivée', async () => {
    const { db } = makeDb();
    await expect(svc.decideCompensation({ ...base, reason: 'ok', db })).rejects.toMatchObject({ code: 'COMPENSATION_REASON_REQUIRED' });
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('remboursement ledger / ré-expédition : refus explicite, aucun mouvement', async () => {
    const { db } = makeDb();
    await expect(svc.decideCompensation({ ...base, movement: 'reship', db })).rejects.toMatchObject({ code: 'COMPENSATION_MOVEMENT_NOT_AVAILABLE' });
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('crédit wallet du payeur en XAF, une décision, reçu émis après commit', async () => {
    const { db, calls } = makeDb();
    const out = await svc.decideCompensation({ ...base, db });
    expect(mockCredit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: uuid(4), amountKmf: 3000, currency: 'XAF', reason: 'sav_compensation', idempotencyKey: `sav_comp_${REQ}`,
    }));
    expect(out.replayed).toBe(false);
    const order = calls.map((c) => c.sql.trim().split(/\s/)[0]);
    expect(order.lastIndexOf('COMMIT')).toBeGreaterThan(order.indexOf('INSERT'));
    expect(mockReceipt).toHaveBeenCalledWith(uuid(7), ADMIN.id);
  });

  it('plafonné à la valeur de la ligne dans la devise du marché (4000 KMF = 6000 XAF)', async () => {
    const { db } = makeDb();
    await expect(svc.decideCompensation({ ...base, amount: 6001, db })).rejects.toMatchObject({ code: 'COMPENSATION_EXCEEDS_LINE_VALUE' });
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('article non remis → refus ; une seule décision par dossier', async () => {
    await expect(svc.decideCompensation({ ...base, db: makeDb({ row: dossier({ qty_collected: 0 }) }).db })).rejects.toMatchObject({ code: 'COMPENSATION_NOT_AFTER_HANDOVER' });
    await expect(svc.decideCompensation({ ...base, amount: 100, db: makeDb({ existing: { movement: 'wallet_credit', amount: '3000', decided_by: ADMIN.id } }).db }))
      .rejects.toMatchObject({ code: 'COMPENSATION_ALREADY_DECIDED' });
  });

  it('rejeu identique → idempotent, sans second crédit', async () => {
    const { db } = makeDb({ existing: { movement: 'wallet_credit', amount: '3000', decided_by: ADMIN.id } });
    const out = await svc.decideCompensation({ ...base, db });
    expect(out.replayed).toBe(true);
    expect(mockCredit).not.toHaveBeenCalled();
  });
});

describe('proposeCompensation', () => {
  it('barème par défaut 20 % de la valeur de ligne dans la devise du marché, sans écriture', async () => {
    const { db } = makeDb();
    const p = await svc.proposeCompensation({ actor: ADMIN, requestId: REQ, db });
    expect(p).toMatchObject({ currency: 'XAF', line_value: 6000, scale_pct: 20, suggested_amount: 1200 });
    expect(mockCredit).not.toHaveBeenCalled();
  });
});

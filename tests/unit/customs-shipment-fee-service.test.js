'use strict';

jest.mock('../../services/cost-allocation', () => ({
  allocateShipmentRealCosts: jest.fn().mockResolvedValue({ allocations_count: 3 }),
}));

const costAllocation = require('../../services/cost-allocation');
const { recordFee, listFees, summarize, _internals } = require('../../services/customs-shipment-fee-service');

const SHIP = '11111111-1111-4111-8111-111111111111';
const base = { fee_type: 'handling', amount_kmf: '1500.50', currency: 'KMF', proof_ref: 'FACT-1', idempotency_key: 'k1' };

function makeClient({ ship = { id: SHIP, status: 'declared', is_active: true }, existing = null, parcels = 2, fees = [] } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    calls.push(s);
    if (s.includes('FROM customs_shipments WHERE id = $1 FOR UPDATE')) return { rows: ship ? [ship] : [] };
    if (s.includes('AND idempotency_key')) return { rows: existing ? [existing] : [] };
    if (s.includes('COUNT(*)::int AS n FROM customs_shipment_parcels')) return { rows: [{ n: parcels }] };
    if (s.startsWith('SELECT * FROM customs_shipment_fees WHERE shipment_id')) return { rows: fees };
    if (s.startsWith('INSERT INTO customs_shipment_fees')) {
      return { rows: [{ id: 'f-new', shipment_id: SHIP, fee_type: params[1], kind: params[2], amount_currency: params[3],
        currency: params[4], amount_kmf: params[5], proof_ref: params[6], idempotency_key: params[7], notes: params[8], recorded_by: params[9] }] };
    }
    return { rows: [] };
  });
  return { query, calls };
}

beforeEach(() => jest.clearAllMocks());

describe('customs-shipment-fee-service', () => {
  test('enregistre un frais KMF, reventile dans la même transaction et résume par type', async () => {
    const client = makeClient();
    const r = await recordFee(client, SHIP, base, 'u1');
    expect(r.idempotent_replay).toBe(false);
    expect(r.fee).toMatchObject({ fee_type: 'handling', kind: 'charge', amount_kmf: '1500.50', amount_currency: '1500.5000' });
    expect(r.summary.by_type.handling).toEqual({ state: 'amount', net_kmf: '1500.50' });
    expect(r.summary.by_type.storage).toEqual({ state: 'unknown', net_kmf: null });
    expect(costAllocation.allocateShipmentRealCosts).toHaveBeenCalledWith(SHIP, client);
  });

  test('zéro confirmé accepté (charge à 0) ≠ inconnu', async () => {
    const r = await recordFee(makeClient(), SHIP, { ...base, amount_kmf: 0, idempotency_key: 'k0' }, 'u1');
    expect(r.summary.by_type.handling).toEqual({ state: 'zero_confirmed', net_kmf: '0.00' });
  });

  test.each([
    [{ fee_type: 'duties' }, 'CUSTOMS_FEE_TYPE_INVALID'],
    [{ kind: 'refund' }, 'CUSTOMS_FEE_KIND_INVALID'],
    [{ amount_kmf: -1 }, 'CUSTOMS_FEE_AMOUNT_KMF_INVALID'],
    [{ amount_kmf: '10.123' }, 'CUSTOMS_FEE_AMOUNT_KMF_INVALID'],
    [{ amount_kmf: 'abc' }, 'CUSTOMS_FEE_AMOUNT_KMF_INVALID'],
    [{ proof_ref: '  ' }, 'CUSTOMS_FEE_PROOF_REQUIRED'],
    [{ idempotency_key: '' }, 'CUSTOMS_FEE_IDEMPOTENCY_KEY_REQUIRED'],
    [{ kind: 'credit', amount_kmf: 0 }, 'CUSTOMS_FEE_CREDIT_POSITIVE'],
    [{ currency: 'EU' }, 'CUSTOMS_FEE_CURRENCY_INVALID'],
    [{ currency: 'KMF', amount_currency: '5' }, 'CUSTOMS_FEE_KMF_MISMATCH'],
  ])('refuse un payload invalide %j', async (patch, code) => {
    await expect(recordFee(makeClient(), SHIP, { ...base, ...patch }, 'u1')).rejects.toMatchObject({ status: 400, code });
    expect(costAllocation.allocateShipmentRealCosts).not.toHaveBeenCalled();
  });

  test('refus: expédition introuvable / inactive / pending / sans colis — rien n\'est écrit', async () => {
    await expect(recordFee(makeClient({ ship: null }), SHIP, base)).rejects.toMatchObject({ status: 404 });
    await expect(recordFee(makeClient({ ship: { id: SHIP, status: 'declared', is_active: false } }), SHIP, base))
      .rejects.toMatchObject({ code: 'CUSTOMS_SHIPMENT_INACTIVE' });
    await expect(recordFee(makeClient({ ship: { id: SHIP, status: 'pending', is_active: true } }), SHIP, base))
      .rejects.toMatchObject({ code: 'CUSTOMS_SHIPMENT_NOT_DECLARED' });
    const noParcels = makeClient({ parcels: 0 });
    await expect(recordFee(noParcels, SHIP, base)).rejects.toMatchObject({ status: 409, code: 'CUSTOMS_SHIPMENT_WITHOUT_PARCELS' });
    expect(noParcels.calls.some(c => c.startsWith('INSERT'))).toBe(false);
  });

  test('idempotence: même clé même contenu = rejeu ; contenu différent = 409', async () => {
    const existing = { id: 'f1', shipment_id: SHIP, fee_type: 'handling', kind: 'charge', amount_currency: '1500.5000',
      currency: 'KMF', amount_kmf: '1500.50', proof_ref: 'FACT-1', idempotency_key: 'k1', notes: null };
    const replay = await recordFee(makeClient({ existing, fees: [existing] }), SHIP, base);
    expect(replay.idempotent_replay).toBe(true);
    expect(costAllocation.allocateShipmentRealCosts).not.toHaveBeenCalled();
    await expect(recordFee(makeClient({ existing }), SHIP, { ...base, amount_kmf: '1600' }))
      .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_FEE_IDEMPOTENCY_CONFLICT' });
  });

  test('credit: plafonné au net des charges du même type; correction à la baisse acceptée', async () => {
    const charge = { fee_type: 'storage', kind: 'charge', amount_kmf: '1000.00' };
    await expect(recordFee(makeClient({ fees: [charge] }), SHIP, { ...base, fee_type: 'storage', kind: 'credit', amount_kmf: '1000.01', idempotency_key: 'c1' }))
      .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_FEE_CREDIT_EXCEEDS_CHARGES' });
    const ok = await recordFee(makeClient({ fees: [charge] }), SHIP, { ...base, fee_type: 'storage', kind: 'credit', amount_kmf: '400', idempotency_key: 'c2' });
    expect(ok.summary.by_type.storage).toEqual({ state: 'amount', net_kmf: '600.00' });
    await expect(recordFee(makeClient({ fees: [{ fee_type: 'handling', kind: 'charge', amount_kmf: '500' }] }), SHIP,
      { ...base, fee_type: 'storage', kind: 'credit', amount_kmf: '1', idempotency_key: 'c3' }))
      .rejects.toMatchObject({ code: 'CUSTOMS_FEE_CREDIT_EXCEEDS_CHARGES' });
  });

  test('devise étrangère: amount_currency requis, KMF supporté fait foi', async () => {
    await expect(recordFee(makeClient(), SHIP, { ...base, currency: 'EUR' })).rejects.toMatchObject({ code: 'CUSTOMS_FEE_AMOUNT_CURRENCY_INVALID' });
    const r = await recordFee(makeClient(), SHIP, { ...base, currency: 'EUR', amount_currency: '3.5', amount_kmf: '1722' });
    expect(r.fee).toMatchObject({ currency: 'EUR', amount_currency: '3.5000', amount_kmf: '1722.00' });
  });

  test('summarize: types non saisis = unknown, total net conservé', () => {
    const s = summarize([
      { fee_type: 'handling', kind: 'charge', amount_kmf: '100.10' },
      { fee_type: 'handling', kind: 'charge', amount_kmf: '0.20' },
      { fee_type: 'forwarder', kind: 'charge', amount_kmf: '0' },
    ]);
    expect(s.total_net_kmf).toBe('100.30');
    expect(s.by_type.forwarder.state).toBe('zero_confirmed');
    expect(s.by_type.other.state).toBe('unknown');
    expect(s.recorded_types).toEqual(['handling', 'forwarder']);
  });

  test('listFees: 404 si expédition absente, summary sinon', async () => {
    await expect(listFees({ query: jest.fn().mockResolvedValue({ rows: [] }) }, SHIP)).rejects.toMatchObject({ status: 404 });
    const q = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: SHIP }] })
      .mockResolvedValueOnce({ rows: [{ id: 'f', shipment_id: SHIP, fee_type: 'other', kind: 'charge', amount_currency: '5', currency: 'KMF', amount_kmf: '5', proof_ref: 'p', idempotency_key: 'k' }] });
    const r = await listFees({ query: q }, SHIP);
    expect(r.summary.by_type.other).toEqual({ state: 'amount', net_kmf: '5.00' });
    expect(_internals.toUnits('1.5', 2)).toBe(150n);
  });
});

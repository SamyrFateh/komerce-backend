'use strict';

/**
 * @test-kind unit
 * @brief L7 — Les mouvements de garde ne deviennent pas des recettes.
 *        Les coûts d'expédition restent liés à l'expédition ; les avoirs les diminuent.
 */
jest.mock('../../services/financial-journal', () => ({
  recordMovement: jest.fn(async () => ({ outcome: 'created' })),
}));
const journal = require('../../services/financial-journal');
const projectors = require('../../services/financial-journal-projectors');
const MID = '00000000-0000-4000-8000-000000000001';
const SID = '00000000-0000-4000-8000-000000000002';
const HOLDER1 = '00000000-0000-4000-8000-000000000003';
const HOLDER2 = '00000000-0000-4000-8000-000000000004';
const R1 = '00000000-0000-4000-8000-000000000005';

beforeEach(() => journal.recordMovement.mockClear());
const clientFor = rows => ({ query: jest.fn(async () => ({ rows })) });

test('transfert confirmé = deux écritures de garde neutres, jamais recette ou charge', async () => {
  const base = { source: 'TRANSFER_OUT', ref_id: R1, deposit_id: SID, market_id: MID,
    delta_kmf: '-2500', occurred_at: '2026-11-03T11:00:00Z', deposit_ref: 'DEP-TEST',
    declared_currency: 'KMF', declared_amount: '2500', proof_ref: 'PROOF-X' };
  const client = clientFor([
    { ...base, holder_id: HOLDER1 },
    { ...base, source: 'TRANSFER_IN', holder_id: HOLDER2, delta_kmf: '2500' },
  ]);
  const report = await projectors.projectCustodyMovements(client, { marketId: MID });
  expect(report.created).toBe(2);
  const moves = journal.recordMovement.mock.calls.map(call => call[1]);
  expect(moves.map(m => m.direction)).toEqual(['custody', 'custody']);
  expect(moves.map(m => m.amountNative)).toEqual(['2500.00', '2500.00']);
  expect(moves.map(m => m.provenance.delta_sign)).toEqual([-1, 1]);
  expect(moves.every(m => m.provenance.economic_inflow === false)).toBe(true);
  expect(new Set(moves.map(m => m.facet)).size).toBe(2);
  expect(moves[0].documents[0].ref).toBe('PROOF-X');
});

test('fret constaté, charge et avoir : les coûts sont attachés aux expéditions', async () => {
  const client = clientFor([{ id: R1, shipment_id: SID, reference: 'SHIP-KM',
    market_id: MID, fee_type: 'handling', amount_kmf: '300', recorded_at: '2026-11-03T11:00:00Z',
    proof_ref: 'BILL-1', kind: 'credit' }]);
  await projectors.projectShipmentCharges(client, { marketId: MID });
  const move = journal.recordMovement.mock.calls[0][1];
  expect(move.direction).toBe('cost_reversal');
  expect(move.category).toBe('cost:shipment_handling');
  expect(move.links).toEqual({ marketId: MID, shipmentId: SID });
  expect(move.links.orderId).toBeUndefined();
  expect(move.provenance.allocation_to_items).toBe(false);
});

test('fret et douane : coût d’expédition, non chiffre d’affaires', async () => {
  const freight = { id: SID, reference: 'SHIP-KM', market_id: MID, amount_kmf: '1000',
    freight_invoice_ref: 'FREIGHT-1', occurred_at: '2026-11-03T11:00:00Z' };
  await projectors.projectShipmentFreight(clientFor([freight]));
  const customs = { id: R1, customs_reference: 'CST-1', reference: 'SHIP-KM',
    shipment_id: SID, market_id: MID, amount_kmf: '700',
    declared_at: '2026-11-03T12:00:00Z', proof_ref: 'DECL-1' };
  await projectors.projectShipmentCustoms(clientFor([customs]));
  const moves = journal.recordMovement.mock.calls.map(call => call[1]);
  expect(moves.map(x => x.direction)).toEqual(['cost', 'cost']);
  expect(moves.map(x => x.links.shipmentId)).toEqual([SID, SID]);
  expect(moves.every(x => x.provenance.allocation_to_items === false)).toBe(true);
  expect(moves.every(x => x.documents.length === 1)).toBe(true);
});

test('projectAll déclenche les sources L7 sans writer supplémentaire', async () => {
  expect(Object.keys(projectors.PROJECTORS)).toEqual(expect.arrayContaining([
    'cash_custody', 'shipment_freight', 'shipment_charges', 'shipment_customs',
  ]));
});

test('une allocation article de la même expédition interdit le double coût', async () => {
  const freight = { id: SID, reference: 'SHIP-KM', market_id: MID,
    amount_kmf: '1000', freight_invoice_ref: 'FREIGHT-1',
    occurred_at: '2026-11-03T11:00:00Z' };
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [freight] })
    .mockResolvedValueOnce({ rows: [{ shipment_id: SID, n: 1 }] }) };
  await expect(projectors.projectShipmentFreight(client)).rejects
    .toMatchObject({ code: 'JOURNAL_SHIPMENT_ITEM_ALLOCATION_CONFLICT' });
  expect(journal.recordMovement).not.toHaveBeenCalled();
});

test('la garde en EUR ne gonfle pas le total économique du journal', async () => {
  const reporting = require('../../services/financial-journal-reporting');
  const client = clientFor([
    { direction: 'inflow', category:'sale', state:'settled', currency:'EUR',
      movements:1, native_total:'10', eur_total:'10', eur_unavailable:0 },
    { direction:'custody', category:'cash_custody_transfer', state:'observed',
      currency:'EUR', movements:2, native_total:'20', eur_total:'20', eur_unavailable:0 },
  ]);
  const out = await reporting.summarize(client);
  expect(out.eur_total_known).toBe(10);
  expect(out.rows).toHaveLength(2);
});

test('un transfert mal projeté est détecté par le rapprochement, même avec le bon nombre de lignes', async () => {
  const reporting = require('../../services/financial-journal-reporting');
  const client = { query: jest.fn(async sql => {
    if (sql.includes('AS journal_count') && sql.includes('cash_custody_movements')) {
      return { rows: [{ journal_count:2, source_count:2, journal_abs:'5000', source_abs:'5000',
        journal_signed:'100', source_signed:'0' }] };
    }
    if (sql.includes('AS n FROM financial_movements')) return { rows: [{ n:0 }] };
    return { rows: [{ journal_kmf:'0', source_kmf:'0', journal_native:'0', source_native:'0' }] };
  }) };
  const result = await reporting.reconcileWithSources(client, {});
  expect(result.ok).toBe(false);
  expect(result.checks.find(c => c.name === 'custody_event_count').ok).toBe(true);
  expect(result.checks.find(c => c.name === 'custody_abs_kmf').ok).toBe(true);
  expect(result.checks.find(c => c.name === 'custody_signed_kmf').ok).toBe(false);
});

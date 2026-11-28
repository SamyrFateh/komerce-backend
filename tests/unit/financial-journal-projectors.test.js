'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../services/financial-journal',()=>({recordMovement:jest.fn()}));
const journal=require('../../services/financial-journal');
const {projectSupplierSettlements}=require('../../services/financial-journal-projectors');
beforeEach(()=>journal.recordMovement.mockReset().mockResolvedValue({outcome:'created'}));
test('B4 preserves actual debit and fee, obligation currency and historical FX; legacy is unchanged',async()=>{
  const common={kind:'payment',amount_currency:'100.0000',currency:'USD',amount_kmf:'40000.00',fees_kmf:'100.00',purchase_order_id:'po',market_id:'market',supplier_id:'supplier',proof_ref:'BANK',recorded_at:'2026-01-02T00:00:00Z'};
  const debitAt='2026-01-01T10:00:00Z';
  const debitEur={amount:'90.00',legs:[{id:'quote'}],as_of:debitAt};
  const feeEur={amount:'2.00',legs:[],as_of:debitAt};
  const rows=[{...common,id:'new',debit_amount:'367.25',debit_currency:'AED',fee_amount:'2',fee_currency:'EUR',debit_at:debitAt,debit_fx_snapshot:{debit:{eur:debitEur},fees:{eur:feeEur}}},{...common,id:'legacy'}];
  const client={query:jest.fn().mockResolvedValue({rows})};
  const result=await projectSupplierSettlements(client,{marketId:'market'});
  expect(result).toMatchObject({created:4,read:4,conflicts:[]});
  const entries=journal.recordMovement.mock.calls.map(([,row])=>row);
  expect(entries.find(x=>x.sourceId==='new'&&!x.facet)).toMatchObject({amountNative:'367.25',currency:'AED',occurredAt:debitAt,eur:debitEur,provenance:{obligation_amount:'100.0000',obligation_currency:'USD'}});
  expect(entries.find(x=>x.sourceId==='new'&&x.facet==='fees')).toMatchObject({amountNative:'2',currency:'EUR',occurredAt:debitAt,eur:feeEur});
  expect(entries.find(x=>x.sourceId==='legacy'&&!x.facet)).toMatchObject({amountNative:'100.0000',currency:'USD',occurredAt:common.recorded_at});
  expect(entries.find(x=>x.sourceId==='legacy'&&x.facet==='fees')).toMatchObject({amountNative:'100.00',currency:'KMF'});
  expect(client.query.mock.calls[0][0]).toContain("s.id::text||':fees'");
  expect(client.query.mock.calls[0][1]).toEqual(['market']);
});

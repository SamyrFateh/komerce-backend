'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {gatherPurchaseOrders,attachPaymentEvidence,getAdministrationBoard} =
  require('../../services/hub-administration-board');

const m=(code,id)=>({id,code,name:code});
const po=(id,stage,orderId,extra={})=>({
  id,stage,status:stage==='draft'?'draft':'notified',supplier_name:'Alpha',
  sent_at:stage==='draft'?null:'2026-11-03T09:00:00Z',
  lines:[{line_id:extra.lineId||'line-1',order_id:orderId,ordered:3,confirmed:3,received:1,anomaly:0}],
  ...extra,
});
describe('Administration centrale Hub : PO réellement consolidées',()=>{
  test('une PO couvre plusieurs commandes sans duplication, et le marché est une propriété du dossier',()=>{
    const payload=[{market:m('KM','market-km'),payload:{purchase_orders:[
      { ...po('PO1','sent','order-1'),lines:[
        {line_id:'line-1',order_id:'order-1',confirmed:2,received:1},
        {line_id:'line-2',order_id:'order-2',confirmed:1,received:1},
      ]},
    ]}}];
    const rows=gatherPurchaseOrders(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({id:'PO1',market:'KM',order_count:2,expected:3,received:2,
      commitment_authorization:'Non tracée',payment_authorization:'Non tracée'});
    expect(JSON.stringify(rows)).not.toContain('product_name');
  });

  test('une PO historique commune à deux marchés reste signalée sans réaffectation silencieuse',()=>{
    const rows=gatherPurchaseOrders([
      {market:m('KM','market-km'),payload:{purchase_orders:[po('PO1','sent','a')]}},
      {market:m('CM','market-cm'),payload:{purchase_orders:[po('PO1','sent','b',{lineId:'line-2'})]}},
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].market).toBe('CM · KM');
    expect(rows[0].multi_market_legacy).toBe(true);
    expect(rows[0].order_count).toBe(2);
  });

  test('aucune autorisation fournisseur n’est inférée de la preuve de débit',()=>{
    const list=gatherPurchaseOrders([{market:m('KM','km'),payload:{purchase_orders:[po('PO1','sent','a')]}}]);
    const paid=attachPaymentEvidence(list,[
      {purchase_order_id:'PO1',payment_count:2,verified_debit_count:1},
    ]);
    expect(paid[0].payment_evidence).toBe('Débit partiellement vérifié');
    expect(paid[0].payment_authorization).toBe('Non tracée');
    const full=attachPaymentEvidence(list,[
      {purchase_order_id:'PO1',payment_count:1,verified_debit_count:1},
    ]);
    expect(full[0].payment_evidence).toBe('Débit constaté');
    expect(full[0].payment_authorization).toBe('Non tracée');
  });

  test('balaye tous les marchés et une seule lecture groupée des preuves fournisseur',async()=>{
    const query={query:jest.fn(async(sql,args)=>{
      if(sql.includes('FROM markets'))return {rows:[m('KM','km'),m('CM','cm')]};
      if(sql.includes('FROM supplier_execution_payments')){
        expect(args).toEqual([['PO1','PO2']]);
        return {rows:[{purchase_order_id:'PO2',payment_count:1,verified_debit_count:0}]};
      }
      throw Error('SQL inattendu');
    })};
    const dossierReader=jest.fn(async marketId=>({purchase_orders:[
      po(marketId==='km'?'PO1':'PO2','draft','order-'+marketId,{lineId:'line-'+marketId}),
    ]}));
    const payload=await getAdministrationBoard(query,dossierReader);
    expect(payload.scope).toBe('HUB_ADMINISTRATION_GLOBAL');
    expect(payload.markets).toEqual(['KM','CM']);
    expect(payload.purchase_orders).toHaveLength(2);
    expect(payload.kpis).toMatchObject({purchase_orders:2,drafts:2,payment_to_reconcile:1});
    expect(dossierReader.mock.calls).toEqual([['km'],['cm']]);
  });

  test('aucune PO : aucune requête financière inutile',async()=>{
    const q={query:jest.fn(async()=>({rows:[m('KM','km')]}))};
    const result=await getAdministrationBoard(q,async()=>({purchase_orders:[]}));
    expect(result.purchase_orders).toEqual([]);
    expect(q.query).toHaveBeenCalledTimes(1);
  });
});
'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {gatherPurchaseOrders,attachPaymentEvidence,attachAuthorizations,getAdministrationBoard} =
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
      commitment_authorization:'À valider',payment_authorization:'À autoriser'});
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
    expect(paid[0].payment_authorization).toBe('À autoriser');
    const full=attachPaymentEvidence(list,[
      {purchase_order_id:'PO1',payment_count:1,verified_debit_count:1},
    ]);
    expect(full[0].payment_evidence).toBe('Débit constaté');
    expect(full[0].payment_authorization).toBe('À autoriser');
  });

  test('balaye tous les marchés et une seule lecture groupée des preuves fournisseur',async()=>{
    const query={query:jest.fn(async(sql,args)=>{
      if(sql.includes('FROM markets'))return {rows:[m('KM','km'),m('CM','cm')]};
      if(sql.includes('FROM purchase_order_authorizations'))return {rows:[]};
      if(sql.includes('FROM hub_authorization_grants'))return {rows:[]};
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
describe('Décisions de la directrice (P04)',()=>{
  const base=gatherPurchaseOrders([{market:m('KM','km'),payload:{purchase_orders:[po('PO1','sent','a')]}}]);
  test('sans décision : à valider ; le paiement attend l’engagement',()=>{
    const [row]=attachAuthorizations(base,[]);
    expect(row).toMatchObject({commitment_authorization:'À valider',payment_authorization:'Après engagement',commitment_decision:null,payment_decision:null});
  });
  test('engagement puis paiement : deux décisions distinctes, tracées',()=>{
    const [row]=attachAuthorizations(base,[
      {purchase_order_id:'PO1',authorization_type:'purchase_commitment',decided_by:'u1',decided_by_name:'Directrice',decided_at:'2026-11-03T10:00:00Z',amount:'30.0000',currency:'AED',proof_ref:'BC-1'},
    ]);
    expect(row.commitment_authorization).toBe('Validé · 2026-11-03');
    expect(row.commitment_decision).toMatchObject({decided_by_name:'Directrice',amount:30,currency:'AED',proof_ref:'BC-1'});
    expect(row.payment_authorization).toBe('À autoriser');
    const [both]=attachAuthorizations(base,[
      {purchase_order_id:'PO1',authorization_type:'purchase_commitment',decided_by:'u1',decided_at:'2026-11-03T10:00:00Z',amount:'30',currency:'AED',proof_ref:'BC-1'},
      {purchase_order_id:'PO1',authorization_type:'supplier_payment',decided_by:'u1',decided_at:'2026-11-04T10:00:00Z',amount:'30',currency:'AED',proof_ref:'VIR-1'},
    ]);
    expect(both.payment_authorization).toBe('Autorisé · 2026-11-04');
  });
  test('droits du lecteur projetés depuis les grants actifs uniquement',async()=>{
    const q={query:jest.fn(async sql=>{
      if(sql.includes('FROM markets'))return {rows:[m('KM','km')]};
      if(sql.includes('FROM purchase_order_authorizations'))return {rows:[]};
      if(sql.includes('FROM hub_authorization_grants')){expect(sql).toContain('revoked_at IS NULL');return {rows:[{authorization_type:'purchase_commitment'}]};}
      return {rows:[]};
    })};
    const out=await getAdministrationBoard(q,async()=>({purchase_orders:[po('PO1','draft','a')]}),'viewer-1');
    expect(out.viewer_grants).toEqual({purchase_commitment:true,supplier_payment:false});
    expect(out.approval_trace_available).toBe(true);
  });
});

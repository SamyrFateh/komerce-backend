'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../services/parcel-operations',()=>({transitionParcelStatus:jest.fn(async()=>({ok:true}))}));
const {transitionParcelStatus}=require('../../services/parcel-operations');
const {markFullyHandedOverParcelsShipped}=require('../../services/parcel-shipment-handover');
const id='00000000-0000-4000-8000-000000000001';
const actor={id};
beforeEach(()=>transitionParcelStatus.mockReset().mockResolvedValue({ok:true}));
test('remise physique : colis entièrement expédié change de statut via writer canonique, une preuve',async()=>{
  const client={query:jest.fn().mockResolvedValueOnce({rows:[{id,reference:'PCL-001',status:'preparation',expected_qty:2,shipped_qty:2}]})
    .mockResolvedValueOnce({rows:[]})};
  const result=await markFullyHandedOverParcelsShipped(client,id,actor,'PROOF-001');
  expect(result.parcels_marked_shipped).toEqual(['PCL-001']);
  expect(transitionParcelStatus).toHaveBeenCalledWith(client,id,'shipped');
  expect(client.query.mock.calls[1][0]).toContain('INSERT INTO parcel_events');
  expect(JSON.parse(client.query.mock.calls[1][1][3]).source).toBe('international_shipment_handover');
});
test('rejeu : déjà shipped ne réécrit ni event ni statut',async()=>{
  const client={query:jest.fn().mockResolvedValueOnce({rows:[{id,reference:'PCL-001',status:'shipped',expected_qty:2,shipped_qty:2}]})};
  expect((await markFullyHandedOverParcelsShipped(client,id,actor,'PROOF-001')).parcels_marked_shipped).toEqual([]);
  expect(transitionParcelStatus).not.toHaveBeenCalled();
  expect(client.query).toHaveBeenCalledTimes(1);
});
test('colis partiel non entièrement parti reste en préparation, aucune expédition inventée',async()=>{
  const client={query:jest.fn().mockResolvedValueOnce({rows:[]})};
  expect((await markFullyHandedOverParcelsShipped(client,id,actor,'PROOF-001')).parcels_marked_shipped).toEqual([]);
  expect(client.query.mock.calls[0][0]).toContain('SUM(pi.qty_shipped)=SUM(pi.quantity)');
  expect(transitionParcelStatus).not.toHaveBeenCalled();
});
test('garde incident/bloqueur renvoyée par le writer et aucune preuve fausse',async()=>{
  transitionParcelStatus.mockResolvedValueOnce({ok:false,status:409,body:{error:'incident Hub actif'}});
  const client={query:jest.fn().mockResolvedValueOnce({rows:[{id,reference:'PCL-001',status:'preparation',expected_qty:2,shipped_qty:2}]})};
  await expect(markFullyHandedOverParcelsShipped(client,id,actor,'PROOF-001'))
    .rejects.toMatchObject({code:'HANDOVER_PARCEL_TRANSITION_REFUSED',status:409});
  expect(client.query).toHaveBeenCalledTimes(1);
});
test('aucune écriture sans preuve et acteur',async()=>{
  const client={query:jest.fn()};
  await expect(markFullyHandedOverParcelsShipped(client,id,{},'PROOF-001'))
    .rejects.toMatchObject({code:'HANDOVER_PARCEL_PROOF_REQUIRED'});
  expect(client.query).not.toHaveBeenCalled();
});

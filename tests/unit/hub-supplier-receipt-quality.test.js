'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../services/hub-physical-identity',()=>({receiveSupplierPackage:jest.fn(),transitionPhysicalUnit:jest.fn()}));
jest.mock('../../services/hub-reception-quality-plan',()=>({lockReceptionQualityPlan:jest.fn()}));
const physical=require('../../services/hub-physical-identity');
const {lockReceptionQualityPlan}=require('../../services/hub-reception-quality-plan');
const {observeSupplierReceipt,attestSupplierReturn,listSupplierReceiptChecks}=require('../../services/hub-supplier-receipt-quality');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const args={purchaseOrderId:id(1),marketId:id(2),actorId:id(3),reference:'QUALITY-1',physicalConfirmed:true,
 observations:[{product_sku_id:id(4),received_quantity:4,rejected_quantity:1,quantity_confirmed:true,evidence_method:'SCAN',evidence_code:'SKU-1'}]};
const plan={lines:[{product_sku_id:id(4),expected_quantity:5,received_quantity:4,rejected_quantity:1,conforming_quantity:3,missing_quantity:1}]};
function executor(...rows){const query=jest.fn();for(const result of rows)query.mockResolvedValueOnce({rows:result});return {query};}
beforeEach(()=>{jest.resetAllMocks();lockReceptionQualityPlan.mockResolvedValue(plan);physical.receiveSupplierPackage.mockResolvedValue({unit:{id:id(5)},allocations:[]});physical.transitionPhysicalUnit.mockResolvedValue({});});
test('5 attendus, 4 reçus, 1 refusé : seuls 3 conformes atteignent le writer',async()=>{
 const client=executor([],[],[{id:id(6)}],[]);
 const result=await observeSupplierReceipt(client,args);
 expect(physical.receiveSupplierPackage).toHaveBeenCalledWith(client,expect.objectContaining({contents:[{purchase_order_id:id(1),product_sku_id:id(4),quantity:3,evidence_code:'SKU-1'}]}));
 expect(physical.transitionPhysicalUnit.mock.calls.map(([,x])=>x.toState)).toEqual(['IDENTIFIED','QUALITY_CHECKED']);
 expect(client.query.mock.calls[3][1]).toEqual([id(6),id(4),5,4,1]);
 expect(result.replayed).toBe(false);
});
test('tout refusé : journal uniquement, jamais de stock client ni transition qualité',async()=>{
 lockReceptionQualityPlan.mockResolvedValue({lines:[{...plan.lines[0],rejected_quantity:4,conforming_quantity:0}]});
 const client=executor([],[],[{id:id(6)}],[]);
 await observeSupplierReceipt(client,{...args,observations:[{...args.observations[0],rejected_quantity:4}]});
 expect(physical.receiveSupplierPackage).not.toHaveBeenCalled();
 expect(physical.transitionPhysicalUnit).not.toHaveBeenCalled();
 expect(client.query.mock.calls[2][1][5]).toBeNull();
});
test('writer canonique refuse ou met en quarantaine : pas de constat validé',async()=>{
 physical.receiveSupplierPackage.mockResolvedValue({quarantined:true});
 const client=executor([],[]);
 await expect(observeSupplierReceipt(client,args)).rejects.toThrow('HUB_QUALITY_CONFORMING_RECEIPT_REFUSED');
 expect(client.query).toHaveBeenCalledTimes(2);
 expect(physical.transitionPhysicalUnit).not.toHaveBeenCalled();
});
test('absence de confirmation ou preuve physique : pas de writer',async()=>{
 await expect(observeSupplierReceipt(executor(),{...args,physicalConfirmed:false})).rejects.toThrow('HUB_QUALITY_PHYSICAL_CONFIRMATION_REQUIRED');
 await expect(observeSupplierReceipt(executor([],[]),{...args,observations:[{...args.observations[0],evidence_code:null}]})).rejects.toThrow('HUB_QUALITY_PHYSICAL_EVIDENCE_REQUIRED');
 expect(physical.receiveSupplierPackage).not.toHaveBeenCalled();
});
test('retour partiel réel, indépendant du stock et du financier',async()=>{
 const client=executor([],[{id:id(7),rejected_quantity:3}],[],[{returned:1}],[{id:id(8)}]);
 const result=await attestSupplierReturn(client,{checkLineId:id(7),marketId:id(2),actorId:id(3),reference:'RETURN-1',quantity:2,physicalConfirmed:true});
 expect(result.attestation.id).toBe(id(8));
 expect(physical.receiveSupplierPackage).not.toHaveBeenCalled();
 expect(client.query.mock.calls[4][1]).toEqual(['RETURN-1',id(7),2,id(3)]);
});
test('retour excédentaire et scope étranger refusés avant écriture',async()=>{
 const data={checkLineId:id(7),marketId:id(2),actorId:id(3),reference:'RETURN-2',quantity:2,physicalConfirmed:true};
 const client=executor([],[{id:id(7),rejected_quantity:3}],[],[{returned:2}]);
 await expect(attestSupplierReturn(client,data)).rejects.toThrow('HUB_SUPPLIER_RETURN_EXCEEDS_REJECTED');
 expect(client.query).toHaveBeenCalledTimes(4);
 await expect(attestSupplierReturn(executor([],[]),data)).rejects.toThrow('HUB_SUPPLIER_RETURN_SCOPE');
});

test('projection des retours : lecture limitée à la PO et au marché',async()=>{
 const client=executor([{id:id(1),order_id:null}],[{line_id:id(7),rejected_quantity:3,returned_quantity:1,to_return_quantity:2}]);
 const result=await listSupplierReceiptChecks(client,{purchaseOrderId:id(1),marketId:id(2)});
 expect(result).toEqual({eligible:true,checks:[{line_id:id(7),rejected_quantity:3,returned_quantity:1,to_return_quantity:2}]});
 expect(client.query.mock.calls[1][1]).toEqual([id(1),id(2)]);
 expect(client.query.mock.calls[1][0]).toContain('c.purchase_order_id=$1 AND c.market_id=$2');
 await expect(listSupplierReceiptChecks(executor([]),{purchaseOrderId:id(1),marketId:id(2)})).rejects.toThrow('HUB_QUALITY_PO_SCOPE');
});
test('retour rejoué : aucune seconde insertion',async()=>{
 const prior={id:id(8),check_line_id:id(7),quantity:1};
 const client=executor([],[{id:id(7),rejected_quantity:3}],[prior]);
 const result=await attestSupplierReturn(client,{checkLineId:id(7),marketId:id(2),actorId:id(3),reference:'RETURN-1',quantity:1,physicalConfirmed:true});
 expect(result).toEqual({attestation:prior,replayed:true});
 expect(client.query).toHaveBeenCalledTimes(3);
});

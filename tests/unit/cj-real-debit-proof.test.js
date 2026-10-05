'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
jest.mock('../../services/suppliers/connectors/cj-connector',()=>({
  BASE_URL:'https://developers.cjdropshipping.com/api2.0/v1',
  getAccessToken:jest.fn(async()=> 'token'),
}));

const contract=require('../../services/suppliers/cj-purchasing-contract');
const proof=require('../../scripts/cj-real-debit-proof');

const envBase={
  KOMERCE_ALLOW_CJ_REAL_DEBIT_PROOF:'1',
  KOMERCE_ALLOW_CJ_REAL_PAYMENT:'1',
  KOMERCE_CJ_REAL_MAX_USD:'20',
  KOMERCE_CJ_REAL_RECIPIENT_NAME:'Recipient',
  KOMERCE_CJ_REAL_RECIPIENT_PHONE:'+33600000000',
  KOMERCE_CJ_REAL_ADDRESS1:'7 rue Mirabeau',
  KOMERCE_CJ_REAL_POSTAL_CODE:'94230',
  KOMERCE_CJ_REAL_CITY:'Cachan',
  KOMERCE_CJ_REAL_PROVINCE:'Île-de-France',
  KOMERCE_CJ_REAL_COUNTRY:'France',
  KOMERCE_CJ_REAL_COUNTRY_CODE:'FR',
};

test('guard exige opt-in paiement réel et plafond borné',()=>{
  expect(()=>proof.guard({...envBase,KOMERCE_ALLOW_CJ_REAL_PAYMENT:'0'}))
    .toThrow('KOMERCE_ALLOW_CJ_REAL_PAYMENT=1 requis');
  expect(()=>proof.guard({...envBase,KOMERCE_CJ_REAL_MAX_USD:'21'}))
    .toThrow('CJ_REAL_MAX_USD_INVALID');
  expect(()=>proof.guard({...envBase,KOMERCE_CJ_SANDBOX:'1'}))
    .toThrow('CJ_REAL_PROOF_SANDBOX_FORBIDDEN');
});

test('destination vient uniquement des variables explicites',()=>{
  expect(proof.destination(envBase)).toEqual({
    customer_name:'Recipient',
    phone:'+33600000000',
    address1:'7 rue Mirabeau',
    postal_code:'94230',
    city:'Cachan',
    province:'Île-de-France',
    country:'France',
    country_code:'FR',
  });
});

test('cheapestRoute prend la route valide la moins chère',()=>{
  expect(proof.cheapestRoute({data:[
    {logisticName:'A',logisticPrice:9},
    {logisticName:'B',logisticPrice:3},
  ]})).toEqual({logisticName:'B',logisticPrice:3});
});

test('cap dépassé arrête avant confirm et payBalanceV2',async()=>{
  const sku={
    product_ref:'KPR-X',
    product_sku_id:'sku-1',
    supplier_order_identity:{
      provider:'cj',
      version:1,
      payload:{pid:'P',vid:'V',variant_sku:'S'},
    },
  };

  const calls=[];
  const invoke=jest.fn(async(path,args)=>{
    calls.push(path);
    if(path===contract.ENDPOINTS.freight_calculate){
      return {result:true,data:[{logisticName:'Cheap',logisticPrice:2}]};
    }
    if(path===contract.ENDPOINTS.create_order_v2){
      expect(args.body.isSandbox).toBeUndefined();
      expect(args.body.iossType).toBe(3);
      return {result:true,data:{
        orderId:'CJ-1',
        orderNumber:'KOM-REAL-1',
        productAmount:5,
        postageAmount:2,
        actualPayment:7,
        iossAmount:0,
        iossTaxHandlingFee:0,
        actualPayment:21,
        iossAmount:12,
        iossTaxHandlingFee:2,
      }};
    }
    if(path===contract.ENDPOINTS.get_order_detail){
      return {result:true,data:{
        orderId:'CJ-1',
        orderNumber:'KOM-REAL-1',
        orderStatus:'CREATED',
        productList:[{vid:'V',quantity:1}],
      }};
    }
    throw new Error('unexpected:'+path);
  });

  await expect(proof.run({
    ...envBase,
    KOMERCE_CJ_REAL_ORDER_NUMBER:'KOM-REAL-1',
    KOMERCE_CJ_REAL_PRODUCT_REF:'KPR-X',
  },{
    selectExactSku:async()=>sku,
    invoke,
  })).rejects.toThrow('CJ_REAL_DEBIT_CAP_EXCEEDED');

  expect(calls).not.toContain(contract.ENDPOINTS.confirm_order);
  expect(calls).not.toContain(contract.ENDPOINTS.pay_balance_v2);
});

test('succès appelle payBalanceV2 exactement une fois puis billingHistory',async()=>{
  const sku={
    product_ref:'KPR-X',
    product_sku_id:'sku-1',
    supplier_order_identity:{
      provider:'cj',
      version:1,
      payload:{pid:'P',vid:'V',variant_sku:'S'},
    },
  };

  let detailCount=0;
  const invoke=jest.fn(async(path,args)=>{
    if(path===contract.ENDPOINTS.freight_calculate){
      return {result:true,data:[{logisticName:'Cheap',logisticPrice:2}]};
    }
    if(path===contract.ENDPOINTS.create_order_v2){
      expect(args.body.isSandbox).toBeUndefined();
      return {result:true,data:{
        orderId:'CJ-1',
        orderNumber:'KOM-REAL-1',
        productAmount:5,
        postageAmount:2,
      }};
    }
    if(path===contract.ENDPOINTS.get_order_detail){
      detailCount+=1;
      if(detailCount===1){
        return {result:true,data:{
          orderId:'CJ-1',
          orderNumber:'KOM-REAL-1',
          orderStatus:'CREATED',
          productList:[{vid:'V',quantity:1}],
        }};
      }
      if(detailCount===2){
        return {result:true,data:{
          orderId:'CJ-1',
          orderNumber:'KOM-REAL-1',
          shipmentOrderId:'SHIP-1',
          orderStatus:'UNPAID',
          productList:[{vid:'V',quantity:1}],
        }};
      }
      return {result:true,data:{
        orderId:'CJ-1',
        orderNumber:'KOM-REAL-1',
        shipmentOrderId:'SHIP-1',
        orderStatus:'UNSHIPPED',
        productList:[{vid:'V',quantity:1}],
      }};
    }
    if(path===contract.ENDPOINTS.confirm_order){
      return {result:true,data:'CJ-1'};
    }
    if(path===contract.ENDPOINTS.pay_balance_v2){
      return {result:true,data:true};
    }
    if(path===contract.ENDPOINTS.billing_history){
      return {result:true,data:{list:[{
        id:'BILL-1',
        cjOrderId:'CJ-1',
        typeDesc:'Order Payment',
        paymentTypeDesc:'Balance',
        status:'1',
        copeMoney:7,
        amount:'-$7.00',
      }]}};
    }
    throw new Error('unexpected:'+path);
  });

  const out=await proof.run({
    ...envBase,
    KOMERCE_CJ_REAL_ORDER_NUMBER:'KOM-REAL-1',
    KOMERCE_CJ_REAL_PRODUCT_REF:'KPR-X',
  },{
    selectExactSku:async()=>sku,
    invoke,
  });

  expect(invoke.mock.calls.filter(([p])=>p===contract.ENDPOINTS.pay_balance_v2)).toHaveLength(1);
  expect(out).toMatchObject({
    sandbox:false,
    expected_total:7,
    hard_cap_usd:20,
    payment_verdict:'paid',
    billing_evidence_verified:true,
  });
});

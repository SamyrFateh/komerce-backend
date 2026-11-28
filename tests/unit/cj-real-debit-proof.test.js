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

test('B4 : preuve directe historique refusée avant toute requête fournisseur ou lecture SKU, même avec les flags', async () => {
  const invoke=jest.fn();
  const selectExactSku=jest.fn();
  await expect(proof.run(envBase,{invoke,selectExactSku})).rejects.toThrow('FINANCE_B4_AUTHENTICATED_EXECUTION_REQUIRED');
  expect(invoke).not.toHaveBeenCalled();
  expect(selectExactSku).not.toHaveBeenCalled();
  expect(require('../../services/suppliers/connectors/cj-connector').getAccessToken).not.toHaveBeenCalled();
});

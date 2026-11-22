/** @komerce-arch-lite
 * @role g6-m06-operator-supplied-manual-purchase-input
 * @domain purchasing
 * @layer script
 * @owner backend-core
 * @purpose Validate operator-supplied real seller allocations for the M06 manual purchase Chromium stage; never invent purchase data.
 * @impact-areas staging-only
 */
'use strict';

const CHANNELS=new Set(['in_person','phone','whatsapp','email','other']);
const text=(v)=>typeof v==='string'?v.trim():'';
const fail=(code)=>{throw Error(code)};

function parseM06ManualPurchaseCapture(raw,{orderQuantity=3,commitmentAmount=30,currency='EUR'}={}){
 let input;
 try{input=typeof raw==='string'?JSON.parse(raw):raw}catch(_){fail('G6_M06_PURCHASE_CAPTURE_INVALID_JSON')}
 if(!input||typeof input!=='object'||Array.isArray(input))fail('G6_M06_PURCHASE_CAPTURE_REQUIRED');
 const purchaseProof=text(input.purchase_proof_ref);
 const varianceReason=text(input.variance_reason);
 if(purchaseProof.length<4)fail('G6_M06_PURCHASE_PROOF_REQUIRED');
 if(!Array.isArray(input.allocations)||input.allocations.length<2)fail('G6_M06_MULTI_SELLER_ALLOCATIONS_REQUIRED');
 const expectedCurrency=String(currency).toUpperCase();
 if(!/^[A-Z]{3}$/.test(expectedCurrency)||!Number.isSafeInteger(orderQuantity)||orderQuantity<1||
    !Number.isFinite(commitmentAmount)||commitmentAmount<=0)fail('G6_M06_CAPTURE_CONTRACT_INVALID');
 const allocations=input.allocations.map((entry)=>{
  const seller=text(entry?.seller_label),channel=text(entry?.channel),proof=text(entry?.proof_ref);
  const quantity=Number(entry?.quantity),amount=Number(entry?.amount),cur=text(entry?.currency).toUpperCase();
  if(seller.length<2||seller.toLowerCase()==='fournisseur central hub'||
     !CHANNELS.has(channel)||!Number.isSafeInteger(quantity)||quantity<1||
     !Number.isFinite(amount)||amount<=0||!/^[A-Z]{3}$/.test(cur)||cur!==expectedCurrency||proof.length<4)
   fail('G6_M06_PURCHASE_ALLOCATION_INVALID');
  return Object.freeze({seller_label:seller,channel,quantity,amount,currency:cur,proof_ref:proof});
 });
 if(new Set(allocations.map(a=>a.seller_label.toLocaleLowerCase())).size<2)
  fail('G6_M06_DISTINCT_SELLERS_REQUIRED');
 const allocated=allocations.reduce((n,a)=>n+a.quantity,0);
 if(allocated!==orderQuantity)fail('G6_M06_PURCHASE_QUANTITY_MISMATCH');
 const total=Number(allocations.reduce((n,a)=>n+a.amount,0).toFixed(4));
 if(!(total>0)||total>commitmentAmount+0.0001)fail('G6_M06_PURCHASE_EXCEEDS_COMMITMENT');
 const confirmedUnitPrice=Number((total/orderQuantity).toFixed(4));
 const confirmedTotal=Number((confirmedUnitPrice*orderQuantity).toFixed(4));
 const variance=Math.abs(confirmedTotal-total)>0.0001;
 if(variance&&!varianceReason)fail('G6_M06_PURCHASE_VARIANCE_REASON_REQUIRED');
 return Object.freeze({purchase_proof_ref:purchaseProof,allocations:Object.freeze(allocations),
  confirmed_quantity:orderQuantity,confirmed_unit_price:confirmedUnitPrice,
  confirmed_currency:expectedCurrency,justified_total:total,
  ...(variance?{variance_reason:varianceReason}:{}),source:'OPERATOR_SUPPLIED_CAPTURE'});
}

function captureFromEnv(env=process.env,options={}){
 if(!text(env.G6_M06_ACTUAL_PURCHASE_CAPTURE))fail('G6_M06_PURCHASE_CAPTURE_REQUIRED');
 return parseM06ManualPurchaseCapture(env.G6_M06_ACTUAL_PURCHASE_CAPTURE,options);
}

module.exports={parseM06ManualPurchaseCapture,captureFromEnv};

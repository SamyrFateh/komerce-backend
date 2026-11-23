#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-m06-operator-input-preflight
 * @domain purchasing
 * @layer script
 * @owner backend-core
 * @purpose Validate all operator-supplied M06 facts before the staging workflow creates a buyer order.
 * @impact-areas staging-only
 * @db-read none
 * @db-write none
 */
'use strict';

const {captureFromEnv}=require('./canonical/m06-manual-purchase-capture');
const {loadManifest}=require('./canonical/manifest-loader');
const env=process.env;
const check=(ok,code)=>{if(!ok)throw Error(code)};
const ref=(name,min,max,input=env)=>{
 const value=String(input[name]||'').trim();
 check(value.length>=min&&value.length<=max,'G6_M06_INPUT_'+name+'_INVALID');
 return value;
};

function validateM06OperatorInputs(input=env){
 const plan=loadManifest('M06').fixture_plan;
 const capture=captureFromEnv(input,{orderQuantity:plan.buyer_order.quantity,
  commitmentAmount:plan.commitment.amount,currency:plan.commitment.currency});
 ref('G6_M06_PAYMENT_AUTHORIZATION_PROOF',4,500,input);
 ref('G6_M06_RECEIPT_PROOF_REF',6,500,input);
 ref('G6_M06_COMBOX_PROOF_REF',6,500,input);
 ref('G6_M06_HANDOVER_PROOF_REF',6,500,input);
 ref('G6_M06_FORWARDER_NAME',2,160,input);
 const mode=String(input.G6_M06_TRANSPORT_MODE||'').trim().toLowerCase();
 check(['sea','air'].includes(mode),'G6_M06_INPUT_TRANSPORT_MODE_INVALID');
 return Object.freeze({scenario_id:'M06',market:'KM',quantity:3,
  allocation_count:capture.allocations.length,valid:true,values_redacted:true,
   evidence_class:capture.source,simulation_only:capture.simulation_only===true});
}

if(require.main===module){
 try{console.log(JSON.stringify(validateM06OperatorInputs()))}
 catch(error){console.error(error.message);process.exitCode=1}
}
module.exports={validateM06OperatorInputs};

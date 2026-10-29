'use strict';
/** Verify a same-run Jest report: real PayPal owner/client, fake transport only. */
const EXPECTED=Object.freeze([
 'actual live refund owner retries same operation with two different outgoing PSP keys',
 'actual PayPal client preserves exact durable key on two mocked failed provider attempts',
 'an invalid provider key is rejected before any HTTP call'
]);
function qualifyPayPalJest(j,meta){
 if(!j||!Array.isArray(j.testResults)||j.numFailedTests!==0||
  j.numPassedTests!==3||j.success!==true)throw Error('PayPal paired Jest run not green');
 if(!meta||!/^[0-9a-f]{40}$/.test(meta.sha||'')||
  !/^\d+$/.test(String(meta.runId||'')))throw Error('No CI run identity');
 const found=j.testResults.flatMap(s=>s.assertionResults||[]);
 for(const title of EXPECTED){
  const matches=found.filter(x=>x.title===title&&x.status==='passed');
  if(matches.length!==1)throw Error('Missing/duplicate observed PayPal proof test: '+title);
 }
 if(found.length!==3)throw Error('Unexpected tests in PayPal proof');
 return {contract:'komerce-business-owner-replay-evidence/v08',
  source:'SAME_CI_JEST_JSON_REPORT',runId:String(meta.runId),sha:meta.sha,
  owner:'Refunds / PayPal',
  nominal:{control:'DURABLE_REQUEST_KEY_REUSED_WITH_FAKE_HTTP',observed:'JEST_TEST_PASSED'},
  adversarial:{control:'LEGACY_OWNER_RETRY_USES_DIFFERENT_KEYS',observed:'JEST_TEST_PASSED'},
  negative:{control:'INVALID_KEY_REJECTED_BEFORE_FAKE_HTTP',observed:'JEST_TEST_PASSED'},
  testsPassed:3,businessOwnerInvokedInTest:true,
  provider:'MOCK_HTTP_NO_REAL_PSP',database:'MOCK_NO_REAL_REFUND',
  duplicateMoneyMovementProven:false,productionIncidentConfirmed:false,
  limits:['Jest passed assertions from actual owner/client modules; HTTP and ancillary writers were mocked',
   'Does not prove any provider accepted a refund or that production duplicated money']};
}
module.exports={qualifyPayPalJest,EXPECTED};

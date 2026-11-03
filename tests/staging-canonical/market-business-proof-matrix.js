'use strict';
/**
 * @komerce-arch-lite
 * @role staging-business-market-proof-matrix
 * @domain dashboard
 * @layer test-fixture
 * @owner backend-core
 * @purpose Market-specific certification contracts; NOT proof that any scenario passed.
 * @impact-areas market, finance, logistics, staging-only
 */
const M = Object.freeze({
  KM: Object.freeze({
    currency:'KMF', roleAccount:'KM', marketGroup:['KM'],
    paths:['IMPORT','LOCAL_STOCK','MIXED'],
    cases:['P01_SOURCE_TO_PUBLICATION','P02_PAID_IMPORT_TO_OPEN_PURCHASE_LINE','P03_MANUAL_PO_WITHOUT_SUPPLIER_API',
      'P04_DIRECTOR_COMMITMENT_AND_PAYMENT','P05_PARTIAL_RECEIPT_BOX_HANDOVER','P06_RELAY_PARTIAL_ATTESTATION_AND_PICKUP',
      'P07_BACKORDER_OR_ITEM_REFUND','P08_RELAY_CASH_CUSTODY_DEPOSIT','P09_JOURNAL_AND_N1_N2_N3'],
    assertions:['KM and diaspora EUR remain distinct native amounts with FX snapshot','LOCAL_STOCK never generates Hub PO',
      'MIXED order allows local pickup before imported completion','Anjouan/Moroni/Mohéli routing follows configured relay/transport contracts'],
  }),
  CM: Object.freeze({
    currency:'XAF',roleAccount:'CM_CG',marketGroup:['CM','CG'],paths:['IMPORT'],
    cases:['P01_SOURCE_TO_PUBLICATION','P02_PAID_IMPORT_TO_OPEN_PURCHASE_LINE','P03_MANUAL_PO_WITHOUT_SUPPLIER_API',
      'P04_DIRECTOR_COMMITMENT_AND_PAYMENT','P05_PARTIAL_RECEIPT_BOX_HANDOVER','P06_RELAY_PARTIAL_ATTESTATION_AND_PICKUP',
      'P07_BACKORDER_OR_ITEM_REFUND','P09_JOURNAL_AND_N1_N2_N3'],
    assertions:['CM and CG share XAF denomination but never share order, market pricing, PO or relay custody',
      'CM-local authorization cannot read DJ or KM ledgers'],
  }),
  CG: Object.freeze({
    currency:'XAF',roleAccount:'CM_CG',marketGroup:['CM','CG'],paths:['IMPORT'],
    cases:['P01_SOURCE_TO_PUBLICATION','P02_PAID_IMPORT_TO_OPEN_PURCHASE_LINE','P03_MANUAL_PO_WITHOUT_SUPPLIER_API',
      'P04_DIRECTOR_COMMITMENT_AND_PAYMENT','P05_PARTIAL_RECEIPT_BOX_HANDOVER','P06_RELAY_PARTIAL_ATTESTATION_AND_PICKUP',
      'P07_BACKORDER_OR_ITEM_REFUND','P09_JOURNAL_AND_N1_N2_N3'],
    assertions:['CG and CM have strictly separate market IDs, prices, PO, delivery and finance',
      'Cross-market quantities cannot be silently reassigned'],
  }),
  DJ: Object.freeze({
    currency:'DJF',roleAccount:'DJ',marketGroup:['DJ'],paths:['IMPORT'],
    cases:['P00_CANONICAL_PROVISIONING_TO_ACTIVE','P01_SOURCE_TO_PUBLICATION',
      'P02_PAID_IMPORT_TO_OPEN_PURCHASE_LINE','P03_MANUAL_PO_WITHOUT_SUPPLIER_API',
      'P04_DIRECTOR_COMMITMENT_AND_PAYMENT','P05_PARTIAL_RECEIPT_BOX_HANDOVER',
      'P06_RELAY_PARTIAL_ATTESTATION_AND_PICKUP','P07_BACKORDER_OR_ITEM_REFUND','P09_JOURNAL_AND_N1_N2_N3'],
    assertions:['DJ is ACTIVE only after provisioning readiness via admin API','No direct SQL lifecycle forcing',
      'DJF converted at the correct event snapshot, not today rate'],
  }),
  YT: Object.freeze({
    currency:'EUR',roleAccount:'YT',marketGroup:['YT'],paths:['IMPORT'],
    cases:['P01_SOURCE_TO_PUBLICATION','P02_PAID_IMPORT_TO_OPEN_PURCHASE_LINE','P03_MANUAL_PO_WITHOUT_SUPPLIER_API',
      'P04_DIRECTOR_COMMITMENT_AND_PAYMENT','P05_PARTIAL_RECEIPT_BOX_HANDOVER',
      'P06_RELAY_PARTIAL_ATTESTATION_AND_PICKUP','P07_BACKORDER_OR_ITEM_REFUND','P09_JOURNAL_AND_N1_N2_N3'],
    assertions:['Mayotte route and customs flow must be read from its configured rules, never copied from KM',
      'EUR-native transaction remains EUR and does not receive invented FX conversion'],
  }),
});
const MARKET_PROOFS=Object.freeze(M);
const CODES=Object.freeze(Object.keys(M));
const REQUIRED_EVIDENCE=Object.freeze([
 'canonical_api_request_reference','source_event_id','persisted_state','transition_actor',
 'quantities_and_market','physical_or_payment_proof','ui_chromium_result','finance_reconciliation',
]);
module.exports={MARKET_PROOFS,CODES,REQUIRED_EVIDENCE};

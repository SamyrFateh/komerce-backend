/** @komerce-arch
 * @role cj-four-exact-catalogue-handoff-readiness
 * @domain sourcing
 * @layer script
 * @criticality high
 * @inputs official staging PostgreSQL, original KIR-000014
 * @outputs bounded per-candidate verdicts without personal data
 * @depends services/sourcing-certification.js, services/catalog-candidate-product-service.js
 * @db-read import_runtime_runs, supplier_catalog_imports, sourcing_candidates, products, boutique_categories, boutique_subcategories
 * @db-write none
 * @db-txn read_only
 * @doctrine real_supplier_identities_exact_run_fail_closed_no_draft_promotion_no_publishing
 * @impact-areas staging, sourcing, catalog
 */
'use strict';
// Force read-only PostgreSQL before db.js creates any connections.
if (require.main === module) {
  process.env.PGOPTIONS = [process.env.PGOPTIONS, '-c default_transaction_read_only=on'].filter(Boolean).join(' ');
}
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const { evaluateSourcingCandidateOutcome } = require('../../services/sourcing-certification');
const { resolveCommercialTaxonomyVerdict } = require('../../services/catalog-candidate-product-service');
const RUN_REF = 'KIR-000014';
const OUT = path.resolve('test-results/cj-four-catalogue-readiness/report.json');
const EXPECTED = Object.freeze(new Map([
  ['KSC-000256', '4978336F-15C5-476B-BFE8-C907659B70BB'],
  ['KSC-000257', '1396999123722440704'],
  ['KSC-000258', '1410157074293329920'],
  ['KSC-000259', 'BE74E804-F8CB-4D8A-B84A-DE98494DC9FD'],
]));
function guard(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.KOMERCE_ENV !== 'staging' || env.NODE_ENV !== 'test'
    || env.STAGING_BASE_URL !== 'https://komerce-backend-production.up.railway.app'
    || env.CJ_FOUR_READONLY_APPROVED !== '1' || !env.DATABASE_URL) {
    throw Error('CJ_FOUR_READONLY_STAGING_GUARD_REQUIRED');
  }
}
const unitsOf = c => Array.isArray(c.normalized_source_contract?.sellable_units)
  ? c.normalized_source_contract.sellable_units : [];
async function audit() {
  guard(process.env);
  const target = await confirmTarget({ db });
  if (target.confirmed !== true) throw Error('STAGING_FINGERPRINT_NOT_CONFIRMED');
  const { rows: runs } = await db.query(
    'SELECT id, run_ref, provider, import_id, status, intake FROM import_runtime_runs WHERE run_ref=$1', [RUN_REF]);
  if (runs.length !== 1) throw Error('ORIGINAL_KIR_NOT_UNIQUE_OR_MISSING');
  const run = runs[0];
  const { rows: parents } = await db.query(
    'SELECT id, status FROM supplier_catalog_imports WHERE id=$1', [run.import_id]);
  const parent = parents[0] || null;
  const { rows: candidates } = await db.query(
    'SELECT * FROM sourcing_candidates WHERE import_id=$1 ORDER BY candidate_ref', [run.import_id]);
  const { rows: [count] } = await db.query('SELECT count(*)::int AS n FROM products');
  const blockers = [];
  if (String(run.provider).toLowerCase() !== 'cjdropshipping') blockers.push('PROVIDER_IDENTITY_CHANGED');
  if (run.intake?.pipeline_status !== 'CANONICAL_RESOLVED') blockers.push('SOURCE_PIPELINE_NOT_CANONICAL');
  if (!parent || !['COMPLETED','COMPLETED_WITH_QUARANTINE'].includes(parent.status))
    blockers.push('SOURCE_PARENT_IMPORT_NOT_PROMOTABLE');
  if (Number(count.n) !== 0) blockers.push('CATALOGUE_NO_LONGER_EMPTY');
  if (candidates.length !== 4) blockers.push('EXPECTED_EXACTLY_FOUR_SOURCE_CANDIDATES');
  const rows = [];
  for (const c of candidates) {
    const taxonomy = await resolveCommercialTaxonomyVerdict(db, c);
    const certification = evaluateSourcingCandidateOutcome(c);
    const units = unitsOf(c);
    const skuOrderable = units.filter(u => u && (u.supplier_order_identity || u.supplier_unit_ref || u.supplier_sku)).length;
    const reasons = [...certification.reasons];
    // Exact exception owned by sourcing-candidate-actions.handoffCertifiedImport():
    // a WATCH caused exclusively by unresolved Komerce category may create an
    // INACTIVE draft once the canonical boutique taxonomy resolves. This is
    // NOT sourcing certification, customs approval or publication approval.
    const classificationOnlyWatch = !certification.sourcing_certified
      && certification.decision === 'WATCH'
      && String(c.scan_result?.reason || '').startsWith('Catégorie Komerce non résolue')
      && String(c.normalized_source_contract?.schema_version) === '2'
      && taxonomy.status === 'AUTO_CLASSIFIED'
      && Boolean(taxonomy.category && taxonomy.subcategory);
    if (EXPECTED.get(c.candidate_ref) !== c.supplier_product_id)
      reasons.push('ORIGINAL_SUPPLIER_IDENTITY_DRIFT');
    if (c.product_id) reasons.push('ALREADY_LINKED_TO_PRODUCT');
    if (!certification.sourcing_certified && !classificationOnlyWatch) reasons.push('NOT_SOURCE_CERTIFIED');
    if (!['AUTO_CLASSIFIED','EXPLICIT_REVIEW'].includes(taxonomy.status)
      || !taxonomy.category || !taxonomy.subcategory) reasons.push('COMMERCIAL_TAXONOMY_NOT_RESOLVED');
    const ready = reasons.length === 0;
    if (!ready) blockers.push(c.candidate_ref + ':' + [...new Set(reasons)].join(','));
    rows.push({
      candidate_ref:c.candidate_ref, supplier_product_id:c.supplier_product_id,
      state:c.state, sourcing_decision:certification.decision, sourcing_outcome:certification.outcome,
      certified:certification.sourcing_certified,
      draft_handoff_via_classification_only_watch:classificationOnlyWatch,
      customs_review_still_required:c.scan_result?.customs_review?.status === 'REQUIRED',
      source_contract_version:c.normalized_source_contract?.schema_version || null,
      scan_reason: String(c.scan_result?.reason || '').slice(0,240),
      customs_review_status: c.scan_result?.customs_review?.status || null,
      quality_findings: Array.isArray(c.findings) ? c.findings.length : null,
      supplier_units:units.length, units_with_order_identity:skuOrderable,
      taxonomy:{status:taxonomy.status,category:taxonomy.category||null,subcategory:taxonomy.subcategory||null,source:taxonomy.source||null},
      source_price_kmf:c.purchase_price_kmf ?? null, ready_for_inactive_draft:ready,
      blockers:[...new Set(reasons)],
    });
  }
  for (const ref of EXPECTED.keys()) if (!rows.some(x=>x.candidate_ref===ref))
    blockers.push('MISSING_ORIGINAL_CANDIDATE:'+ref);
  return {
    mode:'READ_ONLY_NO_WRITES', target_fingerprint:target.fingerprint, run_ref:RUN_REF,
    run_status:run.status, run_intake_pipeline:run.intake?.pipeline_status||null,
    parent_import_status:parent?.status||null, product_count:Number(count.n),
    candidates:rows, blockers, price_and_publication:'NOT_CERTIFIED',
    verdict:blockers.length===0?'FOUR_INACTIVE_DRAFTS_READINESS_PASS':'CATALOGUE_HANDOFF_BLOCKED',
  };
}
async function main(){
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  let report;
  try {
    report = await audit();
    process.exitCode = report.blockers.length ? 2 : 0;
  } catch (e) {
    report = {mode:'READ_ONLY_NO_WRITES',run_ref:RUN_REF,verdict:'READONLY_AUDIT_ERROR',
      blockers:[String(e.code || e.message).slice(0,160)]};
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
    console.log('[CJ_FOUR_CATALOGUE_READINESS] '+JSON.stringify({
      verdict:report.verdict,source_run:RUN_REF,import_status:report.parent_import_status,
      candidates:report.candidates?.map(c=>({ref:c.candidate_ref,certified:c.certified,units:c.supplier_units,ready:c.ready_for_inactive_draft}))||[],
      blockers:report.blockers,
    }));
    await db.pool.end();
  }
}
if (require.main === module) main();
module.exports = { audit, EXPECTED, RUN_REF };

/** @komerce-arch-lite
 * @role provider-neutral-import-certification-gates
 * @domain sourcing
 * @layer tooling
 * @owner backend-core
 * @purpose Pure positive/negative calibration for actual supplier intake, FX deferral, category classification and publication isolation.
 * @db-read none
 * @db-write none
 * @impact-areas sourcing, catalog, certification, cross-supplier
 */
'use strict';

const normalized = s => String(s||'').trim().toLowerCase();
const count = value => Number.isInteger(Number(value))&&Number(value)>=0?Number(value):NaN;
const unique = list => Array.isArray(list)&&list.length===new Set(list).size
  && list.every(x=>typeof x==='string'&&x.trim()!=='');

function assess({provider,expected,source,run,events,candidates,classification,publishedDelta,scope='full'}={}) {
  if(!provider||!Number.isInteger(expected)||expected<1||expected>500)
    throw Error('INVALID_SUPPLIER_PROOF_PARAMETERS');
  if(!['full','sourcing_only'].includes(scope))throw Error('INVALID_PROOF_SCOPE');
  const input=Array.isArray(source?.products)?source.products:[];
  const ids=input.map(p=>String(p?.supplier_product_id||'').trim());
  const inputOk=input.length===expected && unique(ids)
    && count(source.invalid_count)===0;
  const intake=run?.intake||{};
  const received=count(run?.source_total);
  const accepted=count(intake.accepted),rejected=count(intake.rejected);
  const fxPending=count(intake.fx_pending);
  const runOk=Boolean(run&&normalized(run.provider)===normalized(provider)
    && /^KIR-\d{6}$/.test(String(run.run_ref||''))
    && (run.status==='COMPLETED'||(scope==='sourcing_only'&&run.status==='RUNNING'))
    && received===expected
    && accepted===expected && rejected===0
    && Number.isFinite(fxPending)&&fxPending<=accepted
    && (intake.pipeline_status==='CANONICAL_RESOLVED'
        || (fxPending>0&&intake.pipeline_status==='PARTIAL_BLOCKED')));
  const eventRows=Array.isArray(events)?events:[];
  const finished=eventRows.filter(e=>e.finished_at&&e.candidate_id
    &&!['error','auto_rejected','rejected','excluded','failed'].includes(e.outcome)&&typeof e.outcome==='string'&&e.outcome.trim()!=='');
  const eventIds=eventRows.map(e=>String(e.supplier_product_id||'').trim());
  const linkedIds=eventRows.map(e=>String(e.candidate_id||'').trim());
  const eventOk=eventRows.length===expected && finished.length===expected
    &&unique(eventIds)&&unique(linkedIds)
    &&eventIds.every(id=>ids.includes(id));
  const candidateRows=Array.isArray(candidates)?candidates:[];
  const candidateIds=candidateRows.map(c=>String(c.id||'').trim());
  const candidateSupplierIds=candidateRows.map(c=>String(c.supplier_product_id||'').trim());
  const candidateRefs=candidateRows.map(c=>String(c.candidate_ref||'').trim());
  const candidateOk=candidateRows.length===expected&&unique(candidateIds)
    &&unique(candidateSupplierIds)&&unique(candidateRefs)
    &&candidateIds.every(id=>linkedIds.includes(id))
    &&candidateSupplierIds.every(id=>ids.includes(id));
  const observedFx=candidateRows.filter(c=>c?.scan_result?.fx_gate?.code==='fx_rate_unavailable');
  const pendingSafe=observedFx.every(c=>
    c.scan_result?.fx_gate?.status==='AWAITING_OFFICIAL_QUOTE'
    &&c.scan_result?.sourcing_decision==='WATCH'
    &&c.purchase_price_kmf===null
    &&c.data_sources?.fx_conversion==='pending_official_rate');
  const fxOk=Number.isFinite(fxPending)&&observedFx.length===fxPending&&pendingSafe;
  const taxProducts=Array.isArray(classification?.products)?classification.products:[];
  const autoRows=taxProducts.filter(x=>x.status==='AUTO_CLASSIFIED'
    &&x.category&&x.subcategory&&candidateRefs.includes(x.candidate_ref));
  const taxOk=classification?.inspected===expected
    &&classification?.auto_classifiable_products===expected
    &&classification?.unresolved_products===0
    &&classification?.explicit_review_products===0
    &&classification?.conflicting_classifications===0
    &&taxProducts.length===expected&&autoRows.length===expected
    &&unique(autoRows.map(x=>x.candidate_ref));
  const publicationOk=publishedDelta===0;
  const gates={
    source:{pass:inputOk,received:input.length,distinct:new Set(ids).size},
    import:{pass:runOk,run_ref:run?.run_ref||null,run_status:run?.status||null,
      scope,receipt_certified:runOk,terminal_handoff_certified:scope==='full'&&run?.status==='COMPLETED',
      received,accepted,rejected,pipeline_status:intake.pipeline_status||null},
    trace:{pass:eventOk,event_count:eventRows.length,finished_linked:finished.length},
    candidates:{pass:candidateOk,persisted:candidateRows.length,distinct: new Set(candidateSupplierIds).size},
    fx_deferral:{pass:fxOk,pending:fxPending,safe_deferred:observedFx.length,
      economic_pricing_certified:false},
    boutique_classification:{pass:taxOk,inspected:classification?.inspected??0,
      automatic:classification?.auto_classifiable_products??0,
      unresolved:classification?.unresolved_products??null},
    publication:{pass:publicationOk,new_products:publishedDelta}
  };
  const fails=Object.entries(gates).filter(([,gate])=>!gate.pass).map(([key])=>key);
  return {provider,expected,scope,verdict:fails.length?'NOT_CERTIFIED':'CLASSIFICATION_CERTIFIED_NOT_SELLABILITY',
    passed:fails.length===0,failed_gates:fails,gates,
    note:'Sourcing-only proof never certifies the Catalogue handoff, prices or buyer publication. A deferred FX quote must not block intake or object classification.'};
}
module.exports={assess};

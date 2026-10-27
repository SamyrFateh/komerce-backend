'use strict';
/**
 * Independent, explainable source-signal triage. Never auto-confirms a bug.
 * Maps existing LS-* heuristics to domain owner & independent proof needed.
 */
const RULE_OWNER=Object.freeze({
 'LS-01':Object.freeze({owner:'Orders / Status Machine',boundary:'P2',class:'DIRECT_STATE_WRITE',
  independentProof:'Trace persisted orders.status writer, authorized state transition, and resulting order_status_history; reject only if an actual noncanonical writer exists'}),
 'LS-02':Object.freeze({owner:'Payments / Transaction Orchestration',boundary:'P5',class:'NON_ATOMIC_PSP_SQL',
  independentProof:'Inspect actual transaction scope and external PSP call; reproduce rollback-after-PSP-response with sandbox provider and durable intent'}),
 'LS-03':Object.freeze({owner:'Payments / Idempotency',boundary:'P5',class:'UNSTABLE_REQUEST_KEY',
  independentProof:'Replay same logical request with controlled clock; prove two distinct request keys and duplicate side effect despite canonical guard'}),
 'LS-04':Object.freeze({owner:'Logistics / Parcel Membership',boundary:'P4',class:'DIRECT_PARCEL_MUTATION',
  independentProof:'Identify whether SQL writer delegates to parcel ownership and prove parcel_items membership/trace before-after in disposable PostgreSQL'}),
 'LS-05':Object.freeze({owner:'Logistics / Parcel Membership',boundary:'P4',class:'SILENT_CONFLICT',
  independentProof:'Create competing parcel_items membership transaction and verify conflict is deliberately reconciled, not silently discarded'}),
 'LS-06':Object.freeze({owner:'Payments / PSP',boundary:'P5',class:'PSP_NETWORK_SIDE_EFFECT',
  independentProof:'Inspect durable request intent, webhooks, idempotent reconciliation and post-response failure; network call itself is not a bug'}),
});
function prepareStaticTriage(findings){
 if(!Array.isArray(findings))throw Error('Expected static findings array');
 return findings.map((f,i)=>{
  if(!f||typeof f.file!=='string'||!f.rule)throw Error('Invalid static finding '+i);
  const owner=RULE_OWNER[f.rule]||null;
  const path=f.file.replace(/\\/g,'/');
  const relative=path.startsWith('services/')?'service':
    path.startsWith('routes/')?'route':
    path.startsWith('scripts/')?'script':
    path.startsWith('tools/')?'tooling':
    path.startsWith('public/')?'frontend':'other';
  const rank=f.priority==='P1'?'PRIORITY_OWNER_REVIEW':'NORMAL_OWNER_REVIEW';
  return {
   id:'KBA-S-'+String(i+1).padStart(3,'0'),
   rule:f.rule,file:f.file,line:f.line??null,
   priority:f.priority||null,category:f.category||null,
   component:relative,
   owner:owner?.owner||'UNASSIGNED_OWNER',
   businessBoundary:owner?.boundary||'UNMAPPED',
   riskClass:owner?.class||'UNKNOWN_RULE',
   nextIndependentProof:owner?.independentProof||'Identify responsible business owner and an independent nominal/counterexample',
   status:'STATIC_SIGNAL_REQUIRES_OWNER_REVIEW',
   confirmedBug:false,
   // Preserve raw reference, but avoid making a stale line number the stable ID.
   originalFingerprint:f.fingerprint||null,
  };
 });
}
function summarizeTriage(rows){
 const group={};
 for(const r of rows){
  const key=r.rule+'|'+r.owner;
  const g=group[key]||(group[key]={rule:r.rule,owner:r.owner,businessBoundary:r.businessBoundary,
   files:new Set(),occurrences:0,highestPriority:null});
  g.occurrences++;
  g.files.add(r.file);
  if(g.highestPriority!=='P1'&&r.priority)g.highestPriority=r.priority;
 }
 return Object.values(group).map(g=>({
  rule:g.rule,owner:g.owner,businessBoundary:g.businessBoundary,
  occurrences:g.occurrences,files:g.files.size,highestPriority:g.highestPriority,
 })).sort((a,b)=>a.rule.localeCompare(b.rule));
}
module.exports={RULE_OWNER,prepareStaticTriage,summarizeTriage};

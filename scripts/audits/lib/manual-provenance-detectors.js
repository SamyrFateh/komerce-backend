'use strict';
/**
 * Governance-driven manual authority preservation signal.
 *
 * Database data_sources contains field-level "manual" provenance.
 * We derive protected field names from existing guarded owner SQL,
 * then compare other INSERT ... ON CONFLICT DO UPDATE writers on the
 * same table. This emits REVIEW, never a confirmed business defect.
 */
function getProtectedManualFields(source, table) {
  const s=String(source);
  if(!new RegExp('\\bINSERT\\s+INTO\\s+(?:public\\.)?'+table+'\\b','i').test(s))return [];
  const re=new RegExp(
    '\\b'+table+'\\.data_sources\\s*->>\\s*\\x27([a-z][a-z0-9_]*)\\x27\\s*\\)\\s*=\\s*\\x27manual\\x27',
    'gi'
  );
  return [...new Set([...s.matchAll(re)].map(m=>m[1]))];
}
function scanUnprotectedManualUpserts(source,file,table,protectedFields) {
  const s=String(source);
  const results=[];
  if(!protectedFields?.length)return results;
  const sqlRx=new RegExp(
    '\\bINSERT\\s+INTO\\s+(?:public\\.)?'+table+'\\s*\\([\\s\\S]*?\\bON\\s+CONFLICT\\b[\\s\\S]*?\\bDO\\s+UPDATE\\s+SET\\b([\\s\\S]*?)(?=\\bWHERE\\s+(?:'+table+'\\.|[a-z_]+\\.)?state\\b|\\x60|$)',
    'gi'
  );
  for(const m of s.matchAll(sqlRx)){
    const updates=m[1];
    for(const field of protectedFields){
      const assignment=new RegExp('\\b'+field+'\\s*=\\s*EXCLUDED\\.'+field+'\\b','i');
      if(!assignment.test(updates))continue;
      // Writer explicitly honors field-level manual authority?
      const hasManualGate=new RegExp(
        'data_sources\\s*->>\\s*\\x27'+field+'\\x27[\\s\\S]{0,90}\\x27manual\\x27',
        'i'
      );
      if(hasManualGate.test(updates))continue;
      results.push({
        kind:'MANUAL_FIELD_PROVENANCE_IGNORED_BY_UPSERT',
        severity:'REVIEW',table,field,file,
        line:s.slice(0,m.index).split('\n').length,
        evidence:'DO UPDATE SET '+field+' = EXCLUDED.'+field+' without a manual ownership CASE/guard',
        caveat:'Confirm same logical candidate identity, nonterminal state, real PG behavior, and owner-defined manual provenance before declaring a bug.'
      });
    }
  }
  return results;
}

/**
 * JSONB's || operator is right-biased for duplicate keys. If the same
 * upsert protects a manual field with CASE but later overlays all incoming
 * data_sources, the first import can erase the manual authority marker.
 * The second import may then bypass the earlier CASE. Review only.
 */
function scanManualProvenanceErasingMerges(source,file,table,protectedFields) {
  const s=String(source);
  if(!protectedFields?.length)return [];
  const insert=new RegExp('\\bINSERT\\s+INTO\\s+(?:public\\.)?'+table+'\\b','i');
  if(!insert.test(s) || !/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\s+SET\b/i.test(s))return [];
  const merge=new RegExp(
    '\\bdata_sources\\s*=\\s*(?:'+table+'\\.)?data_sources\\s*\\|\\|\\s*EXCLUDED\\.data_sources\\b','i'
  );
  const matched=merge.exec(s);
  if(!matched)return [];
  return protectedFields.map(field=>({
    kind:'MANUAL_PROVENANCE_ERASED_BY_JSONB_MERGE',severity:'REVIEW',
    file,table,field,line:s.slice(0,matched.index).split('\n').length,
    evidence:matched[0],
    caveat:'Confirm JSONB incoming provenance overlaps protected manual keys and sequential reimport breaks subsequent guarded writes on real PostgreSQL.'
  }));
}

module.exports={getProtectedManualFields,scanUnprotectedManualUpserts,scanManualProvenanceErasingMerges};

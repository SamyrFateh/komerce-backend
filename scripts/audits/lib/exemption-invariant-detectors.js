'use strict';
/**
 * @komerce-arch
 * @role          governance-cross-domain-exemption-detector
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        SQL schema and JS service source
 * @outputs       review-only write/read exemption candidates
 * @depends       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      scanner_diagnostic_not_certification
 *
 * Learn exemption pairs from the schema, not named products or known files.
 * Exemption doesn't necessarily mean a hard block; only runtime paired
 * calibration may conclude a real business rule is violated.
 */
function discoverExemptionPairs(schema) {
  const pairs = [];
  const tableRx = /\bCREATE\s+TABLE\s+(?:public\.)?([a-z][\w]*)\s*\(([\s\S]*?)\n\);/gi;
  for (const m of String(schema).matchAll(tableRx)) {
    const table=m[1],ddl=m[2];
    const columns=[...ddl.matchAll(/^\s*([a-z][\w]*)\s+(numeric|decimal|integer|bigint|smallint|double precision|real|boolean)\b/gmi)]
      .map(c=>({name:c[1],type:c[2].toLowerCase()}));
    for (const flag of columns.filter(c=>c.type==='boolean' && c.name.endsWith('_exempt'))) {
      const stem=flag.name.slice(0,-'_exempt'.length);
      for (const field of columns.filter(c=>c.name.startsWith(stem+'_') && c.name!==flag.name && c.type!=='boolean')) {
        pairs.push({table,flag:flag.name,field:field.name});
      }
    }
  }
  return pairs;
}
function functionBodies(source) {
  const rx=/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const found=[...String(source).matchAll(rx)];
  return found.map((m,i)=>({
    name:m[1],start:m.index,text:source.slice(m.index,found[i+1]?.index??source.length)
  }));
}
function scanExemptionSinks(source,file,pairs) {
  const results=[];
  for (const fn of functionBodies(source)) {
    for (const {table,flag,field} of pairs) {
      // A direct SQL write with field supplied dynamically, but with no
      // exemption decision in this function's conditional or SQL WHERE.
      const writesTable=new RegExp('\\bUPDATE\\s+(?:public\\.)?'+table+'\\s+SET\\b','i').test(fn.text);
      const modifiesField=new RegExp('\\b'+field+'\\s*=\\s*\\$','i').test(fn.text);
      const guardsFlag=new RegExp('(\\bif\\s*\\([^\\n]{0,250}\\b'+flag+'\\b|\\bWHERE\\b[^;]{0,500}\\b'+flag+'\\b)','i').test(fn.text);
      if(writesTable && modifiesField && !guardsFlag) {
        results.push({
          kind:'EXEMPTION_WRITE_UNGUARDED',severity:'REVIEW',file,
          function:fn.name,table,flag,field,
          line:source.slice(0,fn.start).split('\n').length,
          caveat:'The exemption and its forbidden operations must be confirmed in the owner doctrine and on a real database.'
        });
      }
      // If a consumer explicitly prefers the flagged field in a pure
      // getter, yet never tests the exception, investigate provenance.
      const getter=/^(?:get|compute|resolve|calculate|derive|analyze)/i.test(fn.name);
      const consumes=new RegExp('\\b'+field+'\\b').test(fn.text)
        && new RegExp('\\breturn\\b[\\s\\S]*?\\b'+field+'\\b').test(fn.text);
      if(getter && consumes && !new RegExp('\\b'+flag+'\\b').test(fn.text)) {
        results.push({
          kind:'EXEMPTION_READ_UNGUARDED',severity:'REVIEW',file,
          function:fn.name,table,flag,field,
          line:source.slice(0,fn.start).split('\n').length,
          caveat:'The consumer might legitimately use a measured field; compare effective value with exemption semantics.'
        });
      }
    }
  }
  return results;
}
module.exports={discoverExemptionPairs,scanExemptionSinks};

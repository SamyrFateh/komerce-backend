'use strict';
/**
 * @komerce-arch
 * @role          governance-novel-bug-patterns
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        source text, file path
 * @outputs       static review candidates (never confirmed bugs)
 * @depends       none
 * @used-by       scripts/audits/governance-graph-discovery.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      invariant_executable_non_speculatif
 *
 * Conservative lexical discovery of cross-domain integrity risks.
 * Findings are leads only: no DB, API or business effect is executed.
 */
const IDENTITY = /\b(?:const|let)\s+([A-Za-z_$][\w$]*(?:Id|_id))\s*=\s*([A-Za-z_$][\w$]*)\s*(\|\||\?\?)\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*(?:Id|_id))\s*;/g;
const SILENT_SUCCESS = /\bawait\s+[A-Za-z_$][\w$.]*\.query\s*\(\s*`([^`]*)`\s*,\s*\[([\s\S]{0,1000}?)\]\s*\)\s*;\s*([A-Za-z_$][\w$]*)\s*(\+\+|\+=\s*1)\s*;/g;
function lineOf(src, offset) { return src.slice(0, offset).split('\n').length; }
function scanNovelPatterns(source, file) {
  const findings = [];
  for (const m of source.matchAll(IDENTITY)) {
    findings.push({
      severity: 'REVIEW',
      kind: 'CALLER_IDENTITY_OVERRIDES_CANONICAL_ROW',
      file, line: lineOf(source, m.index),
      target: m[1], input: m[2], precedence: m[3],
      dbRow: m[4], dbField: m[5], evidence: m[0],
      caveat: 'Row provenance, caller trust and absence of a guard must be verified by tracing the actual service.'
    });
  }
  for (const m of source.matchAll(SILENT_SUCCESS)) {
    if (!/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+NOTHING\b/i.test(m[1])) continue;
    if (!/\b(?:INSERT\s+INTO|UPDATE)\b/i.test(m[1])) continue;
    findings.push({
      severity: 'REVIEW',
      kind: 'SILENT_CONFLICT_COUNT_AS_SUCCESS',
      file, line: lineOf(source, m.index), counter: m[3],
      evidence: m[0].replace(/\s+/g, ' ').slice(0, 280),
      caveat: 'Counter increments without checking rowCount; verify SQL conflict reachability and downstream impact.'
    });
  }
  return findings.sort((a,b)=>a.line-b.line || a.kind.localeCompare(b.kind));
}
module.exports = { scanNovelPatterns };

'use strict';
/**
 * A known controlled-test violation is NOT acceptable business behavior.
 * A reviewed baseline records expected scanner output so any change forces
 * investigation (new violation AND old violation disappearing).
 */
function compareBaseline(baseline, report) {
 if(baseline?.contract!=='komerce-business-verdict-baseline/v1' ||
    report?.contract!=='komerce-business-bug-hunter/v1'||
    !Array.isArray(report.findings))
  throw Error('TOOL_ERROR: invalid or missing baseline/report contract');
 const expected=baseline.expected||{};
 if(typeof expected!=='object'||Array.isArray(expected))throw Error('TOOL_ERROR: invalid baseline entries');
 const observed=Object.fromEntries(report.findings.map(f=>[f.id,f.verdict]));
 if(Object.keys(observed).length!==report.findings.length)
  throw Error('TOOL_ERROR: duplicate findings in report');
 const ids=[...new Set([...Object.keys(expected),...Object.keys(observed)])].sort();
 const differences=ids.filter(id=>expected[id]!==observed[id]).map(id=>({
  id,baseline:expected[id]||'NOT_REGISTERED',
  observed:observed[id]||'MISSING',type:!expected[id]?'NEW_ORACLE':
    !observed[id]?'MISSING_ORACLE':'VERDICT_CHANGED'
 }));
 return {contract:'komerce-business-verdict-gate/v1',
  outcome:differences.length?'BASELINE_DRIFT':'BASELINE_MATCH',
  comparedOracles:ids.length,changes:differences,
  incidentsConfirmed:0,
  note:'Baseline match certifies stability of observed test verdicts, not correctness of business behavior'};
}
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path');
 try{
  const source=process.argv[2],report=process.argv[3],output=process.argv[4];
  if(!source||!report||!output)throw Error('TOOL_ERROR: baseline path, scan path, output path required');
  const comparison=compareBaseline(JSON.parse(fs.readFileSync(source)),JSON.parse(fs.readFileSync(report)));
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(comparison,null,2)+'\n');
  console.log('BUSINESS_AUDIT_V12_BASELINE '+JSON.stringify(comparison));
  if(comparison.outcome==='BASELINE_DRIFT')process.exitCode=3;
 }catch(e){console.error('BUSINESS_AUDIT_V12_TOOL_ERROR '+e.message);process.exitCode=2}
}
module.exports={compareBaseline};

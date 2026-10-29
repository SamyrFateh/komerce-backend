'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {collectRouteImportPaths,resolveRelative}=require('./v07-import-hints');
test('two-file route-service trace is a static hint, never runtime proof',()=>{
 const sources={
  'routes/hub.js':"const a = require('../services/auto-parcel'); a.distributeAll();",
  'services/auto-parcel.js':"const db=require('../db'); db.query('INSERT INTO parcels');",
  'db.js':'module.exports={};',
  'routes/irrelevant.js':"require('../services/missing');"
 };
 const report=collectRouteImportPaths(Object.keys(sources),f=>sources[f],['services/auto-parcel.js']);
 assert.deepEqual(report.pathsByWriter['services/auto-parcel.js'][0].files,
  ['routes/hub.js','services/auto-parcel.js']);
 assert.equal(report.pathsByWriter['services/auto-parcel.js'][0].runtimePathProven,false);
 assert.equal(report.coverage.pathsProvenAtRuntime,0);
});
test('unknown or dynamic modules yield no invented route reachability',()=>{
 const src={'routes/a.js':"require('../services/' + name)",
  'services/x.js':"module.exports={};"};
 const out=collectRouteImportPaths(Object.keys(src),f=>src[f],['services/x.js']);
 assert.deepEqual(out.pathsByWriter['services/x.js'],[]);
});
test('resolveRelative cannot escape tracked repository or invent files',()=>{
 const files=new Set(['services/x.js','services/y/index.js']);
 assert.equal(resolveRelative('routes/a.js','../services/x',files),'services/x.js');
 assert.equal(resolveRelative('routes/a.js','../services/y',files),'services/y/index.js');
 assert.equal(resolveRelative('routes/a.js','../../../secret',files),null);
});

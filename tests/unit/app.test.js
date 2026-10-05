'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs'); const path=require('path');
const s=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','admin','js','app.js'),'utf8');
test('admin app registers MarketsView route',()=>{
  expect(s).toMatch(/\/admin\/markets[\s\S]*MarketsView/);
});

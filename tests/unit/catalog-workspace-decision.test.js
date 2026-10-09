'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','catalog-workspace-decision.js'),'utf8');

test('catalog decision overview reste limité à Hero décisions et curation',()=>{
  const start=source.indexOf('function prependDecisionView');
  const render=source.slice(start, source.indexOf('function enhance', start));
  expect(render).toContain("data-dashboard-role', 'hero");
  expect(render).toContain("data-dashboard-role', 'attention");
  expect(render).toContain("data-dashboard-role', 'primary");
  expect(render).not.toContain("'État du catalogue'");
  expect(render).not.toContain("'Assortiment commercial'");
  expect(render).not.toContain("'Santé de la taxonomie'");
});

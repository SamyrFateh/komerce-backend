'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','sourcing-workspace-decision.js'),'utf8');

test('sourcing decision overview garde uniquement les arbitrages actionnables',()=>{
  const start=source.indexOf('function renderMetricOverview');
  const render=source.slice(start, source.indexOf('function decorateUi', start));
  expect(render).toContain("'À arbitrer'");
  expect(render).toContain("'Les candidats qui demandent une décision maintenant.'");
  expect(render).not.toContain('SummaryCards.render');
});

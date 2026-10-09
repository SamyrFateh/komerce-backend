'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','finance-accounting-workspace-decision.js'),'utf8');

test('accounting decision overview garde uniquement les contrôles actionnables',()=>{
  const start=source.indexOf('function renderMetricOverview');
  const render=source.slice(start, source.indexOf('function decorateUi', start));
  expect(render).toContain("'À contrôler maintenant'");
  expect(render).toContain("'Les écarts et dépôts qui demandent une intervention maintenant.'");
  expect(render).not.toContain('SummaryCards.render');
  const enhance=source.slice(source.indexOf('function enhance'));
  expect(enhance).not.toContain('appendReconciliationOverview(options');
});

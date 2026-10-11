'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','finance-accounting-workspace-decision.js'),'utf8');

test('comptabilité : priorités actionnables ET soldes visibles sans incident',()=>{
  const start=source.indexOf('function renderMetricOverview');
  const render=source.slice(start, source.indexOf('function decorateUi', start));
  expect(render).toContain("'À contrôler maintenant'");
  expect(render).toContain("'Priorités fondées sur les faits du marché");
  expect(render).toContain('if (decisions.length)');
  expect(render).toContain('decisionUi.DecisionStrip.render(decisionHost, { items: decisions })');
  // Les cartes de soldes doivent rester visibles hors de la condition sur les alertes.
  expect(render).toContain('decisionUi.SummaryCards.render(totals, { items: summaryCards(items) })');
  expect(render.indexOf('decisionUi.SummaryCards.render')).toBeGreaterThan(render.indexOf('if (decisions.length)'));
  expect(source).toContain("{ label: 'Détenu', value: value('held') }");
  expect(source).toContain("{ label: 'Clôturé', value: value('closed') }");
  const enhance=source.slice(source.indexOf('function enhance'));
  expect(enhance).not.toContain('appendReconciliationOverview(options');
});

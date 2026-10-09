'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','pricing-workspace-decision.js'),'utf8');

test('Atelier économique garde Hero + décisions + situation économique uniquement',()=>{
  const start=source.indexOf('function renderOverview');
  const renderSource=source.slice(start, source.indexOf('async function fetchMarketDecision', start));
  expect(renderSource).toContain("data-dashboard-role', 'hero");
  expect(renderSource).toContain("data-dashboard-role', 'attention");
  expect(renderSource).toContain("data-dashboard-role', 'primary");
  expect(renderSource).toContain("'Situation économique'");
  expect(renderSource).not.toContain("'Frontières prix produit'");
  expect(renderSource).not.toContain("'Overrides pays'");
  expect(renderSource).not.toContain("'Coûts'");
  expect(renderSource).not.toContain("'Stratégie & concurrence'");
  expect(renderSource).not.toContain('TrustFooter.render');
  expect(renderSource).toContain('workspaceHeader.remove()');
  expect(renderSource).toContain("header.appendChild(feedback)");
});

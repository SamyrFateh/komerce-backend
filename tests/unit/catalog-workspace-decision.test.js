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

test('le Hero décision est reposé après chaque rendu (rechargement après action)',async ()=>{
  const decision=require('../../public/dashboards/canonical/js/catalog-workspace-decision.js');
  const makeNode=()=>({ children:[], className:'', textContent:'', setAttribute(){}, appendChild(c){ this.children.push(c); return c; }, querySelector(){ return null; }, querySelectorAll(){ return []; } });
  const doc={ createElement:makeNode };
  const root=makeNode();
  root.prepend=jest.fn();
  const base={ mount: jest.fn(async opts=>{ opts.afterRender({ products:[], summary:{}, curation:{} }); opts.afterRender({ products:[], summary:{}, curation:{} }); return {}; }) };
  const decisionUi={ DecisionStrip:{ render(){} }, RankedList:{ render(){} } };
  const enhanced=decision.enhance(base,decisionUi);
  await enhanced.mount({ root, document:doc, ui:{}, location:{ search:'' } });
  expect(root.prepend).toHaveBeenCalledTimes(2);
});

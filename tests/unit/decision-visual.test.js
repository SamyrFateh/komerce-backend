'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','css','decision-visual.css'),'utf8');

describe('decision visual — contextual Commerce hero',()=>{
  test('Commerce possède un Hero distinct et la surface activité essentielle',()=>{
    expect(css).toContain('[data-dashboard-id="commerce"] > .kmc-dashboard-header');
    expect(css).toContain('.kmc-commerce-essential-metrics');
    expect(css).toContain('.kmc-commerce-flow-title');
  });
});


test('Finance possède un Hero contextuel propre',()=>{
  expect(css).toContain('[data-dashboard-id="finance"] > .kmc-dashboard-header');
  expect(css).toContain('.kmc-finance-essential-metrics');
  expect(css).toContain('.kmc-finance-review-title');
});


test('Commandes possède un Hero contextuel propre',()=>{
  expect(css).toContain('[data-dashboard-id="orders"] > .kmc-dashboard-header');
  expect(css).toContain('.kmc-orders-essential-metrics');
  expect(css).toContain('.kmc-orders-flow-title');
});

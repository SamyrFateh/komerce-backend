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

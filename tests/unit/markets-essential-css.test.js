'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..','..');

test('Marchés possède un Hero contextuel sur les surfaces centrale et pays',()=>{
  const css=fs.readFileSync(path.join(ROOT,'public','dashboards','canonical','css','markets-essential.css'),'utf8');
  const access=fs.readFileSync(path.join(ROOT,'public','dashboards','canonical','access.html'),'utf8');
  const autonomy=fs.readFileSync(path.join(ROOT,'public','dashboards','canonical','market-autonomy.html'),'utf8');
  expect(css).toContain('.kmc-markets-decision-overview > .kmc-dashboard-header');
  expect(css).toContain('linear-gradient(112deg, #f4fbfd');
  expect(access).toContain('/dashboards/canonical/css/markets-essential.css');
  expect(autonomy).toContain('/dashboards/canonical/css/markets-essential.css');
});

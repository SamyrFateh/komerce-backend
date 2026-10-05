'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.join(__dirname,'..','..');
const view=fs.readFileSync(path.join(ROOT,'public','dashboards','admin','js','views','MarketsView.js'),'utf8');
const app=fs.readFileSync(path.join(ROOT,'public','dashboards','admin','js','app.js'),'utf8');
const api=fs.readFileSync(path.join(ROOT,'public','dashboards','admin','js','api-client.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'public','dashboards','admin','index.html'),'utf8');

describe('admin MarketsView',()=>{
  test('canonical BO route loads one dedicated view',()=>{
    expect(app).toMatch(/\/admin\/markets[\s\S]*MarketsView/);
    expect(html).toContain('/dashboards/admin/js/views/MarketsView.js');
  });
  test('view uses only Control Plane APIs for creation/readiness/activation',()=>{
    expect(view).toMatch(/KmcApi\.provisionMarket/);
    expect(view).toMatch(/KmcApi\.getMarketControlPlane/);
    expect(view).toMatch(/KmcApi\.setMarketLifecycle/);
    expect(view).not.toMatch(/fetch\(/);
    expect(api).toMatch(/function provisionMarket/);
  });
  test('form gathers governance, limits, payment, cash and first relay',()=>{
    for(const token of ['central_referent_user_id','execution.cash.confirm','settlement.receive','finance.act','payment_provider','initial_relais']){
      expect(view).toContain(token);
    }
  });
});

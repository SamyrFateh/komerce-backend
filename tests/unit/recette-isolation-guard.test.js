'use strict';
const {recetteIsolationGuard}=require('../../middleware/recette-isolation-guard');
const original=process.env.KOMERCE_RECETTE_ISOLATED;
afterAll(()=>{if(original===undefined)delete process.env.KOMERCE_RECETTE_ISOLATED;else process.env.KOMERCE_RECETTE_ISOLATED=original;});
function invoke(method,path){
 const next=jest.fn();const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
 recetteIsolationGuard({method,path},res,next);
 return {next,res};
}
test('normal runtime remains unchanged',()=>{
 delete process.env.KOMERCE_RECETTE_ISOLATED;
 expect(invoke('POST','/api/payments/stripe/webhook').next).toHaveBeenCalledTimes(1);
});
test('sandbox isolates all mutation except approved operator and login scopes',()=>{
 process.env.KOMERCE_RECETTE_ISOLATED='true';
 for(const path of ['/api/payments/stripe/webhook','/api/payments/paypal/webhook',
  '/api/orders','/api/auth/register','/api/admin/users','/api/scans/collect',
  '/api/market/activate','/api/notifications/send','/api/integrations/aliexpress/import']){
  const {next,res}=invoke('POST',path);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({code:'RECETTE_MUTATION_BLOCKED'}));
 }
 for(const path of ['/api/auth/login','/api/admin/workspaces/catalog/products/KPR/classify',
  '/api/admin/workspaces/sourcing/candidates/KSC/resolve-category',
  '/api/admin/workspaces/pricing/decisions']){
  expect(invoke('POST',path).next).toHaveBeenCalledTimes(1);
 }
 expect(invoke('GET','/api/products').next).toHaveBeenCalledTimes(1);
});

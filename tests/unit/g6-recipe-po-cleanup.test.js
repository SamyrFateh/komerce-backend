/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {scopeVerdict}=require('../../services/g6-recipe-po-cleanup-service');
const peer=(scope='G6-BUYER',mode='cash_relais')=>({simulation_scope:scope,payment_mode:mode});
test('G6 PO C : exige au moins une commande et 100 % des commandes G6 cash relais',()=>{
 expect(scopeVerdict([], 'notified').eligible).toBe(false);
 expect(scopeVerdict([peer()], 'notified').eligible).toBe(true);
 expect(scopeVerdict([peer(),peer()], 'confirmed').eligible).toBe(true);
 expect(scopeVerdict([peer(),peer(null)], 'confirmed').code).toBe('G6_PO_MIXED_OR_UNREADABLE');
 expect(scopeVerdict([peer(),peer('OTHER')], 'notified').eligible).toBe(false);
 expect(scopeVerdict([peer('G6-BUYER','stripe_eur')], 'confirmed').eligible).toBe(false);
 expect(scopeVerdict([peer()], 'hub_received').eligible).toBe(false);
});
test('code métier atomique et sans appel fournisseur',()=>{
 const fs=require('fs'),path=require('path');
 const src=fs.readFileSync(path.join(__dirname,'../../services/g6-recipe-po-cleanup-service.js'),'utf8');
 expect(src).toContain('FOR UPDATE OF pl');
 expect(src).toContain('received_quantity');
 expect(src).toContain('supplier_execution_payments');
 expect(src).toContain("status='cancelled'");
 expect(src).toContain('resolveRecipePoAlerts');
 expect(src).not.toMatch(/fetch\(|axios\.|sendEmail|sendWhatsApp|supplier\.order/);
});

test('G6 PO C : hors staging, aucun geste recette possible',async()=>{
 const {cancelG6RecipePo}=require('../../services/g6-recipe-po-cleanup-service');
 const before=process.env.KOMERCE_ENV;process.env.KOMERCE_ENV='production';
 try{
   await expect(cancelG6RecipePo('00000000-0000-4000-8000-000000000042','Motif de recette valide',{id:'00000000-0000-4000-8000-000000000042',role:'admin'}))
    .rejects.toMatchObject({status:403,code:'G6_PO_STAGING_ONLY'});
 }finally{if(before===undefined)delete process.env.KOMERCE_ENV;else process.env.KOMERCE_ENV=before;}
});

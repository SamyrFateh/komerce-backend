/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('fs'),path=require('path');
const route=fs.readFileSync(path.join(__dirname,'../../routes/orders/cancel.js'),'utf8');
test('G6 D : route protégée admin et service métier distinct du remboursement PSP',()=>{
 expect(route).toContain("router.post('/:id/g6-recipe-close', authenticate, requireRole(['admin'])");
 expect(route).toContain("require('../../services/g6-recipe-order-closure-service')");
 expect(route).toContain('closeG6RecipeAtHub(req.params.id');
 expect(route).toContain("router.post('/:id/cancel', authenticate");
});

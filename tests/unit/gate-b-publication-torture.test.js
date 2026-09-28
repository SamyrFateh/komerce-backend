'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db');
const {validatePublicationUpdate}=require('../../services/product-publication-guard');
function base(){return {name:'Produit test',category:'Maison',price_kmf:5000,stock:3,is_active:false,is_available:false,content_source:'manual',source_locale:'fr',description:'Description française suffisamment complète.'};}
describe('Gate B publication torture — production guard',()=>{
 test('missing or invalid price fails closed',()=>{for(const v of [null,0,-1,'abc'])expect(validatePublicationUpdate({before:{...base(),price_kmf:v},patch:{is_active:true},context:{catalogMediaCount:1}})).toMatchObject({ok:false,code:'invalid_price'});});
 test('missing category fails closed',()=>expect(validatePublicationUpdate({before:{...base(),category:''},patch:{is_active:true},context:{catalogMediaCount:1}})).toMatchObject({ok:false,code:'missing_category'}));
 test('missing primary media fails closed',()=>expect(validatePublicationUpdate({before:base(),patch:{is_active:true},context:{catalogMediaCount:0}})).toMatchObject({ok:false,code:'media_required'}));
 test('malformed/empty description fails closed',()=>{for(const v of ['', 'short'])expect(validatePublicationUpdate({before:{...base(),description:v},patch:{is_active:true},context:{catalogMediaCount:1}})).toMatchObject({ok:false,code:'description_required'});});
});

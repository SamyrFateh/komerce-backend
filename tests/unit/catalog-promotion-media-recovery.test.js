'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { restoreSourceMediaOnly } = require('../../services/catalog-promotion');

const snapshot = overrides => ({
 schema_version:'2',product_name:'Lampe LED',supplier_name:'CJdropshipping',
 currency:'AED',option_axes:[],
 media:[{supplier_media_id:'IMG-A',url:'https://cdn.example.org/a.jpg',role:'PRODUCT'}],
 ...overrides,
});

test('réintégration ciblée réutilise le seul writer media, pas les SKU/stock/prix',async()=>{
 const client={query:jest.fn(async sql=>({
   rows:[{id:'media-uuid',source_media_id:'IMG-A'}],
 }))};
 const result=await restoreSourceMediaOnly(client,'product-uuid',snapshot());
 expect(result).toEqual(['IMG-A']);
 expect(client.query).toHaveBeenCalledTimes(1);
 expect(client.query.mock.calls[0][0]).toContain('INSERT INTO catalog_media');
 expect(client.query.mock.calls[0][0]).not.toContain('product_skus');
 expect(client.query.mock.calls[0][1][0]).toBe('product-uuid');
});
test.each([
 ['contrat V1',snapshot({schema_version:'1'})],
 ['sans média',snapshot({media:[]})],
 ['sans identité',snapshot({media:[{url:'https://cdn.example.org/a.jpg',role:'PRODUCT'}]})],
 ['identité dupliquée',snapshot({media:[
   {supplier_media_id:'IMG-A',url:'https://cdn.example.org/a.jpg',role:'PRODUCT'},
   {supplier_media_id:'IMG-A',url:'https://cdn.example.org/b.jpg',role:'PRODUCT'}]})],
 ['URL non HTTPS',snapshot({media:[{supplier_media_id:'IMG-A',url:'http://cdn.example.org/a.jpg'}]})],
 ['URL locale',snapshot({media:[{supplier_media_id:'IMG-A',url:'https://localhost/a.jpg'}]})],
 ['rôle inconnu',snapshot({media:[{supplier_media_id:'IMG-A',url:'https://cdn.example.org/a.jpg',role:'WRONG'}]})],
])('%s : aucun média écrit',async (_,contract)=>{
 const client={query:jest.fn()};
 await expect(restoreSourceMediaOnly(client,'product-uuid',contract)).rejects.toThrow();
 expect(client.query).not.toHaveBeenCalled();
});

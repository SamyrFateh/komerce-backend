'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn()}));
const {sourceKey,findConfirmed,confirmMapping}=require('../../services/supplier-commercial-category-mapping');
test('normalises provider and category path without translating source identity',()=>{
  expect(sourceKey('AliExpress',' Automobiles  > Interior Accessories ')).toEqual({
    provider:'aliexpress',path:'automobiles > interior accessories',
  });
});
test('confirmed mapping is applied only against active boutique taxonomy',async()=>{
  const q={query:jest.fn().mockResolvedValue({rows:[{category:'Auto',subcategory:'Accessoires'}]})};
  const row=await findConfirmed('AliExpress','Automobiles > Interior Accessories',q);
  expect(row).toEqual({category:'Auto',subcategory:'Accessoires'});
  expect(q.query.mock.calls[0][0]).toContain("m.status='CONFIRMED'");
  expect(q.query.mock.calls[0][0]).toContain('bc.is_active=TRUE');
});
test('refuses nonexistent boutique pair before any write',async()=>{
  const q={query:jest.fn().mockResolvedValue({rows:[]})};
  await expect(confirmMapping({provider:'AliExpress',source_category_path:'Auto > Interior',
    category:'Auto',subcategory:'Missing'},'admin',q))
    .rejects.toThrow('BOUTIQUE_TAXONOMY_INVALID');
  expect(q.query).toHaveBeenCalledTimes(1);
});
test('confirmed mapping preserves original source and French label separately',async()=>{
  const q={query:jest.fn()
    .mockResolvedValueOnce({rows:[{category:'Auto',subcategory:'Accessoires'}]})
    .mockResolvedValueOnce({rows:[{status:'CONFIRMED'}]})};
  const result=await confirmMapping({provider:'AliExpress',
    source_category_path:'Automobiles > Interior Accessories',
    label_fr:'Accessoires intérieurs',category:'Auto',subcategory:'Accessoires'},'admin',q);
  expect(result.status).toBe('CONFIRMED');
  expect(q.query.mock.calls[1][1]).toContain('Accessoires intérieurs');
  expect(q.query.mock.calls[1][1]).toContain('automobiles > interior accessories');
  expect(q.query.mock.calls[1][0]).not.toContain('komerce_category');
});

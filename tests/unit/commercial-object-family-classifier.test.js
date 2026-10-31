'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {categoryIntent}=require('../../services/commercial-object-family-classifier');
describe('supplier-neutral category placement: title AND supplier source path',()=>{
  test.each([
    ['Silky Light Fog Lip Gloss','Health, Beauty & Hair > Makeup > Lipstick','Mode & Beauté'],
    ['Padlock Necklace Key Pendant','Jewelry & Watches > Fashion Jewelry > Necklace & Pendants','Mode & Beauté'],
    ['New Kids Sneakers Lightweight','Toys, Kids & Babies > Shoes & Bags > Boys Shoes','Mode & Beauté'],
    ['Wireless Earbuds Bluetooth Headphones','Consumer Electronics > Portable Audio & Video > Headphones','Tech'],
    ['Silicone Kitchen Utensils Set','Home, Garden & Furniture > Kitchen, Dining & Bar > Cooking Tools','Maison'],
    ['6PCS Garden Tool Set','Home Improvement > Tools > Hand Tools','Bricolage'],
    ['4Pcs Disc Brake Rotor Set','Automobiles & Motorcycles > Auto Replacement Parts > Car Brake System','Auto']
  ])('genuine supplier object: %s => %s',(product_name,supplier_category,category)=>{
    expect(categoryIntent({product_name,supplier_category})).toMatchObject({
      kind:'category',category,subcategory:null,level:'CATEGORY',
      source:'SOURCE_AND_OBJECT_ROOT_CORROBORATED'});
  });
  test.each([
    ['Silky Light Fog Lip Gloss','Home, Garden & Furniture > Home Storage > Home Office Storage'],
    ['Padlock Necklace Key Pendant','Home Improvement > Tools > Door Locks'],
    ['Random Unknown Widget','Consumer Electronics > Audio'],
    ['Lip Gloss',''],
    ['Headlight Fog Light','Health, Beauty & Hair > Makeup > Lipstick'],
    ['Random Unknown Widget','Automobiles & Motorcycles > Auto Replacement Parts']
  ])('fails closed for missing or contradictory evidence: %s',(product_name,supplier_category)=>{
    expect(categoryIntent({product_name,supplier_category}).kind).toBe('none');
  });
  test('explicitly refuses contradictory roots rather than selecting a lexically strongest one',()=>{
    const result=categoryIntent({
      product_name:'Silky Lip Gloss and Car Headlight Brake Caliper',
      supplier_category:'Health Beauty > Makeup > Automobiles & Motorcycles > Auto Replacement Parts'
    });
    expect(result.kind).toBe('conflict');
    expect(result.categories).toEqual(expect.arrayContaining(['Mode & Beauté','Auto']));
  });
  test('never reads untrusted discovery placement as source evidence',()=>{
    expect(categoryIntent({product_name:'Unknown SKU',
      supplier_category:'General Products',
      raw_payload:{discovery:{target_category:'Tech',target_subcategory:'Audio',
        keyword:'bluetooth speakers'}}}).kind).toBe('none');
  });
});
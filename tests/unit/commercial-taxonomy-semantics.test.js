'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {semanticIntent,semanticConflict} = require('../../services/commercial-taxonomy-semantics');
const {resolveCommercialTaxonomyVerdict}=require('../../services/catalog-candidate-product-service');

// Real CJ KIR-000013 sample, with observed supplier category and product name.
// Frozen fixture: identity facts only, no price, token, provider API call or SQL write.
const CJ = [
 ['Temporary Metal Waterproof Key Box At The Door','Home, Garden & Furniture > Home Storage > Home Office Storage'],
 ['Summer New Ethnic Style Printed T-shirt',"Women's Clothing > Tops & Sets > Women's Short-Sleeved Shirts"],
 ['Summer New Style Hollow Casual Loose Ladies V-Neck Shirt',"Women's Clothing > Tops & Sets > Women's Short-Sleeved Shirts"],
 ['Traveling And Traveling Jewelry Portable Flannel Box','Home & Garden, Furniture / Home Storage / Home Office Storage'],
 ['Korean Style Matte Five-Pointed Star Ring For Women, New Simple Adjustable Open Ring','Jewelry & Watches / Fashion Jewelry / Rings'],
 ['Christmas Printed Casual Ladies Short-sleeved T-shirt',"Women's Clothing > Tops & Sets > Women's Short-Sleeved Shirts"],
 ['Fashionable And Elegant Slim Dress With Irregular Hips',"Women's Clothing > Tops & Sets > Lady Dresses"],
 ['Round Neck Short Sleeve Chiffon Shawl Tight-Fitting Plus Size Dress Women','Womens Clothing > Tops & Sets > Lady Dresses'],
 ['Sling Top Halter Imitation Silk Loose bottoming Fashion Inner Vest',"Women's Clothing > Tops & Sets > Women's Short-Sleeved Shirts"],
 ['Stain Treater','Home, Garden & Furniture > Home Storage > Home Office Storage'],
 ['Gold-Plated Zircon-Inlaid Ring New Vintage Ring','Jewelry & Watches / Fashion Jewelry / Rings'],
 ['Yipinge Fashion Custom Decorative Painting Sail','Home, Garden & Furniture > Home Storage > Home Office Storage'],
 ["Women's Fashion Vintage Gold Alloy Leaf Necklace",'Jewelry & Watches > Fashion Jewelry > Necklace & Pendants'],
 ['Cat Cool Dog Kennel Ice Pad Pet','Pet Supplies > Pet Bedding > Pet Nests'],
 ['Insect Repellent Spray','Home, Garden & Furniture > Home Storage > Home Office Storage'],
 ['Womens Off-shoulder Polka-dot Short-sleeve Slim-fit Asymmetrical Top',"Women's Clothing > Tops & Sets > Women's Short-Sleeved Shirts"],
 ['New Summer Small Tall Waist Slim Straight Five-Point Shorts Women','Womens Clothing > Bottoms > Woman Shorts'],
 ['European And American Fashion Positioning Print Shirt',"Women's Clothing > Outerwear & Jackets > Blazers"],
 ['Womens Floral Print V-Neck Sleeveless Long Slip Dress',"Women's Clothing > Tops & Sets > Lady Dresses"],
 ['Slim-fit Street Pullover Contrast Color Top',"Women's Clothing > Tops & Sets > Women's Short-Sleeved Shirts"]
];
function q(){
 return {query:jest.fn(async (sql,args=[])=>{
   if (sql.includes('SELECT bs.key FROM boutique_subcategories')) return {rows:[{key:args[1]}]};
   if (sql.includes('FROM supplier_commercial_category_mappings')) {
     return {rows:String(args[1]||'').includes('home office storage')
       ?[{category:'Maison',subcategory:'Rangement'}]:[]};
   }
   if (sql.includes('object_classification_terms')) return {rows:[]};
   return {rows:[]};
 })};
}
describe('Supplier-agnostic semantic commercial taxonomy',()=>{
 test('full source hierarchy resolves womenswear, for any provider, without path mapping',async()=>{
  for(const supplier_name of ['CJdropshipping','AliExpress','NewUnknownSupplier']){
    const verdict=await resolveCommercialTaxonomyVerdict(q(),{
      supplier_name, product_name:'Loose ladies V-neck shirt',
      supplier_category:"Women's Clothing > Tops & Sets > Women's Short-Sleeved Shirts"
    });
    expect(verdict).toMatchObject({status:'AUTO_CLASSIFIED',
      source:'SEMANTIC_SUPPLIER_HIERARCHY',category:'Mode & Beauté',subcategory:'Femme'});
  }
 });
 test.each([
  ["Ropa de mujer > Camisas",'Camisa blouse','Femme'],
  ["Vêtements Femme > Chemises",'Chemise femme','Femme'],
  ["Damenbekleidung > Blusen",'Summer blouse','Femme'],
  ["Men's Clothing > Tops",'Casual jacket','Homme'],
  ["Ropa de hombre > Camisas",'Shirt verano','Homme']
 ])('semantic bilingual apparel: %s', (supplier_category,product_name,subcategory)=>{
   expect(semanticIntent({supplier_category,product_name})).toMatchObject({
     kind:'pair',category:'Mode & Beauté',subcategory
   });
 });
 test('never calls a bad storage mapping classification automatically',async()=>{
  for(const product_name of ['Stain Treater','Insect Repellent Spray',
    'Decorative Painting Sail']){
    expect(await resolveCommercialTaxonomyVerdict(q(),{
      supplier_name:'CJdropshipping',product_name,
      supplier_category:'Home, Garden & Furniture > Home Storage > Home Office Storage'
    })).toMatchObject({status:'REVIEW_REQUIRED',source:'SOURCE_OBJECT_CONTRADICTS_STORAGE_MAPPING'});
  }
 });
 test('jewelry, pet supplies and generic women language are NOT apparel',()=>{
  for(const [product_name,supplier_category] of [
    ['Women Gold Alloy Leaf Necklace','Jewelry & Watches > Fashion Jewelry > Necklaces'],
    ['Cat Dog Kennel','Pet Supplies > Pet Bedding'],
    ['Women Gold Ring','Jewelry & Watches > Fashion Jewelry > Rings'],
    ['Women Necklace',"Women's Clothing > Tops & Sets"]
  ]){
    expect(semanticIntent({supplier_category,product_name}).kind).not.toBe('pair');
  }
 });
 test('singular dress is a real garment for adult and child, but decorative dress art is not',()=>{
   expect(semanticIntent({supplier_category:"Women's Clothing > Lady Dresses",
     product_name:'Summer Floral Dress'})).toMatchObject({kind:'pair',
     category:'Mode & Beauté',subcategory:'Femme'});
   expect(semanticIntent({supplier_category:'Toys, Kids & Babies > Girls Clothing > Girl Dresses',
     product_name:'Girls Floral Dress'})).toMatchObject({kind:'pair',
     category:'Mode & Beauté',subcategory:'Enfant'});
   expect(semanticIntent({supplier_category:'Toys, Kids & Babies > Girls Clothing > Girl Dresses',
     product_name:'Dress Wall Art Poster'}).kind).toBe('none');
 });
 test('gender contradiction in source or title fails closed',()=>{
  expect(semanticIntent({supplier_category:"Women's Clothing > Tops",product_name:'Mens Casual Jacket'}))
    .toMatchObject({kind:'conflict',reason:'CLOTHING_SOURCE_OBJECT_CONTRADICTION'});
  expect(semanticConflict({supplier_category:"Women's Clothing > Tops",
    product_name:'Men Gold Ring'}, {category:'Mode & Beauté',subcategory:'Femme'}))
    .toBe('CLOTHING_SOURCE_OBJECT_CONTRADICTION');
 });
 test.each([
  ['Childrens New Summer Lightweight, Sheer Doll-style Top And Shorts Set',
    'Toys, Kids & Babies > Girls Clothing > Girl Clothing Sets'],
  ["Girls' Checkered Short-sleeved Shorts Suit",
    'Toys, Kids & Babies > Girls Clothing > Girl Clothing Sets'],
  ['Heavy Industry High-end Embroidery Smocking Children Shirt Princess Dress',
    'Toys, Kids & Babies > Girls Clothing > Girl Dresses'],
  ['Clothes Sweet Lace Flying Sleeve Triangle Jumpsuit',
    'Toys, Kids & Babies > Girls Clothing > Girl Dresses'],
  ['Infant Clothing Class A Pure Cotton Seamless Onesie Baby Pajamas Winter Underwear Crawling Suit',
    'Toys, Kids & Babies > Baby Clothing > Baby Rompers'],
  ['Baby Cotton Onesie','Toys, Kids & Babies > Baby Clothing > Baby Rompers'],
 ])('real cross-provider child garment: %s',async(product_name,supplier_category)=>{
    expect(semanticIntent({product_name,supplier_category}))
      .toMatchObject({kind:'pair',category:'Mode & Beauté',
        subcategory:'Enfant',source:'SEMANTIC_SUPPLIER_HIERARCHY'});
    const resolved=await resolveCommercialTaxonomyVerdict(q(),{
      supplier_name:'OtherNewProvider',product_name,supplier_category});
    expect(resolved).toMatchObject({status:'AUTO_CLASSIFIED',
      category:'Mode & Beauté',subcategory:'Enfant'});
 });
 test.each([
   ['Silver Rings Gift','Toys, Kids & Babies > Girls Clothing > Girl Clothing Sets'],
   ['Baby Cotton Blanket','Toys, Kids & Babies > Baby Clothing > Baby Rompers'],
   ['Plush Bunny Toy','Toys, Kids & Babies > Toys & Hobbies > Stuffed & Plush Animals'],
   ['Cat Dog Kennel','Pet Supplies > Pet Bedding > Pet Nests'],
   ['Girls Sun Hat','Toys, Kids & Babies > Girls Clothing > Girl Hats & Caps'],
   ['Women Party Dress','Toys, Kids & Babies > Girls Clothing > Girl Dresses']
 ])('must never auto-route contradictory/non-garment child item: %s',(product_name,supplier_category)=>{
   expect(semanticIntent({product_name,supplier_category}).kind).not.toBe('pair');
 });
 test('conflicting adult clothing candidate cannot pass a child-category confirmed mapping',()=>{
   const c={product_name:'Mens Black Jacket',
     supplier_category:'Toys, Kids & Babies > Boys Clothing > Boy Jackets'};
   expect(semanticConflict(c,{category:'Mode & Beauté',subcategory:'Enfant'}))
     .toBe('CHILD_APPAREL_SOURCE_OBJECT_CONTRADICTION');
 });
 test('inactive boutique destination never becomes automatic',async()=>{
  const db={query:jest.fn(async()=>({rows:[]}))};
  expect(await resolveCommercialTaxonomyVerdict(db,{
    supplier_name:'Other',supplier_category:"Women's Clothing > Tops",product_name:'Summer blouse'
  })).toMatchObject({status:'REVIEW_REQUIRED',source:'SEMANTIC_TARGET_INACTIVE'});
 });
 test('weak lexical pair alone is never automatic',async()=>{
  const db={query:jest.fn(async sql=>{
    if(sql.includes('object_classification_terms')) return {rows:[]};
    if(sql.includes('FROM boutique_categories bc JOIN boutique_subcategories bs'))
      return {rows:[{category:'Tech',subcategory:'Phones',category_label:'Tech',subcategory_label:'Phones'}]};
    return {rows:[]};
  })};
  expect(await resolveCommercialTaxonomyVerdict(db,{supplier_name:'Unknown',
    supplier_category:'General > Phones',product_name:'Unknown article'}))
    .toMatchObject({status:'REVIEW_REQUIRED'});
 });
 test('bulk replay 10,000 classification decisions retains human review when destination absent',async()=>{
   const db=q();
   const results={automatic:0,review:0,source_conflict:0,female:0};
   const started=Date.now();
   for(let i=0;i<10000;i++){
     const row=CJ[i%20];
     const result=await resolveCommercialTaxonomyVerdict(db,{
       supplier_name:['CJdropshipping','AliExpress','Supplier-3','Supplier-4'][i%4],
       product_name:row[0],supplier_category:row[1]
     });
     if(result.status==='AUTO_CLASSIFIED'){results.automatic++;if(result.subcategory==='Femme')results.female++;}
     else results.review++;
     if(result.source==='SOURCE_OBJECT_CONTRADICTS_STORAGE_MAPPING')results.source_conflict++;
   }
   expect(results).toEqual({automatic:6500,review:3500,source_conflict:1500,female:5500});
   // Do not put nondeterministic timing in the assertion; report for review.
   console.log('[SEMANTIC_BULK_10000] '+JSON.stringify({...results,elapsed_ms:Date.now()-started}));
 });
});
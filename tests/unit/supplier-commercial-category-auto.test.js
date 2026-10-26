'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {chooseCommercialPair}=require('../../services/supplier-commercial-category-mapping');
const pairs=[
 {category:'Tech',subcategory:'Phones',category_label:'Electronics',subcategory_label:'Phone Accessories'},
 {category:'Home',subcategory:'Garden',category_label:'Home',subcategory_label:'Garden'},
 {category:'Fashion',subcategory:'Shoes',category_label:'Fashion',subcategory_label:'Shoes'},
];
test('supplier category chooses the commercial shelf without a confidence gate',()=>{
  expect(chooseCommercialPair(pairs,{supplier_category:'Electronics > Phone Accessories',product_name:'Silicone case'}))
    .toMatchObject({category:'Tech',subcategory:'Phones',source:'SUPPLIER_CATEGORY_MATCH'});
});
test('confirmed supplier mapping wins regardless of lexical score',()=>{
  expect(chooseCommercialPair(pairs,{supplier_category:'Home > Garden'}, {category:'Fashion',subcategory:'Shoes'}))
    .toMatchObject({category:'Fashion',subcategory:'Shoes',source:'KNOWN_COMMERCIAL_MAPPING'});
});
test('unknown supplier category does not invent a shelf',()=>{
  expect(chooseCommercialPair(pairs,{supplier_category:'Very Strange Unrelated'},null)).toBeNull();
});

test('uses the supplier leaf category, not parent category, when choosing boutique shelf',()=>{
  const boutiquePairs=[
    {category:'Generic',subcategory:'Electronics',category_label:'Consumer Electronics',subcategory_label:'General'},
    {category:'Tech',subcategory:'Decor',category_label:'Tech',subcategory_label:'Mobile Phone Decorations'},
  ];
  expect(chooseCommercialPair(boutiquePairs,{
    supplier_category:'Consumer Electronics > Mobile Phone Decorations',
    product_name:'Silicone protective item',
  })).toMatchObject({category:'Tech',subcategory:'Decor',source:'SUPPLIER_CATEGORY_MATCH'});
});

'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  FLAG, objectIntent, branchCategory, decideCategory, enabled,
}=require('../../services/commercial-category-agreement');
const {
  resolveCommercialTaxonomyVerdict,
  createDraftProductFromSourcingCandidate,
}=require('../../services/catalog-candidate-product-service');

const ali=(title,path)=>({supplier_name:'AliExpress',product_name:title,supplier_category:path});
const cj=(title,path)=>({supplier_name:'CJdropshipping',product_name:title,supplier_category:path});
function qMock(active=true,mapped=null) {
  const query=jest.fn(async (sql)=>{
    if(sql.includes('FROM supplier_commercial_category_mappings'))
      return {rows:mapped?[mapped]:[]};
    if(sql.includes('FROM boutique_categories'))
      return {rows:active?[{key:'Tech'}]:[]};
    if(sql.includes('INSERT INTO products'))
      throw new Error('CATEGORY_ONLY_MUST_NEVER_CREATE_DRAFT');
    throw new Error('UNEXPECTED_CLASSIFIER_SQL: '+sql);
  });
  return {query};
}
describe('commercial source-object category agreement (frozen category-only flag)',()=>{
  const original=process.env[FLAG];
  afterEach(()=>{
    if(original===undefined)delete process.env[FLAG];
    else process.env[FLAG]=original;
  });
  test('disabled by default; no implicit rollout',()=>{
    delete process.env[FLAG];
    expect(enabled()).toBe(false);
    process.env[FLAG]='false';
    expect(enabled()).toBe(false);
    process.env[FLAG]='1';
    expect(enabled()).toBe(true);
  });
  test('recognizes only independent source title and real supplier root',()=>{
    expect(decideCategory(ali('Clear Silicone Phone Case','Phones & Telecommunications Accessories > Phone Cases')))
      .toMatchObject({kind:'category',category:'Tech',subcategory:null,proposed_subcategory:'Phones'});
    expect(branchCategory(cj('Car Brake Pad','Automobiles & Motorcycles > Car Parts > Brakes'))).toBe('Auto');
    expect(objectIntent('Car Brake Pad')).toMatchObject({category:'Auto',subcategory:'Freinage'});
  });
  test('auto seat organizer cannot become home storage in an Auto supplier branch',()=>{
    expect(decideCategory(ali('Leather Car Seat Gap Organizer','Automobiles, Parts & Accessories > Interior')))
      .toEqual({kind:'review',reason:'OBJECT_SUPPLIER_CATEGORY_CONFLICT'});
  });
  test('Discovery target never counts as supplier branch evidence',()=>{
    expect(decideCategory({supplier_name:'AliExpress',product_name:'Phone Case',
      raw_payload:{discovery:{target_category:'Tech',target_subcategory:'Phones'}}}))
      .toEqual({kind:'review',reason:'SUPPLIER_ROOT_UNMAPPED'});
  });
  test('unknown roots and unsupported suppliers fail closed; no leaf as authority',()=>{
    expect(decideCategory(ali('Silver Necklace','Jewellery & Watches > Jewelry')))
      .toEqual({kind:'review',reason:'SUPPLIER_ROOT_UNMAPPED'});
    expect(decideCategory({supplier_name:'OtherSupplier',product_name:'Phone Case',supplier_category:'Phones > Cases'}))
      .toEqual({kind:'review',reason:'SUPPLIER_ROOT_UNMAPPED'});
    expect(decideCategory(ali('Unclear Random Item','Computer & Office > Computers')))
      .toEqual({kind:'review',reason:'OBJECT_NOT_IDENTIFIED'});
  });
  test('gender ambiguity cannot choose a shoe leaf',()=>{
    expect(decideCategory(ali('Men and Women Casual Shoes','Shoes > Casual Shoes')))
      .toMatchObject({kind:'category',category:'Mode & Beauté',subcategory:null,proposed_subcategory:null});
  });
  test('flagged verdict has category only; source path and active taxonomy are mandatory',async()=>{
    process.env[FLAG]='1';
    const q=qMock();
    const candidate=ali('Silicone Phone Case','Phones & Telecommunications Accessories > Cases');
    const verdict=await resolveCommercialTaxonomyVerdict(q,candidate);
    expect(verdict).toEqual({status:'CATEGORY_AUTO_REVIEW_REQUIRED',
      category:'Tech',subcategory:null,proposed_subcategory:'Phones',
      source:'OBJECT_SUPPLIER_CATEGORY_AGREEMENT',requires_human_subcategory:true});
    expect(q.query).toHaveBeenCalledWith(expect.stringContaining('boutique_categories'),['Tech']);
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .rejects.toThrow('BOUTIQUE_TAXONOMY_UNRESOLVED');
    expect(q.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO products'))).toBe(false);
  });
  test('flagged verdict does not recognize an inactive category',async()=>{
    process.env[FLAG]='1';
    expect(await resolveCommercialTaxonomyVerdict(qMock(false),
      ali('Silicone Phone Case','Phones & Telecommunications Accessories > Cases')))
      .toEqual({status:'REVIEW_REQUIRED',category:null,subcategory:null,source:'CATEGORY_NOT_ACTIVE'});
  });
  test('object/branch disagreement goes to review and never falls back to object-only',async()=>{
    process.env[FLAG]='1';
    const q=qMock();
    const verdict=await resolveCommercialTaxonomyVerdict(q,
      ali('Car Seat Gap Organizer','Automobiles, Parts & Accessories > Seats'));
    expect(verdict).toEqual({status:'REVIEW_REQUIRED',category:null,subcategory:null,
      source:'OBJECT_SUPPLIER_CATEGORY_CONFLICT'});
    expect(q.query.mock.calls.some(([sql])=>sql.includes('object_classification_terms'))).toBe(false);
  });
  test('human-confirmed pairs and already validated supplier mappings remain authoritative',async()=>{
    process.env[FLAG]='1';
    const human=ali('Unrecognized item','Computer & Office > Accessories');
    human.commercial_taxonomy_review={status:'CONFIRMED',category:'Tech',subcategory:'Audio'};
    expect(await resolveCommercialTaxonomyVerdict(qMock(),human))
      .toMatchObject({status:'EXPLICIT_REVIEW',category:'Tech',subcategory:'Audio'});
    const mapped=qMock(true,{category:'Tech',subcategory:'Phones'});
    const verdict=await resolveCommercialTaxonomyVerdict(mapped,
      ali('Unknown object','Phones & Telecommunications Accessories > Mapped Cases'));
    expect(verdict).toMatchObject({status:'AUTO_CLASSIFIED',
      category:'Tech',subcategory:'Phones',source:'CONFIRMED_SUPPLIER_PATH'});
  });
});

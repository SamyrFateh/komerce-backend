/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
jest.mock('../../services/catalog-certification', () => ({certifyCatalogProduct:jest.fn()}));
jest.mock('../../services/catalog-visual-fr-evidence-read', () => ({inspectCatalogVisualFrEvidence:jest.fn()}));
const {certifyCatalogProduct}=require('../../services/catalog-certification');
const {inspectCatalogVisualFrEvidence}=require('../../services/catalog-visual-fr-evidence-read');
const {certifyCatalogProductWithVisualEvidence}=require('../../services/catalog-refinery-combined-proof');
const q={query:jest.fn()};
beforeEach(()=>jest.clearAllMocks());
test('technical green without persisted visual review fails closed',async()=>{
  certifyCatalogProduct.mockResolvedValue({certification:{certified:true,reasons:[]}});
  inspectCatalogVisualFrEvidence.mockResolvedValue({ready:false,code:'VISUAL_FR_REVIEW_PENDING',results:[]});
  expect(await certifyCatalogProductWithVisualEvidence(q,'p1')).toMatchObject({
    certified:false,technical_certified:true,visual_fr_certified:false,publication_performed:false,
  });
});
test('both independent gates required for combined success',async()=>{
  certifyCatalogProduct.mockResolvedValue({certification:{certified:true,reasons:[]}});
  inspectCatalogVisualFrEvidence.mockResolvedValue({ready:true,code:'VISUAL_FR_REVIEWED',results:[]});
  expect(await certifyCatalogProductWithVisualEvidence(q,'p1')).toMatchObject({certified:true,publication_performed:false});
});
test('missing product never fabricates certification',async()=>{
  certifyCatalogProduct.mockResolvedValue(null);
  expect(await certifyCatalogProductWithVisualEvidence(q,'missing')).toBeNull();
  expect(inspectCatalogVisualFrEvidence).not.toHaveBeenCalled();
});

/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const { recordVisualFrReview } = require('../../services/catalog-visual-fr-human-review-write');
const media={id:'00000000-0000-0000-0000-000000000002',source_media_id:'source:1',url:'https://supplier.test/photo.png',option_values:{color:'red'}};
const productId='00000000-0000-0000-0000-000000000001';
const review={source_media_id:'source:1',source_url:media.url,option_values:{color:'red'},text_presence:'NONE'};
test('refuses stale supplier URL without writing',async()=>{
 const q={query:jest.fn().mockResolvedValue({rows:[media]})};
 expect(await recordVisualFrReview(q,{productId,mediaId:media.id,review:{...review,source_url:'https://supplier.test/old.png'},reviewerId:'admin'})).toMatchObject({status:409,code:'SOURCE_IMAGE_OR_VARIANT_CHANGED'});
 expect(q.query).toHaveBeenCalledTimes(1);
});
test('records explicit human no-text review on matching active image',async()=>{
 const q={query:jest.fn().mockResolvedValueOnce({rows:[media]}).mockResolvedValueOnce({rows:[{media_id:media.id}]})};
 expect(await recordVisualFrReview(q,{productId,mediaId:media.id,review,reviewerId:'admin'})).toMatchObject({status:200,ready:true,code:'VISUAL_FR_REVIEW_RECORDED'});
 expect(q.query.mock.calls[1][0]).toContain('cm.source_media_id=$3 AND cm.url=$4');
 expect(q.query.mock.calls[1][1][9]).toBe('admin');
});
test('no reviewer cannot write',async()=>{
 const q={query:jest.fn()};
 expect(await recordVisualFrReview(q,{productId,mediaId:media.id,review,reviewerId:''})).toMatchObject({status:403});
 expect(q.query).not.toHaveBeenCalled();
});
test('unapproved French caption is rejected',async()=>{
 const q={query:jest.fn().mockResolvedValue({rows:[media]})};
 expect(await recordVisualFrReview(q,{productId,mediaId:media.id,review:{...review,text_presence:'PRESENT'},reviewerId:'admin'})).toMatchObject({status:422});
 expect(q.query).toHaveBeenCalledTimes(1);
});

const actor='00000000-0000-0000-0000-000000000003';
const automation={...review,execution_mode:'AUTOMATED_STAGING',run_id:'42919260151'};
test.each([undefined, '', 'production', 'test'])('automation is refused outside explicit staging (%s)',async runtime=>{
 const q={query:jest.fn()};
 expect(await recordVisualFrReview(q,{productId,mediaId:media.id,review:automation,reviewerId:actor},{KOMERCE_ENV:runtime})).toMatchObject({status:403});
 expect(q.query).not.toHaveBeenCalled();
});
test.each([{run_id:''},{run_id:'fake'},{execution_mode:'FAKE'}])('invalid execution proof fails closed %j',async patch=>{
 const q={query:jest.fn()};
 expect((await recordVisualFrReview(q,{productId,mediaId:media.id,review:{...automation,...patch},reviewerId:actor},{KOMERCE_ENV:'staging'})).status).toBeGreaterThanOrEqual(400);
 expect(q.query).not.toHaveBeenCalled();
});
test('automation requires authenticated UUID, TEST sourcing and no prior human review',async()=>{
 const q={query:jest.fn()};
 expect((await recordVisualFrReview(q,{productId,mediaId:media.id,review:automation,reviewerId:'admin'},{KOMERCE_ENV:'staging'})).status).toBe(403);
 for(const scope of [{test_candidate:false},{test_candidate:true,human_review:true},undefined]){
  const db={query:jest.fn().mockResolvedValueOnce({rows:[media]}).mockResolvedValueOnce({rows:scope?[scope]:[]})};
  expect(await recordVisualFrReview(db,{productId,mediaId:media.id,review:automation,reviewerId:actor},{KOMERCE_ENV:'staging'})).toMatchObject({status:403});
  expect(db.query).toHaveBeenCalledTimes(2);
 }
});
test('automation records run and actual actor without impersonating a human',async()=>{
 const q={query:jest.fn().mockResolvedValueOnce({rows:[media]}).mockResolvedValueOnce({rows:[{test_candidate:true,human_review:false}]}).mockResolvedValueOnce({rows:[{media_id:media.id}]})};
 expect(await recordVisualFrReview(q,{productId,mediaId:media.id,review:automation,reviewerId:actor},{KOMERCE_ENV:'staging'})).toMatchObject({status:200,ready:true,execution_mode:'AUTOMATED_STAGING',human_attestation:false});
 expect(q.query.mock.calls[2][1][9]).toBe('automation:github-actions:42919260151:'+actor);
 expect(q.query.mock.calls[2][0]).toContain('WHERE $12::boolean=FALSE');
});
test.each([['bad',media.id],[productId,'bad'],[undefined,undefined],[productId,undefined]])('invalid identities %s %s never query',async(pid,mid)=>{
 const q={query:jest.fn()};
 expect((await recordVisualFrReview(q,{productId:pid,mediaId:mid,review,reviewerId:'admin'})).status).toBe(400);
 expect(q.query).not.toHaveBeenCalled();
});
test('missing media, missing identity, invalid choice and racing source fail closed',async()=>{
 const q=rows=>({query:jest.fn().mockResolvedValueOnce({rows}).mockResolvedValueOnce({rows:[]})});
 expect((await recordVisualFrReview(q([]),{productId,mediaId:media.id,review,reviewerId:'admin'})).status).toBe(404);
 expect((await recordVisualFrReview(q([{...media,source_media_id:null}]),{productId,mediaId:media.id,review,reviewerId:'admin'})).status).toBe(422);
 expect((await recordVisualFrReview(q([media]),{productId,mediaId:media.id,review:{...review,text_presence:'BAD'},reviewerId:'admin'})).code).toBe('TEXT_PRESENCE_INVALID');
 expect((await recordVisualFrReview(q([media]),{productId,mediaId:media.id,review,reviewerId:'admin'})).status).toBe(409);
});
test('missing reviewer and media options are handled without a default approval',async()=>{
 const q={query:jest.fn()};
 expect((await recordVisualFrReview(q,{productId,mediaId:media.id,review})).status).toBe(403);
 const db={query:jest.fn().mockResolvedValueOnce({rows:[{...media,option_values:null}]}).mockResolvedValueOnce({rows:[{media_id:media.id}]})};
 expect((await recordVisualFrReview(db,{productId,mediaId:media.id,review:{...review,option_values:null},reviewerId:'admin'})).status).toBe(200);
});

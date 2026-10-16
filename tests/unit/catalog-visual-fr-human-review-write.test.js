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

/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const { inspectCatalogVisualFrEvidence } = require('../../services/catalog-visual-fr-evidence-read');

const media = {
  supplier_media_id:'ali:image:1', url:'https://cdn.example.test/item.png',
  option_values:{color:'red'},
};

test('no recorded review cannot certify media', async () => {
  const q={query:jest.fn().mockResolvedValue({rows:[media]})};
  const result=await inspectCatalogVisualFrEvidence(q,'p1');
  expect(result).toMatchObject({ready:false,code:'VISUAL_FR_REVIEW_PENDING'});
  expect(q.query.mock.calls[0][1]).toEqual(['p1']);
  expect(q.query.mock.calls[0][0]).toContain('cm.is_active=TRUE');
});
test('review of exact source, locale presentation and variant is accepted', async () => {
  const q={query:jest.fn().mockResolvedValue({rows:[{
    ...media, review_source_media_id:'ali:image:1',source_url:media.url,
    review_option_values:{color:'red'},text_presence:'NONE',
    reviewed_by:'editor',reviewed_at:'2026-10-16T12:00:00Z',
  }]})};
  expect(await inspectCatalogVisualFrEvidence(q,'p1')).toMatchObject({
    ready:true,code:'VISUAL_FR_REVIEWED',
  });
});
test('changed source url invalidates persisted human proof', async () => {
  const q={query:jest.fn().mockResolvedValue({rows:[{
    ...media,review_source_media_id:'ali:image:1',
    source_url:'https://cdn.example.test/older.png',
    review_option_values:{color:'red'},text_presence:'NONE',
    reviewed_by:'editor',reviewed_at:'2026-10-16T12:00:00Z',
  }]})};
  expect(await inspectCatalogVisualFrEvidence(q,'p1')).toMatchObject({
    ready:false,code:'VISUAL_FR_REVIEW_PENDING',
  });
});
test('zero active media is never a valid visual proof',async()=>{
  const q={query:jest.fn().mockResolvedValue({rows:[]})};
  expect(await inspectCatalogVisualFrEvidence(q,'p1')).toMatchObject({
    ready:false,code:'SOURCE_MEDIA_MISSING',
  });
});

test('PostgreSQL timestamptz Date is normalized before evidence validation', async () => {
  const q={query:jest.fn().mockResolvedValue({rows:[{
    ...media, review_source_media_id:'ali:image:1', source_url:media.url,
    review_option_values:{color:'red'}, text_presence:'NONE',
    reviewed_by:'editor', reviewed_at:new Date('2026-10-16T12:00:00.000Z'),
  }]})};
  expect(await inspectCatalogVisualFrEvidence(q,'p1')).toMatchObject({
    ready:true,code:'VISUAL_FR_REVIEWED',
  });
});

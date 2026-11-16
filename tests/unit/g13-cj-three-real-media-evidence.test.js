'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {TARGETS,ALLOWED_HOSTS,guard,sourceURL,detectImage}=require('../../scripts/recette/g13-cj-three-real-media-evidence');
describe('G13 authentic media download owner-only',()=>{
  test('frozen 3 unpublished refs, only allowed CJ CDN',()=>{
    expect(TARGETS).toEqual(['KPR-000245','KPR-000246','KPR-000247']);
    expect(ALLOWED_HOSTS).toContain('cf.cjdropshipping.com');
    expect(sourceURL('https://oss-cf.cjdropshipping.com/product/image.jpeg').hostname).toBe('oss-cf.cjdropshipping.com');
    for(const url of ['https://example.com/image.jpg','http://cf.cjdropshipping.com/img.jpg',
      'https://cf.cjdropshipping.com.evil.com/img.jpg'])
      expect(()=>sourceURL(url)).toThrow();
  });
  const authorized={GITHUB_ACTIONS:'true',GITHUB_ACTOR:'owner',GITHUB_REPOSITORY_OWNER:'owner',
    KOMERCE_ENV:'staging',EXPECTED_RAILWAY_ENVIRONMENT:'staging',
    STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
    PGOPTIONS:'-c default_transaction_read_only=on',G13_MEDIA_SCOPE:'cj-three-authentic',
    GITHUB_RUN_ID:'43820974536'};
  test('must be owner and staging with read-only SQL',()=>{
    expect(guard(authorized)).toBeUndefined();
    for(const patch of [{GITHUB_ACTOR:'worker'},{KOMERCE_ENV:'production'},
      {PGOPTIONS:''},{G13_MEDIA_SCOPE:'all'},{STAGING_BASE_URL:'http://localhost'}])
      expect(()=>guard({...authorized,...patch})).toThrow('G13_MEDIA_GUARD_REFUSED');
  });
  test('reject fake HTML and accept genuine jpeg header',()=>{
    expect(detectImage(Buffer.from('<html>bad image</html>'))).toBeNull();
    expect(detectImage(Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(16)]))).toBe('jpg');
  });
});

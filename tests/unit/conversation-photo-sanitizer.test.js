'use strict';
const {sanitizePhoto,MAX}=require('../../services/conversation-photo-sanitizer');
const JPEG=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDm6KKK8o/UT//Z','base64');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGO8o2zEwMDAxMDAwMDAAAAPIAE1QP4wjgAAAABJRU5ErkJggg==','base64');
const WEBP=Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoCAAIAAUAmJaACdLoAA5gA/u/9w/W17bwyg/+/aX/egH/egH+iwAAA','base64');
const GPS=Buffer.from('GPSLatitude=12.34 GPSLongitude=56.78');
function jpegMeta(marker,payload){
  const h=Buffer.alloc(4);h[0]=255;h[1]=marker;h.writeUInt16BE(payload.length+2,2);
  return Buffer.concat([JPEG.subarray(0,2),h,payload,JPEG.subarray(2)]);
}
function crc32(buf){let c=0xffffffff;for(const x of buf){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function pngMeta(type,payload){
  const h=Buffer.alloc(8);h.writeUInt32BE(payload.length);h.write(type,4);
  const c=Buffer.alloc(4);c.writeUInt32BE(crc32(Buffer.concat([h.subarray(4),payload])));
  return Buffer.concat([PNG.subarray(0,33),h,payload,c,PNG.subarray(33)]);
}
function webpMeta(type,payload){
  const h=Buffer.alloc(8);h.write(type);h.writeUInt32LE(payload.length,4);
  const b=Buffer.concat([WEBP,h,payload,Buffer.alloc(payload.length%2)]);
  b.writeUInt32LE(b.length-8,4);return b;
}
describe('private conversation photos',()=>{
  test.each([[JPEG,'image/jpeg'],[PNG,'image/png'],[WEBP,'image/webp']])('accepts a real image container', (source,mime)=>{
    const result=sanitizePhoto(source);expect(result.mime).toBe(mime);expect(result.size_bytes).toBe(result.content.length);expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);expect(sanitizePhoto(result.content).sha256).toBe(result.sha256);
  });
  test.each([
    [jpegMeta(225,Buffer.concat([Buffer.from('Exif\0\0'),GPS])),JPEG],
    [jpegMeta(254,GPS),JPEG],
    [pngMeta('eXIf',GPS),PNG],
    [pngMeta('tEXt',GPS),PNG],
    [pngMeta('iTXt',GPS),PNG],
    [webpMeta('EXIF',GPS),WEBP],
    [webpMeta('XMP ',GPS),WEBP],
  ])('strips injected location metadata and deduplicates sanitized content',(source,clean)=>{
    const result=sanitizePhoto(source);
    expect(result.content.includes(GPS)).toBe(false);
    expect(result.sha256).toBe(sanitizePhoto(clean).sha256);
  });
  test.each([Buffer.from('GIF89a fake image'),JPEG.subarray(0,JPEG.length-2),Buffer.concat([JPEG,GPS]),PNG.subarray(0,40),WEBP.subarray(0,30),Buffer.alloc(MAX+1)])('fails closed on unsupported or truncated containers',source=>{
    expect(()=>sanitizePhoto(source)).toThrow('Photo invalide');
  });
});

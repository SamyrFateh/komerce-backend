/**
 * @komerce-arch
 * @role          private-conversation-photo-sanitizer
 * @domain        notifications
 * @layer         service
 * @criticality   high
 * @inputs        untrusted image bytes
 * @outputs       sanitized bytes, MIME, digest
 * @depends       node:crypto
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      private_client_conversation, strip_location_metadata
 * @impact-areas  notifications, market-delegation
 */
'use strict';
const { createHash } = require('node:crypto');
const MAX = 5 * 1024 * 1024;
const PNG = Buffer.from([137,80,78,71,13,10,26,10]);
function invalid() {
  throw Object.assign(new Error('Photo invalide ou non assainissable'), {status:415,code:'CONVERSATION_IMAGE_INVALID'});
}
function jpeg(b) {
  const parts=[b.subarray(0,2)];
  let p=2, scans=0, frame=false;
  while(p<b.length) {
    const start=p;
    if(b[p++]!==255) invalid();
    while(p<b.length&&b[p]===255)p++;
    if(p>=b.length)invalid();
    const marker=b[p++];
    if(marker===217) {
      if(!frame||!scans||p!==b.length)invalid();
      parts.push(Buffer.from([255,217]));return Buffer.concat(parts);
    }
    if(marker===0||marker===216||marker===1||(marker>=208&&marker<=215)||p+2>b.length)invalid();
    const length=b.readUInt16BE(p);
    if(length<2||p+length>b.length)invalid();
    const end=p+length;
    // Keep only structural segments and JFIF/Adobe markers with fixed known format;
    // discard every other APP segment and comments (Exif, XMP, IPTC, ICC etc.).
    const app=marker>=224&&marker<=239;
    if(app){
      const payload=b.subarray(p+2,end);
      if(marker===224&&payload.length===14&&payload.subarray(0,5).equals(Buffer.from('JFIF\0'))&&payload[12]===0&&payload[13]===0)parts.push(b.subarray(start,end));
      else if(marker===238&&payload.length===12&&payload.subarray(0,5).equals(Buffer.from('Adobe')))parts.push(b.subarray(start,end));
    }else if(marker!==254){
      if(![192,193,194,196,219,221,218].includes(marker))invalid();
      if([192,193,194].includes(marker)){if(frame||length<11||!b.readUInt16BE(p+3)||!b.readUInt16BE(p+5))invalid();frame=true}
      parts.push(b.subarray(start,end));
    }
    p=end;
    if(marker===218){
      if(!frame||length<6)invalid();scans++;
      const from=p;let next=false;
      while(p<b.length){
        if(b[p++]!==255)continue;
        const mark=p-1;
        while(p<b.length&&b[p]===255)p++;
        if(p>=b.length)invalid();
        if(b[p]===0||(b[p]>=208&&b[p]<=215)){p++;continue;}
        parts.push(b.subarray(from,mark));p=mark;next=true;break;
      }
      if(!next)invalid();
    }
  }
  invalid();
}
function crc32(buf){
  let c=0xffffffff;
  for(const x of buf){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}
  return (c^0xffffffff)>>>0;
}
function png(b){
  let p=8,header=false,data=false,endedData=false;
  const parts=[PNG];
  const allowed=new Set(['IHDR','PLTE','IDAT','IEND','tRNS','gAMA','cHRM','sRGB','sBIT','bKGD','pHYs']);
  while(p+12<=b.length){
    const len=b.readUInt32BE(p),end=p+12+len;
    if(end>b.length)invalid();
    const type=b.toString('ascii',p+4,p+8);
    if(!/^[A-Za-z]{4}$/.test(type)||crc32(b.subarray(p+4,end-4))!==b.readUInt32BE(end-4))invalid();
    if(!header&&type!=='IHDR')invalid();
    if(type==='IHDR'){if(header||len!==13||!b.readUInt32BE(p+8)||!b.readUInt32BE(p+12))invalid();header=true}
    if(type==='IDAT'){if(endedData)invalid();data=true}else if(data)endedData=true;
    if(type==='IEND'){if(len!==0||!data||end!==b.length)invalid();parts.push(b.subarray(p,end));return Buffer.concat(parts)}
    if(['acTL','fcTL','fdAT'].includes(type))invalid();
    if(allowed.has(type))parts.push(b.subarray(p,end));
    else if(type[0]===type[0].toUpperCase())invalid();
    p=end;
  }
  invalid();
}
function webp(b){
  if(b.length<20||b.readUInt32LE(4)!==b.length-8)invalid();
  let p=12,frames=0,extended=false,alpha=false;
  const parts=[];
  while(p+8<=b.length){
    const type=b.toString('ascii',p,p+4),len=b.readUInt32LE(p+4),end=p+8+len+(len%2);
    if(end>b.length||(len%2&&b[end-1]!==0))invalid();
    if(type==='VP8X'){
      if(extended||p!==12||len!==10)invalid();
      const chunk=Buffer.from(b.subarray(p,end));
      if(chunk[8]&0x02)invalid(); // no animated payload
      chunk[8]&=~0x2c; // clear ICC, EXIF, XMP flags
      parts.push(chunk);extended=true;
    }else if(type==='VP8 '||type==='VP8L'){
      if(++frames!==1||len<5||(type==='VP8L'&&b[p+8]!==0x2f))invalid();
      if(type==='VP8 '&&(len<10||!b.subarray(p+11,p+14).equals(Buffer.from([0x9d,1,0x2a]))))invalid();
      parts.push(b.subarray(p,end));
    }else if(type==='ALPH'){
      if(!extended||alpha||frames||len===0)invalid();alpha=true;parts.push(b.subarray(p,end));
    }else if(type==='ANIM'||type==='ANMF')invalid();
    // Drop all metadata and unknown chunks, including EXIF/XMP/ICCP.
    p=end;
  }
  if(p!==b.length||frames!==1)invalid();
  const header=Buffer.from(b.subarray(0,12));
  header.writeUInt32LE(4+parts.reduce((n,x)=>n+x.length,0),4);
  return Buffer.concat([header,...parts]);
}
function sanitizePhoto(input){
  if(!Buffer.isBuffer(input)||input.length<12||input.length>MAX)invalid();
  let content,mime;
  if(input[0]===255&&input[1]===216){mime='image/jpeg';content=jpeg(input)}
  else if(input.subarray(0,8).equals(PNG)){mime='image/png';content=png(input)}
  else if(input.toString('ascii',0,4)==='RIFF'&&input.toString('ascii',8,12)==='WEBP'){mime='image/webp';content=webp(input)}
  else invalid();
  return {content,mime,size_bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')};
}
module.exports={sanitizePhoto,MAX};

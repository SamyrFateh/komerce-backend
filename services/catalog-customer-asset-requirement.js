/** @komerce-arch-lite
 * @role buyer-photo-source-evidence
 * @domain catalog
 * @layer service
 * @owner backend-core
 * @purpose Narrow proof that customer's image is mandatory before selling a supplier product.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,checkout,orders
 */
'use strict';
function normalize(input){
 return String(input||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
   .toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function requiresBuyerImage(sourceName){
 const t=normalize(sourceName);
 // Explicit image-upload instruction OR specifically a customer's custom
 // photo blanket. A generic 'personalized' or stock-photo product is not enough.
 return /\b(?:must|please|need to|required to) upload (?:the |your |an? )?(?:image|photo|picture)\b/.test(t)
   || /\bupload (?:the |your |an? )?(?:image|photo|picture) (?:required|mandatory)\b/.test(t)
   || /\b(?:custom|personalized|personalised) photo blankets?\b/.test(t)
   || /\bphoto blankets? (?:custom|personalized|personalised)\b/.test(t);
}
module.exports={requiresBuyerImage};
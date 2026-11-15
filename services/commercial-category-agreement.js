/** @komerce-arch-lite
 * @role frozen-commercial-object-supplier-category-agreement
 * @domain catalog
 * @layer service
 * @owner backend-core
 * @purpose Guarded category-only decision from independent item-title object and supplier-origin category root.
 * @db-read none
 * @db-write none
 * @impact-areas catalog, sourcing, catalogue-review
 */
'use strict';

// Category-only classifier: no subcategory is ever authoritative here.
// Root dictionary and object rules are explicitly versioned, not trained
// against the live products being classified. Discovery is not a source fact.
const FLAG='KOMERCE_COMMERCIAL_CATEGORY_AUTO_V1';
const ROOT_CJ=Object.freeze({
  'home, garden & furniture':'Maison',
  'automobiles & motorcycles':'Auto',
  'health, beauty & hair':'Mode & Beauté',
  'home improvement':'Bricolage',
  "women's clothing":'Mode & Beauté',
  "men's clothing":'Mode & Beauté',
  'consumer electronics':'Tech',
  'phones & accessories':'Tech',
  'bags & shoes':'Mode & Beauté',
});
const ROOT_ALI=Object.freeze({
  'phones & telecommunications accessories':'Tech',
  'consumer electronics':'Tech',
  'computer & office':'Tech',
  'automobiles, parts & accessories':'Auto',
  'shoes':'Mode & Beauté',
  "men's clothing":'Mode & Beauté',
  // Deliberate omissions: Mother & Kids, Toys & Hobbies, Jewellery and
  // other roots without an independently supported single active category.
});
const OBJECT_RULES=Object.freeze([
  [/phone (holder|stand|mount|case|shell|lanyard)|car phone|phone case|charging cable|usb c|type ?c|charger cable|smartphone|unlocked phone|mobile phone charger|5g .*phone/,'Tech','Phones'],
  [/watch (band|box|packaging)|gift box|gift bag|gift card|wrapping paper|gift paper|photo album|keychain/,'Créations personnelles','Cadeau'],
  [/smart ?watch|quartz|wrist ?watch|digital watch|\bwatch\b/,'Tech','Montres'],
  [/earbuds?|earphones?|headphones?|headsets?|speaker|microphone|audio|bluetooth (adapter|transmitter|receiver)/,'Tech','Audio'],
  [/brake|master cylinder|caliper/,'Auto','Freinage'],
  [/cabin air filter|air filter|air cleaner|oil filter/,'Auto','Filtres'],
  [/fog light|headlight|car .*light|led .*car|car light|drl/,'Auto','Éclairage'],
  [/motorcycle/,'Auto','Moto'],
  [/dash ?cam|rearview|driving recorder|car (sticker|alarm|vacuum|drill sticker)|automobile sticker/,'Auto','Accessoires'],
  [/ride on|toy car|\btoy\b|plush/,'Maison','Enfants'],
  [/pencil (case|bag)|stationery|school|backpack|watercolor/,'Maison','Enfants'],
  [/smoke alarm|door .*alarm|window .*alarm|alarm|padlock|smart lock|safe |lockout|door chime|sensor alarm|safety lock/,'Bricolage','Sécurité'],
  [/solar panel|solar (wire|cable|connector)|nm b wire|power strip|power cord|generator cord|extension cable|fish tape|wire (spool|puller)|cable (dispenser|locator)/,'Bricolage','Electricité'],
  [/drill|screwdriver|pliers|wrench|crimping|tool set|garden tool|thermal imaging|screw extractor|sharpener|doweling/,'Bricolage','Outillage'],
  [/sublimation|heat press|heat transfer|custom photo|custom mug|engraving/,'Créations personnelles','Impression'],
  [/lunch (bag|box)|kitchen|cookware|mug|egg poacher|hot pot|garlic|dumpling|bottle opener|tableware|sink (tray|caddy)|tea /,'Maison','Cuisine'],
  [/organizer|shoe rack|garment rack|wardrobe|storage cabinet|file cabinet|filing cabinet|rolling cart|wall hook|umbrella holder|toothpaste holder/,'Maison','Rangement'],
  [/wall decor|home decor|wall sticker|party decoration|holiday decor|artificial flower|photo frame|banner|decorative light|lamp/,'Maison','Déco'],
  [/lumbar support|fan\b/,'Maison','Confort'],
  [/makeup|lip gloss|eyebrow|nail (drill|file)|manicure|blackhead|acne|skin care|hair care|tattoo sticker|beauty/,'Mode & Beauté','Beauté'],
  [/\bmen'?s?\b.*(shoes|pants|shirt|suit|sweater|vest|loafers|slippers|shorts|clothing)|(shoes|pants|shirt|suit|loafers|slippers|shorts|sweater).*\bmen\b|for men\b/,'Mode & Beauté','Homme'],
  [/women|ladies|female|dress|blouse|camisole|high heels/,'Mode & Beauté','Femme'],
  [/necklace|bracelet|ring\b|pendant|crown|headband|tote|bag\b|sneakers|shoes|clothing/,'Mode & Beauté',null],
]);
function canonicalText(value) {
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function objectIntent(title){
  const t=canonicalText(title);
  if(!t)return null;
  if(/\b(men and women|men women|for men and)\b/.test(t)){
    return /\b(clothing|coat|tops|cape|shoes)\b/.test(t)
      ? {category:'Mode & Beauté',subcategory:null} : null;
  }
  for(const [pattern,category,subcategory] of OBJECT_RULES){
    if(pattern.test(t))return {category,subcategory};
  }
  return null;
}
function branchCategory(candidate={}){
  const provider=String(candidate.normalized_source_contract?.supplier_name||
    candidate.supplier_name||'').trim().toLowerCase();
  const map=provider==='aliexpress'?ROOT_ALI
    :['cj','cjdropshipping'].includes(provider)?ROOT_CJ:null;
  if(!map)return null;
  const path=String(candidate.supplier_category||
    candidate.normalized_source_contract?.supplier_category||'').trim();
  // Only supplier-provided provenance is allowed. Never read discovery_target.
  if(!path)return null;
  const root=path.split('>')[0].trim().toLowerCase().replace(/\s+/g,' ');
  return map[root]||null;
}
function enabled(env=process.env){return env[FLAG]==='1';}
function eligibleSupplier(candidate={}){
  const name=String(candidate.normalized_source_contract?.supplier_name||
    candidate.supplier_name||'').trim().toLowerCase();
  return ['aliexpress','cj','cjdropshipping'].includes(name);
}
function decideCategory(candidate={}){
  const obj=objectIntent(candidate.product_name);
  const branch=branchCategory(candidate);
  if(!branch)return {kind:'review',reason:'SUPPLIER_ROOT_UNMAPPED'};
  if(!obj)return {kind:'review',reason:'OBJECT_NOT_IDENTIFIED'};
  if(obj.category!==branch)
    return {kind:'review',reason:'OBJECT_SUPPLIER_CATEGORY_CONFLICT'};
  return {kind:'category',category:branch,subcategory:null,
    proposed_subcategory:obj.subcategory,source:'OBJECT_SUPPLIER_CATEGORY_AGREEMENT'};
}
module.exports={FLAG,ROOT_CJ,ROOT_ALI,objectIntent,branchCategory,enabled,eligibleSupplier,decideCategory};

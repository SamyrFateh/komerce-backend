/** @komerce-arch-lite
 * @role supplier-neutral-commercial-object-family
 * @domain catalog
 * @layer service
 * @owner backend-core
 * @purpose Place an item at a verified boutique CATEGORY only if its source hierarchy and actual object title corroborate an object family.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,sourcing,certification
 */
'use strict';
const {words}=require('./commercial-taxonomy-semantics');

// Small provider-independent OBJECT families, not supplier path mappings.
// A generic source root such as "Home Storage" or a Discovery search intent
// alone cannot attest that an unknown item belongs to a boutique category.
// Two facts from the supplier are corroborating, NOT statistically independent.
const OBJECT_FAMILIES=Object.freeze([
  {type:'jewelry',category:'Mode & Beauté',
    object:/\b(rings?|earrings?|necklaces?|pendants?|bracelets?|jewelry|jewellery|bijoux|colliers?|bagues?)\b/,
    source:/\b(jewelry|jewellery|fashion jewelry|bijoux|accessories|accessoires)\b/},
  {type:'cosmetics',category:'Mode & Beauté',
    object:/\b(lip gloss|lipstick|mascara|eyeliner|makeup|cosmetic|skin care|skincare|face cream|nail polish|perfume|fragrance|maquillage)\b/,
    source:/\b(health beauty|beauty|makeup|cosmetics|skin care|skincare|maquillage)\b/},
  {type:'shoes',category:'Mode & Beauté',
    object:/\b(shoes?|sneakers?|sandals?|slippers?|boots?|footwear|chaussures?|baskets?)\b/,
    source:/\b(shoes?|footwear|chaussures?|bags shoes|boys shoes|girls shoes)\b/},
  {type:'apparel',category:'Mode & Beauté',
    object:/\b(coats?|dresses?|dress|jackets?|shirts?|pants?|shorts?|trousers?|skirts?|hoodies?|clothing sets?|onesies?|rompers?|jumpsuits?|suits?)\b/,
    source:/\b(clothing|clothes|apparel|wear|vetements?|tops sets|outerwear|mens|womens|girls clothing|boys clothing|baby clothing)\b/},
  {type:'smartphone',category:'Tech',
    object:/\b(smartphones?|mobile phones?|cell phones?|tablets?|iphone|android phones?)\b/,
    source:/\b(phones accessories|mobile phones|smart phones|consumer electronics|tablets)\b/},
  {type:'audio',category:'Tech',
    object:/\b(headphones?|earphones?|earbuds?|speakers?|headsets?|microphones?|audio amplifiers?)\b/,
    source:/\b(consumer electronics|portable audio|home audio|earphones|headphones|audio video)\b/},
  {type:'smartwatch',category:'Tech',
    object:/\b(smart ?watches?|fitness trackers?|smart ?bands?)\b/,
    source:/\b(smart watches|smart electronics|consumer electronics|watches)\b/},
  {type:'kitchen',category:'Maison',
    object:/\b(kitchen|cookware|pans?|garlic press|utensils?|cutlery|cooking|spatulas?|kettles?|dinnerware)\b/,
    source:/\b(home garden|kitchen|dining|cooking|cookware|household|maison)\b/},
  {type:'storage',category:'Maison',
    object:/\b(shoe rack|garment rack|closet organizer|storage boxes?|storage bins?|shelves?|shelf|cabinet|organizers?|storage containers?)\b/,
    source:/\b(home garden|home storage|furniture|closet|household|maison)\b/},
  {type:'decor',category:'Maison',
    object:/\b(wall decor|wall art|wall signs?|home decor|decorative paintings?|vases?|picture frames?|wall hanging|table lamps?)\b/,
    source:/\b(home garden|home decor|home storage|furniture|wall decor|household)\b/},
  {type:'handtools',category:'Bricolage',
    object:/\b(drills?|wrenches?|screwdrivers?|pliers?|pliers sets?|crimping tools?|garden tools?|hand tools?|power tools?|tool sets?)\b/,
    source:/\b(home improvement|hand tools|power tools|garden tools|tool sets|hardware|bricolage)\b/},
  {type:'autoparts',category:'Auto',
    object:/\b(brake (?:caliper|rotor|disc|pads?|bleeder)|oil filters?|air filters?|cabin filters?|headlights?|fog lights?|tail lights?|engine parts?|car mirrors?|motorcycle (?:mirrors?|parts?|accessories)|auto replacement parts?)\b/,
    source:/\b(automobiles|motorcycles|auto replacement|car parts|car lights|motorcycle accessories)\b/},
]);
// An object family has a single canonical parent. Two incompatible matched
// roots are an explicit conflict, never a guess based on highest score.
function categoryIntent(candidate={}) {
  const title=words(candidate.product_name);
  const supplierPath=words(candidate.supplier_category||candidate.normalized_source_contract?.supplier_category);
  if(!title||!supplierPath)return {kind:'none',source:'OBJECT_OR_SUPPLIER_PATH_MISSING'};
  const matched=OBJECT_FAMILIES.filter(f=>f.object.test(title)&&f.source.test(supplierPath));
  const categories=[...new Set(matched.map(x=>x.category))];
  if(categories.length>1)
    return {kind:'conflict',source:'MULTIPLE_OBJECT_ROOT_CONFLICT',
      categories,evidence:matched.map(x=>x.type)};
  if(categories.length===1)
    return {kind:'category',category:categories[0],subcategory:null,
      level:'CATEGORY',source:'SOURCE_AND_OBJECT_ROOT_CORROBORATED',
      evidence:matched.map(x=>x.type)};
  return {kind:'none',source:'NO_CORROBORATED_OBJECT_ROOT'};
}
module.exports={OBJECT_FAMILIES,categoryIntent};

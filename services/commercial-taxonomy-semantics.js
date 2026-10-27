/** @komerce-arch-lite
 * @role commercial-taxonomy-semantic-intent
 * @domain catalog
 * @layer service
 * @owner backend-core
 * @purpose Interpret supplier-independent hierarchy and actual item identity; no customs or provider-specific maps.
 * @db-read none
 * @db-write none
 * @impact-areas catalog, sourcing, supplier-import
 */
'use strict';
function words(input) {
  return String(input || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// Concepts multilingues appartenant au catalogue, jamais aux noms de fournisseurs.
// Une expression de genre seule ne suffit jamais à identifier un article.
const FEMALE_CLOTHING = /\b(womens? clothing|womens? apparel|ladies clothing|female clothing|ropa de mujer(?:es)?|vetements? femme(?:s)?|mode femme(?:s)?|damenbekleidung)\b/;
const MALE_CLOTHING = /\b(mens? clothing|mens? apparel|male clothing|ropa de hombre(?:s)?|vetements? homme(?:s)?|herrenbekleidung)\b/;
// Provider-neutral child apparel evidence: the actual supplier breadcrumb,
// not a discovery keyword such as "kids" or a destination preselected by search.
const CHILD_CLOTHING = /\b(?:girls?|boys?|bab(?:y|ies)|kids?|child(?:ren|rens)?|toddlers?|infants?) (?:clothing|clothes|apparel|garments?|wear)\b|\b(?:ropa infantil|vetements? enfants?|kinderbekleidung|moda infantil|roupa infantil)\b/;
const CHILD_GARMENT = /\b(?:onesies?|rompers?|jumpsuits?|bodysuits?|pajamas?|pyjamas?|dresses?|shirts?|tops?|shorts?|pants?|trousers?|coats?|jackets?|outfits?|suits?|sets?|skirts?|robes?|chemises?|combinaisons?)\b/;
const ADULT_TITLE = /\b(?:womens?|ladies|female|femmes?|mens?|male|hommes?|mujer(?:es)?|hombre(?:s)?)\b/;
const CLOTHING_OBJECT = /\b(shirts?|t shirts?|tees?|tops?|dresses?|blouses?|skirts?|shorts?|pants?|trousers?|jackets?|blazers?|coats?|vests?|pullovers?|hoodies?|sweaters?|robes?|chemises?|jupes?|pantalons?|vestes?)\b/;
const NON_CLOTHING_OBJECT = /\b(rings?|necklaces?|pendants?|earrings?|bracelets?|watches?|jewelry|jewellery|bijoux|colliers?|bagues?|parfums?|sprays?|detergents?|repellent|cleaners?|treater|paintings?|canvases?|kennels?|pet beds?)\b/;
const NON_STORAGE_OBJECT = /\b(stain treater|stain removers?|insect repellents?|mosquito repellents?|pest sprays?|cleaning sprays?|cleaners?|paintings?|canvas prints?|wall art|tableaux?)\b/;

function pairAvailable(pairs, category, subcategory) {
  return (pairs || []).some(p => p.category === category && p.subcategory === subcategory);
}
function semanticIntent(candidate = {}) {
  const source = words(candidate.supplier_category || candidate.normalized_source_contract?.supplier_category);
  const title = words(candidate.product_name);
  const female = FEMALE_CLOTHING.test(source), male = MALE_CLOTHING.test(source);
  const child = CHILD_CLOTHING.test(source);
  if (child) {
    if (female || male || ADULT_TITLE.test(title) || NON_CLOTHING_OBJECT.test(title))
      return {kind:'conflict',reason:'CHILD_APPAREL_SOURCE_OBJECT_CONTRADICTION'};
    // The supplier must identify apparel AND the item title must independently
    // identify a garment. Baby blankets, jewelry, toys or hats cannot gain an
    // apparel classification from a broad child-related breadcrumb alone.
    if (CHILD_GARMENT.test(title))
      return {kind:'pair',category:'Mode & Beauté',subcategory:'Enfant',
        source:'SEMANTIC_SUPPLIER_HIERARCHY'};
    return {kind:'none'};
  }
  const oppositeGender = (female && /\b(mens?|male|hommes?|hombre|herren)\b/.test(title))
    || (male && /\b(womens?|female|femmes?|mujer|damen|ladies)\b/.test(title));
  if (female || male) {
    if (female && male || oppositeGender || NON_CLOTHING_OBJECT.test(title))
      return {kind:'conflict',reason:'CLOTHING_SOURCE_OBJECT_CONTRADICTION'};
    if (CLOTHING_OBJECT.test(title) || CLOTHING_OBJECT.test(source))
      return {kind:'pair',category:'Mode & Beauté',subcategory:female?'Femme':'Homme',
        source:'SEMANTIC_SUPPLIER_HIERARCHY'};
  }
  return {kind:'none'};
}
function semanticConflict(candidate = {}, mapped = {}) {
  const title = words(candidate.product_name);
  if (mapped.category==='Maison' && mapped.subcategory==='Rangement'
    && NON_STORAGE_OBJECT.test(title))
    return 'SOURCE_OBJECT_CONTRADICTS_STORAGE_MAPPING';
  if (mapped.category==='Mode & Beauté' && ['Femme','Homme','Enfant'].includes(mapped.subcategory)) {
    const concept=semanticIntent(candidate);
    if (concept.kind==='conflict') return concept.reason;
    if (concept.kind==='pair' && concept.subcategory!==mapped.subcategory)
      return 'CLOTHING_GENDER_CONFLICT';
    if (NON_CLOTHING_OBJECT.test(title)) return 'NON_CLOTHING_OBJECT_IN_APPAREL';
  }
  return null;
}
module.exports={words,semanticIntent,semanticConflict,pairAvailable};
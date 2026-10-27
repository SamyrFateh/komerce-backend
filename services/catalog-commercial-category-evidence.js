/** @komerce-arch-lite
 * @role commercial-category-object-evidence
 * @domain catalog
 * @layer service
 * @owner backend-core
 * @purpose Corroborate a boutique parent with supplier hierarchy AND product object identity.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,sourcing
 */
'use strict';

const {words}=require('./commercial-taxonomy-semantics');

// Curated, supplier-agnostic OBJECT families. A supplier path is context, not
// authority: the same source feed can put chargers under "Home Storage" and
// earbuds under "Jewelry". Require a title object independently supporting the
// proposed parent. Never use Discovery keywords or customs for this purpose.
//
// Do not generalize on one human review automatically. New families/phrases
// should be added only with human-reviewed positives AND adversarial negatives.
const FAMILIES=[
  {id:'fashion_apparel',category:'Mode & Beauté',
    path:/^(?:women s clothing|men s clothing)\b/,
    object:/\b(?:coats?|dresses?|shirts?|blouses?|skirts?|jackets?|sweaters?|hoodies?|trousers?|pants?|vests?|tops?|shorts?|clothing|suits?)\b/},
  {id:'fashion_footwear',category:'Mode & Beauté',
    path:/^(?:bags shoes|sports outdoors sneakers|toys kids babies shoes bags)\b/,
    object:/\b(?:shoes?|sneakers?|high heels?|boots?|sandals?|loafers?|slippers?|pumps?|cleats?)\b/},
  {id:'fashion_beauty',category:'Mode & Beauté',
    path:/^health beauty hair\b/,
    object:/\b(?:makeup|cosmetics?|eyeliner|eyebrow|lipstick|eyelash|mascara|skin care|facial|nail|manicure|pedicure|hairbrush|makeup brush|beauty tools?)\b/},
  {id:'fashion_jewelry',category:'Mode & Beauté',
    path:/^jewelry watches\b/,
    object:/\b(?:watches?|wristwatch|quartz|bracelets?|necklaces?|earrings?|pendants?|rings?|jewelry|jewellery|brooch)\b/},
  {id:'fashion_bags',category:'Mode & Beauté',
    path:/^bags shoes\b/,
    object:/\b(?:handbags?|purses?|tote bags?|shoulder bags?|fashion backpacks?)\b/},
  {id:'home_household',category:'Maison',
    path:/^home garden furniture\b/,
    object:/\b(?:storage|organizers?|cabinets?|shel(?:f|ves)|racks?|hampers?|furniture|tables?|chairs?|beds?|sofas?|benches?|kitchen|coffee pot|cookware|utensils?|egg boiler|caddy|towels?|lamps?|decor|tapestry|vases?|wall art|paintings?|posters?|pillows?|blankets?|cushions?|drinkware|cups?|mugs?|curtains?|baskets?)\b/},
  {id:'home_children',category:'Maison',
    path:/^toys kids babies\b/,
    object:/\b(?:toys?|plush|dolls?|strollers?|baby stroller|school bags?|pencil cases?|baby beds?|nursery furniture)\b/},
  {id:'home_lighting',category:'Maison',
    path:/^home improvement indoor lighting\b/,
    object:/\b(?:lamps?|decorative light|bedside light|night lights?|wall lights?)\b/},
  {id:'tech_phone',category:'Tech',
    path:/^phones accessories\b/,
    object:/\b(?:phones?|smartphones?|chargers?|charging|usb|cables?|bluetooth|phone cases?|phone holders?|phone stands?|touchscreens?|tablets?)\b/},
  {id:'tech_audio',category:'Tech',
    path:/^consumer electronics\b/,
    object:/\b(?:earbuds?|earphones?|headphones?|headsets?|microphones?|speakers?|audio|stereo|bluetooth|smartwatches?|smart watch|wireless receiver|media player|sound mixer)\b/},
  {id:'tech_office',category:'Tech',
    path:/^computer office\b/,
    object:/\b(?:printers?|laminators?|keyboards?|scanners?|computers?|laptops?|tablets?|monitors?)\b/},
  {id:'tools',category:'Bricolage',
    path:/^home improvement\b/,
    object:/\b(?:drill(?:s|ing)?|screwdrivers?|wrenches?|ratchets?|saws?|pliers?|power tools?|hand tools?|garden tools?|soldering|multimeters?|drill bits?|hammers?|spanners?|workbench|router bits?|socket sets?|tool sets?|tool kits?|crimpers?|woodworking)\b/},
  {id:'vehicle_part',category:'Auto',
    path:/^automobiles motorcycles\b/,
    object:/\b(?:cars?|automotive|automobiles?|motorcycles?|vehicle|fuel|brakes?|calipers?|rotors?|air filters?|cabin filters?|engines?|dashboards?|windshields?|wipers?|headlights?|taillights?|steering|bumpers?|radiators?|seat belts?|exhaust|clutch|tires?|tyres?|suspension|transmission)\b/},
];

/**
 * Conservative two-source category proposal. Returns null when either proof is
 * missing or when the title contains objects from multiple parent universes.
 * A single independent ambiguous product remains in review, not AUTO.
 */
function categoryCorroboratedByObject(candidate={}){
  const title=words(candidate.product_name);
  const path=words(candidate.supplier_category||candidate.normalized_source_contract?.supplier_category);
  if(!title||!path) return null;
  const titleHits=FAMILIES.filter(f=>f.object.test(title));
  const categories=new Set(titleHits.map(f=>f.category));
  if(categories.size!==1) return null;
  const matched=titleHits.filter(f=>f.path.test(path));
  if(!matched.length) return null;
  const category=matched[0].category;
  if(!matched.every(f=>f.category===category)) return null;
  return {category,subcategory:null,level:'CATEGORY',
    source:'SUPPLIER_PATH_AND_OBJECT',
    evidence:{object_families:matched.map(f=>f.id),supplier_root:path.split(/\s+(?:>\s*)?/)[0]||null}};
}
module.exports={categoryCorroboratedByObject};

/** @komerce-arch-lite
 * @role cj-classification-counter-audit
 * @domain catalog
 * @layer script
 * @owner backend-core
 * @purpose Flag risky classifications independently of the commercial classifier.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,sourcing,isolated-ci
 */
'use strict';
// Flags are review signals, never labels, accuracy claims, or permission to publish.
const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
function signalsFor(item){
  const title=norm(item.product_name), path=norm(item.supplier_category),flags=[];
  const add=(code,priority,why)=>flags.push({code,priority,why});
  if(/\b(?:must upload (?:the )?image|upload (?:your )?(?:photo|image)|photo personalized|personalized (?:photo|image)|custom photo)\b/.test(title))
    add('CUSTOMER_ASSET_OR_PHOTO','P0','Personalized asset may require a different commercial root');
  else if(/\b(?:customized|personalized|engraving|engraved|sublimation)\b/.test(title)
    && /\b(?:mugs?|tumblers?|blankets?|jewelry|rings?|bracelets?|necklaces?|gift|photo|keychains?|ornaments?)\b/.test(title))
    add('CUSTOM_OBJECT_ROOT_ARBITRATION','P1','Maison/Mode vs Creations personnelles needs editorial policy');
  if(/\b(?:press|sublimation)\b/.test(title)&&/\b(?:machine|oven|press set|printer)\b/.test(title)
    && /\b(?:mugs?|tumblers?|cups?|films?)\b/.test(title))
    add('BUNDLED_EQUIPMENT_AND_GOODS','P0','Machine bundled with goods is not just its included item');
  if(/\bplush\s+(?:backpacks?|bags?|purses?)\b/.test(title))
    add('MATERIAL_NOT_PRODUCT_IDENTITY','P0','Plush is material for bag, not a toy identity');
  const tech=/\b(?:smartphones?|wireless earbuds?|bluetooth earbuds?|bluetooth headphones?|bluetooth speakers?|usb ?c (?:wall )?chargers?|usb ?c (?:data )?cables?|mobile phone chargers?|wireless (?:lavalier )?microphones?|gaming headsets?|earphones?|smartwatches?)\b/.test(title);
  if(tech&&!/^(?:phones accessories|consumer electronics|computer office)\b/.test(path))
    add('SOURCE_PATH_CONFLICT_TECH','P1','Technical object in inconsistent supplier hierarchy');
  const tool=/\b(?:impact wrench|drill bits?|magnetic drills?|wire strippers?|crimping tools?|wire tracers?|cable locators?|screw extractors?)\b/.test(title)
    && !/\b(?:nail drills?|manicure|pedicure|eyelash|makeup)\b/.test(title);
  if(tool&&!/^home improvement\b/.test(path))
    add('SOURCE_PATH_CONFLICT_TOOL','P1','Installation tool in inconsistent supplier hierarchy');
  const auto=/\b(?:cabin air filters?|brake calipers?|brake (?:master cylinders?|bleeders?|rotors?|lines?|pipes?)|fuel filters?|car (?:headlights?|fog lights?|interior lights?|dash cams?)|motorcycle (?:air filters?|headlights?|rearview mirrors?))\b/.test(title)
    && !/\b(?:toy|ride on|kids|children)\b/.test(title);
  if(auto&&!/^automobiles motorcycles\b/.test(path))
    add('SOURCE_PATH_CONFLICT_AUTO','P1','Vehicle component in inconsistent supplier hierarchy');
  if(/\b(?:car phone holders?|motorcycle phone holders?|motorcycle riding (?:gloves|bags?)|car bluetooth (?:chargers?|stereo))\b/.test(title))
    add('MULTI_UNIVERSE_ACCESSORY','P1','Object spans Auto/Tech/Mode merchandising decisions');
  if(/^(?:(?:universal|generic|assorted|various|general) )?(?:motorcycle|car|automobile|auto|vehicle|bike|scooter)(?: (?:modification|replacement|general|universal))? (?:accessories|parts|products|items)$/.test(title))
    add('INSUFFICIENT_OBJECT_IDENTITY','P0','The title merely repeats a supplier category without identifying an item');
  if(title.split(' ').filter(Boolean).length<=2&&item.verdict!=='REVIEW_REQUIRED')
    add('LOW_INFORMATION_CLASSIFICATION','P1','A short title needs corroborated product identity');
  return flags;
}
function buildCounterAudit(decisions=[]){
  const refs=new Set(),titles=new Map(),byCode={},byStatus={},flagged=[];
  for(const d of decisions){
    if(!d.candidate_ref||refs.has(d.candidate_ref))throw Error('COUNTER_AUDIT_DUPLICATE_REF');
    refs.add(d.candidate_ref);
    const flags=signalsFor(d);
    if(flags.length){
      flagged.push({candidate_ref:d.candidate_ref,product_name:d.product_name,
        supplier_category:d.supplier_category,verdict:d.verdict,
        proposed_category:d.category||null,proposed_subcategory:d.subcategory||null,flags});
      byStatus[d.verdict]=(byStatus[d.verdict]||0)+1;
      for(const f of flags)byCode[f.code]=(byCode[f.code]||0)+1;
    }
    const key=norm(d.product_name);
    if(!titles.has(key))titles.set(key,[]);
    titles.get(key).push(d);
  }
  const groups=[],disagreements=[];
  for(const [title,items] of titles){
    if(items.length<2)continue;
    const detail={normalized_title:title,refs:items.map(d=>d.candidate_ref),
      distinct_decisions:new Set(items.map(d=>JSON.stringify([d.verdict,d.category,d.subcategory]))).size};
    groups.push(detail);
    if(detail.distinct_decisions>1)disagreements.push(detail);
  }
  return {contract:'CJ_COUNTER_AUDIT_RISKS_V1',data_count:decisions.length,
    flagged_count:flagged.length,flag_counts:byCode,flagged_by_status:byStatus,
    duplicates:{groups:groups.length,discordant_groups:disagreements.length},
    duplicate_decision_disagreements:disagreements,
    disclaimer:'Risk triage, not human annotation, independently established accuracy or taxonomy authority',
    flagged};
}
module.exports={norm,signalsFor,buildCounterAudit};

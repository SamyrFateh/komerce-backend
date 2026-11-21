/** @komerce-arch-lite
 * @role g6-phase-aware-pickup-scan-baseline
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Expected previous collected scans for the local and import phases of an M03 mixed basket.
 * @impact-areas staging-only, pickup, logistics
 */
'use strict';
function expectedPriorCollectScans(scenario,phase){
 return scenario==='M03'&&phase==='CLIENT_PICKUP'?1:0;
}
module.exports={expectedPriorCollectScans};

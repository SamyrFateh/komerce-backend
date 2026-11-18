/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {marketProfile,marketOption}=require('../../scripts/recette/canonical/market-profile');
const sel=opts=>({locator:()=>({evaluateAll:async fn=>fn(opts.map(([value,textContent])=>({value,textContent})))})});
test('market option is found by code, whatever the database label',async()=>{
 const s=sel([['','Choisir un marché…'],['KM','KM · Comores'],['CG','CG · République du Congo']]);
 await expect(marketOption(marketProfile({G6_TARGET_MARKET:'CG'}),s)).resolves.toEqual({value:'CG'});
 const byLabel=sel([['x1','KM · Comores'],['x2','CG · République du Congo']]);
 await expect(marketOption(marketProfile({G6_TARGET_MARKET:'CG'}),byLabel)).resolves.toEqual({value:'x2'});
 await expect(marketOption(marketProfile({G6_TARGET_MARKET:'CM'}),s)).rejects.toThrow('G6_MARKET_OPTION_MISSING_CM');
});

'use strict';
/**
 * Generic depth-bounded sequence generator. The planner knows only actions
 * and preconditions: it never consults observed writer behavior or bugs.
 * This deliberately simple initial search is exhaustive for two order
 * assignment operators and one valid parcel-cancellation operator.
 */
const OPERATORS=Object.freeze([
 Object.freeze({id:'ASSIGN_A',kind:'assign',order:'A'}),
 Object.freeze({id:'ASSIGN_B',kind:'assign',order:'B'}),
 Object.freeze({id:'CANCEL_OPEN',kind:'cancel'})
]);
function generatePlans(maxDepth=4){
 if(!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>4)
  throw Error('Planner depth must be an integer in 1..4');
 const plans=[];
 const walk=(actions,hasOpen)=>{
  if(actions.length)plans.push({id:'KBA-SQ-'+String(plans.length+1).padStart(3,'0'),
   actions:[...actions]});
  if(actions.length>=maxDepth)return;
  for(const op of OPERATORS){
   if(op.kind==='cancel'&&!hasOpen)continue;
   const nextOpen=op.kind==='cancel'?false:true;
   walk([...actions,op.id],nextOpen);
  }
 };
 walk([],false);
 if(new Set(plans.map(p=>p.actions.join('|'))).size!==plans.length)
  throw Error('Duplicate sequence generated');
 return plans;
}
module.exports={OPERATORS,generatePlans};

const {api,login,C,fs,ck}=require('./api.js');
const RID='67d7db35-66c1-411e-8f67-43c13b0ab8ba';
(async()=>{
 const pr=await api('admin','GET','/api/relay/returns/'+RID+'/compensation-proposal');console.log('proposal',pr.s,JSON.stringify(pr.j).slice(0,500));
 const am=pr.j&&(pr.j.suggested_amount??(pr.j.proposal&&pr.j.proposal.amount));
 const sc=pr.j&&(pr.j.scale_code??(pr.j.proposal&&pr.j.proposal.scale_code));
 if(process.env.GO!=='1')return;
 const d=await api('admin','POST','/api/relay/returns/'+RID+'/compensation',{movement:'wallet_credit',amount:am,scale_code:sc,reason:'CLAUDE-PAR-20261113 compensation retour produit défectueux (certification #3900)'});console.log('decide',d.s,JSON.stringify(d.j).slice(0,600));
})();

const {api}=require('./api.js');
(async()=>{const r=await api('admin','POST','/api/pickup/regenerate/daefd587-60f7-4f15-9d10-5e72e5021164',{reason:'CLAUDE-PAR-20261113 code de retrait perdu : fenêtre de révélation client expirée (certification #3900)'});
const j=r.j;console.log(r.s,JSON.stringify(j,(k,v)=>/code$|^code/i.test(k)&&typeof v==='string'?'[len'+v.length+']':v).slice(0,500));
if(j&&typeof j==='object'){const c=j.code||j.pickup_code||j.new_code;if(c){require('fs').writeFileSync(__dirname+'/.code.admin',String(c),{mode:0o600})}}})();

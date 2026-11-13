const {api}=require('./api.js');
(async()=>{for(let i=0;i<5;i++){const r=await api('agent-relais','POST','/api/pickup/verify/daefd587-60f7-4f15-9d10-5e72e5021164',{code:'ZZZZ2222'});console.log(i,r.s,JSON.stringify(r.j).slice(0,160))}})();

const fs=require('fs');const {api}=require('./api.js');
(async()=>{const code=fs.readFileSync(__dirname+'/.code.admin','utf8').replace(/[^A-Z0-9]/gi,'').toUpperCase();
const r=await api('agent-relais','POST','/api/scans/collect',{pickup_code:code});console.log('double remise',r.s,JSON.stringify(r.j).replace(code,'********').slice(0,200));
const o=await api('agent-relais','GET','/api/orders/daefd587-60f7-4f15-9d10-5e72e5021164');console.log('commande',o.s,o.j&&o.j.order?o.j.order.status:JSON.stringify(o.j).slice(0,120));})();

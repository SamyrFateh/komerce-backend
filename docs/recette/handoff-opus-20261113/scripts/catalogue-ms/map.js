const {api,fs}=require('./lib');
(async()=>{
 const S='4041e16e-f3c0-4139-b27c-e7e15d873e1a';
 for(const [pid,sku] of [['a16c7ade-d317-445d-9489-6cf233612a47','CJCS152810203CX'],['91c94beb-f706-40be-ac05-5d13d6d716dd','CJJS174391020TG']]){
  for(const role of ['admin']){
   const x=await api(role,'POST','/api/purchasing/suppliers/'+S+'/map',{product_id:pid,supplier_sku:sku,notes:'CLAUDE-PAR-20261113'});
   const l=`${new Date().toISOString()} map ${pid.slice(0,8)} as ${role} -> ${x.status} ${JSON.stringify(x.body).slice(0,300)}`;console.log(l);fs.appendFileSync('journal.log',l+'\n');
   if(x.status<300)break;
  }
 }
})();

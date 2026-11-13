const {api,fs}=require('./lib');
(async()=>{
 const [,,S,pid,sku,extra]=process.argv;
 const body={product_id:pid,supplier_sku:sku,notes:'CLAUDE-PAR-20261113',...(extra?JSON.parse(extra):{})};
 const x=await api('admin','POST','/api/purchasing/suppliers/'+S+'/map',body);
 const l=`${new Date().toISOString()} map ${pid.slice(0,8)} sup ${S.slice(0,8)} -> ${x.status} ${JSON.stringify(x.body).slice(0,400)}`;console.log(l);fs.appendFileSync('journal.log',l+'\n');
})();

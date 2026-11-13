const {api,fs}=require('./lib');
(async()=>{
 const ref=process.argv[2];
 const x=await api('sourcing','POST','/api/admin/workspaces/sourcing/sources/'+encodeURIComponent(ref)+'/import-now',{});
 console.log(x.status,JSON.stringify(x.body).slice(0,1500));
 fs.appendFileSync('journal.log',new Date().toISOString()+' import-now '+ref+' -> '+x.status+' '+JSON.stringify(x.body).slice(0,400)+'\n');
})();

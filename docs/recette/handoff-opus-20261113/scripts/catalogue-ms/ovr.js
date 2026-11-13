const {api,fs}=require('./lib');(async()=>{
const f={name:'Organisateur de dossier de siège auto avec plusieurs poches',description:'Organisateur à suspendre au dossier d\'un siège de voiture, avec plusieurs poches de rangement et une poignée. Usage en voiture. Contenu : 1 organisateur. D\'après la fiche fournisseur : dimensions 59 x 46 cm.',category:'materiels'};
const x=await api('admin','POST','/api/admin/catalog/approval-queue/06b95d4f-e365-4b91-8fc0-c6ae08e70e5b/override',{fields:f,reason:'CLAUDE-PAR-20261113 fiche FR fidele a la fiche fournisseur'});
const l=new Date().toISOString()+' ali2 override+approve 06b95d4f '+x.status+' '+JSON.stringify(x.body).slice(0,300);console.log(l);fs.appendFileSync('journal.log',l+'\n')})()

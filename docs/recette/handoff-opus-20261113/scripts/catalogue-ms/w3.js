const {api,fs}=require('./lib');
const F={
'6a55d16a-cdc0-4cd9-adfc-1201ddd69301':{name:'Planche à découper en bois clair avec poignée',description:'Planche à découper rectangulaire en bois clair, avec une poignée pour la suspendre ou la saisir. Usage en cuisine. Contenu : 1 planche. Fiche de recette CLAUDE-PAR-20261113 ; image libre de droits (CC0, Wikimedia Commons).'},
'83457a83-0b68-48aa-8507-ae153f925acd':{name:'Casserole en aluminium avec couvercle et deux anses',description:'Casserole ronde en aluminium avec couvercle à poignée et deux anses latérales. Usage en cuisine. Contenu : 1 casserole avec son couvercle. Fiche de recette CLAUDE-PAR-20261113 ; image libre de droits (CC0, Wikimedia Commons).'}
};
(async()=>{
 for(const [id,f] of Object.entries(F)){
  const x=await api('admin','POST','/api/admin/catalog/approval-queue/'+id+'/override',{fields:f,reason:'CLAUDE-PAR-20261113 fiche FR fidele a la fiche fournisseur'});
  const l=`${new Date().toISOString()} override+approve ${id.slice(0,8)} -> ${x.status} ${JSON.stringify(x.body).slice(0,260)}`;console.log(l);fs.appendFileSync('journal.log',l+'\n');
 }
 const s=await api('admin','GET','/api/purchasing/suppliers');console.log(s.status,JSON.stringify((s.body.suppliers||s.body||[]).map&&(s.body.suppliers||s.body).map(z=>z.name+'/'+z.platform+'/'+z.id.slice(0,8)+'/'+(z.owner_scope||''))).slice(0,900));
})();

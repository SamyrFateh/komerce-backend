const {api,fs}=require('./lib');
const T=' Usage en cuisine. Contenu : 1 X. Fiche de recette CLAUDE-PAR-20261113 ; image libre de droits (CC0, Wikimedia Commons).';
const F={
'fe2c8a44-d385-45ff-ae5b-8acbd3bf8534':{name:'Planche à découper en bois clair avec poignée',description:'Planche à découper rectangulaire en bois clair, avec une poignée pour la suspendre ou la saisir.'+T.replace('X','planche')},
'af3e5584-a71a-4dbe-b09c-11d9a0849376':{name:'Casserole en aluminium avec couvercle',description:'Casserole en aluminium, avec un couvercle à poignée pour la cuisine.'+T.replace('X','casserole avec son couvercle')}};
(async()=>{for(const [id,f] of Object.entries(F)){
 const x=await api('admin','POST','/api/admin/catalog/approval-queue/'+id+'/override',{fields:f,reason:'CLAUDE-PAR-20261113 fiche FR fidele a la fiche fournisseur'});
 const l=`${new Date().toISOString()} override+approve ${id.slice(0,8)} -> ${x.status} ${JSON.stringify(x.body).slice(0,200)}`;console.log(l);fs.appendFileSync('journal.log',l+'\n');}})();

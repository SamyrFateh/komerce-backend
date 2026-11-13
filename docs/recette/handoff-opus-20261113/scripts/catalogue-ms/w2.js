const {api,fs}=require('./lib');
const F={
'a16c7ade-d317-445d-9489-6cf233612a47':{name:'Débardeur de sport à dos fendu, coupe ample',description:"Débardeur de sport à coupe ample et dos fendu. Matière : tissu lycra, composition 100 % fibre de cupro. Coloris proposés : bleu saphir, noir, caramel, camel. Tailles : S, M, L, XL. Les tailles asiatiques taillent 1 à 2 tailles plus petit que les tailles européennes : en cas d'hésitation entre deux tailles, choisissez la plus grande. Tolérance de 2 à 3 cm due à la mesure manuelle. Les couleurs réelles peuvent légèrement varier selon l'écran. Contenu : 1 débardeur."},
'91c94beb-f706-40be-ac05-5d13d6d716dd':{name:'Legging de sport ajusté à taille haute, uni',description:"Legging de sport ajusté à taille haute, de couleur unie, en nylon, au style simple. Coloris proposés : kaki, gris, bleu clair, bleu foncé, noir, violet lilas, bleu Klein, vert paon, violet raisin, gris clair, marron foncé, vert cèdre, rose. Tailles (en cm) : S tour de taille 57, hanches 66 ; M taille 61, hanches 70 ; L taille 65, hanches 74 ; XL taille 69, hanches 78. Les tailles asiatiques taillent 1 à 2 tailles plus petit que les tailles européennes : en cas d'hésitation entre deux tailles, choisissez la plus grande. Tolérance de 2 à 3 cm due à la mesure manuelle. Les couleurs réelles peuvent légèrement varier selon l'écran. Contenu : 1 pantalon."}
};
(async()=>{
 for(const [id,f] of Object.entries(F)){
  const x=await api('admin','POST','/api/admin/catalog/approval-queue/'+id+'/override',{fields:f,reason:'CLAUDE-PAR-20261113 fiche FR fidele a la fiche fournisseur'});
  console.log(id.slice(0,8),x.status,JSON.stringify(x.body).slice(0,600));
  fs.appendFileSync('journal.log',new Date().toISOString()+' override+approve '+id+' -> '+x.status+'\n');
 }
})();

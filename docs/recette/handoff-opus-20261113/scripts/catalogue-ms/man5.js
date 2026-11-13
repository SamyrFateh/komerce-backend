const {api,fs}=require('./lib');
const mk=(k,name,desc,img,file,price,w,dim,n)=>({schema_version:'2',source_locale:'fr',media:[{supplier_media_id:`CLAUDE-PAR-20261113-${k}:media:v4`,url:img,role:'PRODUCT',alt:name,display_order:0}],sellable_units:[{supplier_sku:`CLAUDE-PAR-20261113-${k}-U4`,supplier_unit_ref:`CLAUDE-PAR-20261113-${k}-U4`,option_values:{},stock_available:20,purchase_price:price,currency:'EUR',supplier_order_identity:{provider:'local',version:1,payload:{item:`CLAUDE-PAR-20261113-${k}-4`}}}],supplier_product_id:`CLAUDE-PAR-20261113-${k}-V4`,product_name:name,supplier_category:'Maison > Cuisine',purchase_price:price,currency:'EUR',image_url:img,product_url:'https://commons.wikimedia.org/wiki/File:'+file,description:desc,stock_available:20,min_order_qty:1,weight_kg:w,dimensions:dim});
(async()=>{
 const T=' Usage en cuisine. Contenu : 1 '+'X'+'. Fiche de recette CLAUDE-PAR-20261113 ; image libre de droits (CC0, Wikimedia Commons).';
 const items=[
  mk('PLANCHE','Planche à découper en bois clair avec poignée','Planche à découper rectangulaire en bois clair, avec une poignée pour la suspendre ou la saisir.'+T.replace('X','planche'),'https://upload.wikimedia.org/wikipedia/commons/9/9e/Wooden_cutting_board_2017.jpg','Wooden_cutting_board_2017.jpg',6,0.6,{l_cm:40,w_cm:28,h_cm:2}),
  mk('CASSEROLE','Casserole en aluminium avec couvercle','Casserole en aluminium, avec un couvercle à poignée pour la cuisine.'+T.replace('X','casserole avec son couvercle'),'https://upload.wikimedia.org/wikipedia/commons/c/c9/Cooking_Pot_March.jpg','Cooking_Pot_March.jpg',12,1.2,{l_cm:30,w_cm:30,h_cm:16})];
 const x=await api('sourcing','POST','/api/admin/workspaces/sourcing/imports',{supplier_id:'61162c7a-eb57-4e49-befd-7fc724af7925',source_type:'manual',notes:'CLAUDE-PAR-20261113 manuels V4 (stock unité)',items});
 const l=`${new Date().toISOString()} manual-import-v4 ${x.status} ${JSON.stringify(x.body).slice(0,500)}`;console.log(l);fs.appendFileSync('journal.log',l+'\n');
 const q=await api('admin','GET','/api/admin/catalog/approval-queue?limit=50');
 const a=q.body.items||q.body.queue||q.body;console.log(q.status,JSON.stringify(a).slice(0,200));
 fs.writeFileSync('queue-v4.json',JSON.stringify(q.body));
})();

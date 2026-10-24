'use strict';
/** @komerce-arch-lite\n * @role staging-demo60-manifest\n * @domain catalog\n * @layer fixture\n * @owner backend-core\n * @purpose Persistent proposed demonstration SKUs; NO automatic publication or orders.\n * @impact-areas staging-only, catalog, recette\n */
const GROUPS = {
  "Electromenager": [
    "Friteuse à air 5 L",
    "Blender 1,5 L",
    "Bouilloire 1,7 L",
    "Robot pâtissier",
    "Grille-pain 2 fentes",
    "Machine à café filtre",
    "Fer à repasser vapeur",
    "Ventilateur de table",
    "Mini hachoir",
    "Cuiseur à riz 1,8 L",
    "Aspirateur balai",
    "Balance de cuisine"
  ],
  "HighTech": [
    "Écouteurs Bluetooth",
    "Casque sans fil",
    "Montre connectée",
    "Enceinte Bluetooth",
    "Batterie externe 20 000 mAh",
    "Chargeur USB-C 30 W",
    "Câble USB-C 2 m",
    "Support téléphone",
    "Mini trépied téléphone",
    "Clavier Bluetooth"
  ],
  "Mode": [
    "Sac à main",
    "Sac à dos urbain",
    "Portefeuille",
    "Lunettes de soleil",
    "Casquette",
    "Baskets basses",
    "Sandales",
    "Montre analogique",
    "Ceinture",
    "Sac de voyage cabine"
  ],
  "Maison": [
    "Panier décoratif tissé",
    "Théière en fonte",
    "Service de tasses",
    "Set de verres",
    "Lampe de chevet",
    "Coussin décoratif",
    "Tapis d'entrée",
    "Boîtes de rangement",
    "Rideaux occultants",
    "Plateau de service"
  ],
  "Bricolage": [
    "Perceuse sans fil",
    "Coffret de tournevis",
    "Mètre ruban 5 m",
    "Lampe LED rechargeable",
    "Jeu de clés Allen",
    "Pince multiprise",
    "Niveau à bulle",
    "Caisse à outils"
  ],
  "Famille": [
    "Sac à langer",
    "Sac à dos enfant",
    "Jeu de blocs en bois",
    "Puzzle éducatif",
    "Boîte à goûter",
    "Gourde enfant",
    "Veilleuse enfant",
    "Cahier de coloriage",
    "Jeu de construction",
    "Tapis d'éveil"
  ]
};
const products = Object.entries(GROUPS).flatMap(([family,names])=>names.map(name=>({family,name}))).map((p,i)=>Object.freeze({
  product_ref: 'DEMO26-'+String(i+1).padStart(3,'0'),
  name:p.name, family_proposed:p.family,
  description:p.name+' — fiche de démonstration Komerce, offre fournisseur et stock non attestés.',
  demo_flag:true, lifecycle_requested:'DRAFT_NOT_EXPOSED',
  image_status:'TO_SOURCE_AND_LICENSE', supplier_provenance:'UNVERIFIED',
  price_status:'NOT_DECIDED',stock_status:'NOT_CONFIRMED',
  e2e_fixture_key:'DEMO26-'+String(i+1).padStart(3,'0')
}));
if(products.length!==60 || new Set(products.map(p=>p.product_ref)).size!==60)throw Error('DEMO60_MANIFEST_INVALID');
module.exports=Object.freeze(products);

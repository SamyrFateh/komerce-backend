'use strict';
/**
 * Synthetic SOURCE-ONLY certification fixtures, NEVER customer/order/payment data.
 * Only allowed inside exact Railway certification project and private DB.
 * Supply identities and content are invented; uses real scanner for WATCH
 * category gate, not a fake market price, activation or publication.
 */
const { Client }=require('pg');
const bcrypt=require('bcryptjs');
const scanner=require('../../services/supplier-catalog-scanner');
const PID='d675d8bd-7452-42f4-8ba5-cf8480959b96';
const EID='abfa50f5-6a56-4df0-88b2-27f7fc652608';
const SID='5b911a75-cd01-484a-ad58-fbd092183fdf';
const deny=(condition,code)=>{if(!condition)throw Error('CERT_SEED_REFUSED_'+code);};
const cases=[
 ['Lampe LED de bureau','Desk Lighting','maison',1850,0.65],
 ['Support téléphone métal','Phone Accessories','electronics',1300,0.25],
 ['Boîte de rangement','Storage Box','maison',1700,0.9],
 ['Chargeur USB-C','Electronics Chargers','electronics',2200,0.18],
 ['Sac de voyage','Travel Bags','textile',4600,0.95],
 ['Tapis décoratif','Floor Decor','maison',3100,1.4],
 ['Câble HDMI','Electronics Cables','electronics',650,0.1],
 ['Organisateur cuisine','Kitchen Organizers','maison',1800,0.48],
 ['Housse de protection','Phone Cases','electronics',750,0.12],
 ['Étagère murale','Home Shelving','maison',5500,1.9],
 ['Écouteurs Bluetooth','Wireless Earbuds','electronics',3350,0.15],
 ['Panier textile','Laundry Basket','textile',1900,0.65],
 ['Montre analogique','Analog Watches','accessoires',2350,0.2],
 ['Gourde inox','Stainless Bottle','maison',1250,0.45],
 ['Lumière de nuit','Night Light','electronics',1600,0.32],
 ['Housse coussin','Cushion Covers','textile',720,0.18],
 ['Brosse nettoyage','Cleaning Brush','maison',560,0.2],
 ['Support tablette','Tablet Stand','electronics',1500,0.42],
 ['Vase déco','Decorative Vase','maison',2400,0.8],
 ['Sac ordinateur','Laptop Sleeve','textile',2100,0.36],
];
async function main(){
 deny(process.env.RAILWAY_PROJECT_ID===PID,'PROJECT');
 deny(process.env.RAILWAY_ENVIRONMENT_ID===EID,'ENVIRONMENT');
 deny(process.env.RAILWAY_SERVICE_ID===SID,'SERVICE');
 deny(process.env.KOMERCE_DISABLE_CRONS==='true','CRONS');
 deny(process.env.KOMERCE_ENV==='staging','BUSINESS_ENV');
 const raw=process.env.DATABASE_URL;
 deny(!!raw && new URL(raw).hostname.toLowerCase().endsWith('.railway.internal'),'PRIVATE_DB');
 deny(!!process.env.ADMIN_PASSWORD,'ADMIN_SECRET');
 const client=new Client({connectionString:raw,connectionTimeoutMillis:15000});
 await client.connect();
 try{
   const marker=await client.query('SELECT source_project,source_environment FROM public.cert_schema_bootstrap_marker LIMIT 1');
   deny(marker.rows[0]?.source_project===PID && marker.rows[0]?.source_environment===EID,'SCHEMA_IDENTITY');
   const seeded=await client.query("SELECT to_regclass('public.cert_fixture_seed_marker') AS marker");
   if(seeded.rows[0].marker){
     console.log('CERT_FIXTURES_ALREADY_PREPARED');
     return;
   }
   const counters=await client.query(`SELECT
     (SELECT COUNT(*)::int FROM users) AS users,
     (SELECT COUNT(*)::int FROM products) AS products,
     (SELECT COUNT(*)::int FROM sourcing_candidates) AS candidates,
     (SELECT COUNT(*)::int FROM markets) AS markets`);
   deny(Object.values(counters.rows[0]).every(x=>Number(x)===0),'NONEMPTY_DATA');
   await client.query('BEGIN');
   try{
     const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,10);
     const {rows:[admin]}=await client.query(`INSERT INTO users
       (full_name,email,phone,password_hash,role,country,currency_pref)
       VALUES ('Cert Admin — données fictives','cert-admin@komerce.invalid',
         '+26900000099',$1,'admin','KM','KMF') RETURNING id`,[hash]);
     await client.query(`INSERT INTO sourcing_global_access_grants
       (user_id,granted_by,reason) VALUES ($1,$1,'CERTIFICATION_ONLY')`,[admin.id]);
     await client.query(`INSERT INTO catalog_global_access_grants
       (user_id,granted_by,reason) VALUES ($1,$1,'CERTIFICATION_ONLY')`,[admin.id]);
     await client.query(`INSERT INTO finance_config
       (id,taux_change_eur_kmf,taux_aed_kmf,target_marge_brute_pct)
       VALUES (1,491.96,138,40)`);
     const cats=[
       ['maison','Maison & rangement',30,1.0,40,'{"home":8,"storage":8,"kitchen":6,"shelf":5,"lamp":4}'],
       ['electronics','Électronique & accessoires',35,0.35,40,'{"electronics":8,"charger":8,"cable":8,"bluetooth":6,"phone":6}'],
       ['textile','Textile & bagagerie',25,0.65,40,'{"textile":8,"bag":8,"case":5,"cushion":7}'],
       ['accessoires','Petits accessoires',28,0.3,40,'{"watch":8,"accessory":6}'],
     ];
     for(const [key,label,customs,weight,margin,terms] of cats){
       await client.query(`INSERT INTO customs_categories
         (key,label,douane_pct,tva_pct,default_weight_kg,default_margin_pct,
          is_active,classification_terms)
         VALUES ($1,$2,$3,10,$4,$5,true,$6::jsonb)`,
         [key,label,customs,weight,margin,terms]);
       await client.query('INSERT INTO boutique_categories (key,label,is_active) VALUES ($1,$2,true)',[key,label]);
     }
     await client.query(`INSERT INTO markets
       (code,name,currency,minor_unit,is_active,lifecycle_status)
       VALUES ('KM','Comores — certification','KMF',0,true,'ACTIVE')`);
     for(let i=0;i<cases.length;i++){
       const [name,sourceCat,proposed,cost,weight]=cases[i];
       const state=i<12?'scanned':(i<16?'normalized':'raw_imported');
       const candidate={
         supplier_name:'Fournisseur fictif CERT',
         supplier_product_id:'CERT-SUP-'+String(i+1).padStart(3,'0'),
         product_name:name,supplier_category:sourceCat,
         purchase_price_kmf:cost,estimated_weight_kg:weight,
         estimated_volume_m3:Number((weight*0.004).toFixed(5)),
         data_sources:{category:'default'},
       };
       const scan=state==='scanned'
         ?await scanner.scanCandidate(candidate,{config:{categories:{}}}):null;
       const contract={
         schema_version:'2',supplier_product_id:candidate.supplier_product_id,
         product_name:name, supplier_name:candidate.supplier_name,
         media:[],option_axes:[],
       };
       await client.query(`INSERT INTO sourcing_candidates
         (supplier_name,supplier_product_id,product_name,supplier_category,
          purchase_price,currency,description,purchase_price_kmf,
          estimated_weight_kg,estimated_volume_m3,confidence,
          state,scan_result,scan_at,data_sources,normalized_source_contract,
          notes)
         VALUES ($1,$2,$3,$4,$5,'KMF',$6,$7,$8,$9,'medium',
           $10,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15)`,
         [candidate.supplier_name,candidate.supplier_product_id,name,sourceCat,cost,
          'Fixture synthétique : aucun fournisseur réel.',cost,weight,
          candidate.estimated_volume_m3,state,
          scan?JSON.stringify({...scan.scan_result,sourcing_decision:scan.sourcing_decision}):null,
          scan?new Date():null,JSON.stringify(candidate.data_sources),
          JSON.stringify(contract),'CERTIFICATION_SYNTHETIC_ONLY']);
     }
     await client.query(`CREATE TABLE public.cert_fixture_seed_marker
       (source_project text NOT NULL,source_environment text NOT NULL,
        product_candidate_count integer NOT NULL,created_at timestamptz DEFAULT now())`);
     await client.query('INSERT INTO public.cert_fixture_seed_marker (source_project,source_environment,product_candidate_count) VALUES ($1,$2,$3)',
       [PID,EID,cases.length]);
     await client.query('COMMIT');
     console.log('CERT_FIXTURE_READY '+JSON.stringify({
       privateProject:true,users:1,sourcingCandidates:cases.length,
       candidatesNeedingCategory:12,unpublishedProducts:0,
       markets:1,source:'synthetic',paymentsEnabled:false,
       pricesApplied:false,publications:0
     }));
   }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
 }finally{await client.end();}
}
main().then(()=>process.exit(0)).catch(err=>{console.error('CERT_FIXTURE_FAILED '+String(err?.message||err).slice(0,500));process.exitCode=1;});

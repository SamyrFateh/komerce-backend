'use strict';
/** LEGAL EUR/KMF PARITY only, guarded to the dedicated fake-data Railway project. */
const { Client }=require('pg');
const PID='d675d8bd-7452-42f4-8ba5-cf8480959b96';
const EID='abfa50f5-6a56-4df0-88b2-27f7fc652608';
const SID='5b911a75-cd01-484a-ad58-fbd092183fdf';
async function main(){
 if(process.env.RAILWAY_PROJECT_ID!==PID ||
    process.env.RAILWAY_ENVIRONMENT_ID!==EID ||
    process.env.RAILWAY_SERVICE_ID!==SID ||
    process.env.KOMERCE_DISABLE_CRONS!=='true' ||
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).hostname.toLowerCase().endsWith('.railway.internal'))
   throw new Error('CERT_FX_TARGET_REFUSED');
 const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
 await c.connect();
 try{
  const r=await c.query('SELECT source_project,source_environment FROM public.cert_fixture_seed_marker LIMIT 1');
  if(r.rows[0]?.source_project!==PID || r.rows[0]?.source_environment!==EID)
   throw new Error('CERT_FX_FIXTURE_REFUSED');
  const {rows}=await c.query("SELECT eur_rate::text AS rate FROM public.currency_parities WHERE currency='KMF'");
  if(rows.length && Number(rows[0].rate)!==491.96775)throw new Error('CERT_FX_PARITY_MISMATCH');
  if(!rows.length){
   await c.query(`INSERT INTO public.currency_parities(currency,eur_rate,source_note)
       VALUES ('KMF',491.96775,'CERT_LEGAL_FIXED_EUR_KMF_NOT_MARKET_QUOTE')`);
  }
  console.log('CERT_KMF_PARITY_READY '+JSON.stringify({currency:'KMF',ratePerEur:491.96775,legalFixed:true,externalQuoteInvented:false}));
 }finally{await c.end();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('CERT_KMF_PARITY_FAILED '+String(e.message).slice(0,350));process.exit(1);});

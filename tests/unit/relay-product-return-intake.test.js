'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const path=require('path');
const intake=require('../../services/relay-product-return-intake-service');
const RELAY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const agent={id:USER,role:'agent_relais',relais_id:RELAY};
const input=(db,changes={})=>({
 actor:agent,requestId:REQUEST,condition:'opened',zone:'a',
 observation:'Article remis au comptoir, emballage ouvert.',db,...changes
});

function fixture({found=true,status='open',quantity=2,collected=2,receipt=null}={}){
  const calls=[];
  const client={release:jest.fn(),query:jest.fn(async(sql,params=[])=>{
    calls.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(/FROM disputes d/.test(sql))return {rows:found?[{
      id:REQUEST,type:'product_return',status,return_quantity:quantity,
      qty_collected:collected,relais_id:RELAY,reference:'KOM-458',product_name:'Appareil'
    }]:[]};
    if(/FROM relay_product_return_receipts WHERE request_id/.test(sql))
      return {rows:receipt?[receipt]:[]};
    if(/INSERT INTO relay_product_return_receipts/.test(sql))
      return {rows:[{id:OTHER,request_id:REQUEST,relay_id:RELAY,
        received_by:USER,quantity,condition_code:params[3],storage_zone:params[4],
        observation:params[5],received_at:'2026-11-08'}]};
    throw Error('Unhandled SQL '+sql);
  })};
  return {db:{getClient:jest.fn(async()=>client)},client,calls};
}

test('la preuve physique est créée une seule fois et ne crédite jamais un client',async()=>{
 const {db,client,calls}=fixture();
 const out=await intake.recordIntake(input(db));
 expect(out.replayed).toBe(false);
 expect(out.receipt.storage_zone).toBe('A');
 expect(out.receipt.quantity).toBe(2);
 expect(calls.map(x=>x.sql)).toContain('COMMIT');
 const stmt=calls.find(x=>/INSERT INTO relay_product_return_receipts/.test(x.sql));
 expect(stmt.params).toEqual([REQUEST,RELAY,2,'opened','A',
   'Article remis au comptoir, emballage ouvert.',USER]);
 expect(calls.some(x=>/INSERT INTO (wallet|refund)|UPDATE (wallet|stock|product|order|disput)/i.test(x.sql))).toBe(false);
 expect(client.release).toHaveBeenCalledTimes(1);
});

test('idempotence exacte : même acteur et mêmes observations => preuve existante',async()=>{
 const existing={id:OTHER,request_id:REQUEST,relay_id:RELAY,received_by:USER,
  condition_code:'opened',storage_zone:'A',
  observation:'Article remis au comptoir, emballage ouvert.'};
 const {db,calls}=fixture({receipt:existing});
 const out=await intake.recordIntake(input(db));
 expect(out.replayed).toBe(true);
 expect(calls.some(x=>/INSERT INTO relay_product_return_receipts/.test(x.sql))).toBe(false);
});

test('une seconde réception différente est refusée, jamais écrasée',async()=>{
 const {db}=fixture({receipt:{received_by:USER,condition_code:'unknown',
   storage_zone:null,observation:'Ancien constat obligatoire.'}});
 await expect(intake.recordIntake(input(db))).rejects.toMatchObject({
   code:'RETURN_INTAKE_ALREADY_RECORDED',status:409
 });
});

test('isolations de rôle et de relais imposées avant toute transaction',async()=>{
 const {db}=fixture();
 for(const actor of [
   {...agent,role:'market_operator'},
   {...agent,role:'admin'},
   {...agent,relais_id:null}
 ]){
   await expect(intake.recordIntake(input(db,{actor})))
    .rejects.toMatchObject({code:'RETURN_INTAKE_ROLE_FORBIDDEN',status:403});
 }
 expect(db.getClient).not.toHaveBeenCalled();
});

test('dossier de l autre relais introuvable, et dossier fermé interdit',async()=>{
 const a=fixture({found:false});
 await expect(intake.recordIntake(input(a.db)))
  .rejects.toMatchObject({code:'RETURN_INTAKE_NOT_FOUND',status:404});
 const b=fixture({status:'closed'});
 await expect(intake.recordIntake(input(b.db)))
  .rejects.toMatchObject({code:'RETURN_INTAKE_NOT_ELIGIBLE',status:409});
 const c=fixture({quantity:2,collected:1});
 await expect(intake.recordIntake(input(c.db)))
  .rejects.toMatchObject({code:'RETURN_INTAKE_NOT_ELIGIBLE',status:409});
});

test('stockage facultatif, lettres seulement; observations et pièces requises',async()=>{
 expect(intake.normalizeInput(REQUEST,'sealed','', 'Retour constaté et reçu.').storageZone).toBeNull();
 expect(intake.normalizeInput(REQUEST,'damaged','b', 'Retour constaté et reçu.').storageZone).toBe('B');
 expect(()=>intake.normalizeInput(REQUEST,'opened','AB','Retour constaté et reçu.'))
  .toThrow(expect.objectContaining({code:'RETURN_INTAKE_ZONE_INVALID'}));
 expect(()=>intake.normalizeInput(REQUEST,'opened','', 'Trop court'))
  .toThrow(expect.objectContaining({code:'RETURN_INTAKE_OBSERVATION_REQUIRED'}));
});
test('contrat migration : preuve unique, append-only, garde DB du relais et sans wallet',()=>{
 const m=fs.readFileSync(path.join(__dirname,'../../migrations/401_relay_product_return_intake.sql'),'utf8');
 expect(m).toContain('request_id uuid NOT NULL UNIQUE');
 expect(m).toContain('FOR SHARE OF d,o,oi');
 expect(m).toContain('request_row.relais_id IS DISTINCT FROM NEW.relay_id');
 expect(m).toContain('BEFORE UPDATE OR DELETE');
 expect(m).not.toContain('wallet_transactions');
 expect(m).not.toContain('INSERT INTO public.refunds');
});

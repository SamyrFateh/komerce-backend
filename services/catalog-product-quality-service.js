/**
 * @komerce-arch
 * @role          catalog-product-quality-hold-service
 * @domain        catalog
 * @layer         service
 * @criticality   critical
 * @inputs        global_catalog_admin, product_ref, note, freeze/release decision
 * @outputs       append-only quality note, sale hold state and SAV signals
 * @depends       db.js
 * @used-by       routes/admin-catalog-workspace.js, services/catalog-workspace.js, services/relay-return-request-service.js
 * @db-read       products, catalog_product_sale_holds, catalog_product_quality_notes, disputes, orders, order_items
 * @db-write      catalog_product_sale_holds, catalog_product_quality_notes
 * @db-txn        explicit
 * @doctrine      return_signal_not_automatic_freeze, catalog_global_authority, freeze_does_not_change_committed_orders
 * @impact-areas  catalog, checkout, orders, product-discovery, admin-dashboard
 * @version       2026-11
 */
'use strict';

const db = require('../db');
const REF = /^KPR-\d{6,}$/i;
const REASONS = Object.freeze(['safety','defect','repeated_returns','quality_review','other']);
class CatalogQualityError extends Error {
  constructor(code,message,status=400){super(message);this.code=code;this.status=status;}
}
const reject=(code,message,status)=>{throw new CatalogQualityError(code,message,status);};
const normalizeRef=(value)=>{
  const ref=String(value||'').trim().toUpperCase();
  if(!REF.test(ref))reject('QUALITY_PRODUCT_REF_INVALID','Référence produit invalide.');
  return ref;
};
const normalizeComment=(value,min=10)=>{
  const s=String(value||'').trim();
  if(s.length<min||s.length>2000)reject('QUALITY_COMMENT_REQUIRED','Commentaire explicite obligatoire (10 à 2000 caractères).');
  return s;
};
function assertActor(user){
  if(!user||user.role!=='admin'||!user.id)reject('QUALITY_AUTHORITY_REQUIRED','Autorité Catalogue centrale requise.',403);
}

async function lockProduct(client,productRef){
  const {rows:[product]}=await client.query(
    `SELECT id,product_ref,is_active,is_available FROM products WHERE product_ref=$1 FOR UPDATE`,[productRef]);
  if(!product)reject('QUALITY_PRODUCT_NOT_FOUND','Produit introuvable.',404);
  return product;
}

/**
 * Narrow, non-financial note writer. A relay can ONLY report a purchased item
 * already collected in its own order; this has no freeze authority. The
 * Orders/Relais route provides actor validation, this SQL independently proves
 * the physical receipt and relay boundary before writing the Catalog-owned row.
 */
async function addRelayObservation({actorId,relayId,reference,orderItemId,note},executor=db){
  const content=String(note||'').trim();
  if(content.length<5||content.length>2000)
    reject('QUALITY_COMMENT_REQUIRED','Remarque de 5 à 2000 caractères obligatoire.');
  const ref=String(reference||'').trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(ref))
    reject('QUALITY_ORDER_REF_INVALID','Référence de commande invalide.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(orderItemId||'')))
    reject('QUALITY_ITEM_INVALID','Article commandé invalide.');
  const {rows:[row]}=await executor.query(`
    WITH eligible AS (
      SELECT oi.id AS order_item_id,oi.product_id
      FROM order_items oi
      JOIN orders o ON o.id=oi.order_id
      WHERE oi.id=$1::uuid AND o.reference=$2 AND o.simulation_scope IS NULL
        AND ($3::uuid IS NULL OR o.relais_id=$3::uuid)
        AND oi.qty_collected > 0
    ), written AS (
      INSERT INTO catalog_product_quality_notes
        (product_id,author_id,note,source,order_item_id)
      SELECT e.product_id,$4::uuid,$5,'relay',e.order_item_id FROM eligible e
      RETURNING id,product_id,created_at
    )
    SELECT w.id,w.created_at,p.product_ref
    FROM written w JOIN products p ON p.id=w.product_id`,
    [orderItemId,ref,relayId,actorId,content]
  );
  if(!row)reject('QUALITY_RELAY_ITEM_FORBIDDEN',
    'Article non remis ou commande hors du relais autorisé.',403);
  return {id:row.id,created_at:row.created_at,product_ref:row.product_ref};
}

async function qualityByRef(productRef,executor=db){
  const ref=normalizeRef(productRef);
  const {rows:[p]}=await executor.query(
    `SELECT id,product_ref,name FROM products WHERE product_ref=$1`,[ref]);
  if(!p)reject('QUALITY_PRODUCT_NOT_FOUND','Produit introuvable.',404);
  const [holds,notes,returns]=await Promise.all([
    executor.query(`SELECT reason,comment,frozen_at,released_at,release_comment
       FROM catalog_product_sale_holds
       WHERE product_id=$1 ORDER BY frozen_at DESC LIMIT 15`,[p.id]),
    executor.query(`SELECT note,created_at FROM catalog_product_quality_notes
       WHERE product_id=$1 ORDER BY created_at DESC LIMIT 15`,[p.id]),
    executor.query(`SELECT COUNT(*)::int AS reports,
         COUNT(*) FILTER (WHERE d.status IN ('open','processing'))::int AS active_reports
       FROM disputes d JOIN order_items oi ON oi.id=d.return_order_item_id
       WHERE oi.product_id=$1 AND d.type='product_return'`,[p.id]),
  ]);
  const history=holds.rows||[];
  return {
    product_ref:p.product_ref,
    name:p.name,
    frozen:history.some(h=>h.released_at==null),
    active_hold:history.find(h=>h.released_at==null)||null,
    hold_history:history,
    notes:notes.rows||[],
    reports:Number(returns.rows?.[0]?.reports)||0,
    active_reports:Number(returns.rows?.[0]?.active_reports)||0,
  };
}

async function batchSignals(productRefs, executor=db) {
  const refs=[...new Set((productRefs||[]).filter(ref=>REF.test(String(ref||''))))];
  if(!refs.length)return new Map();
  const {rows}=await executor.query(`
    SELECT p.product_ref,
           EXISTS (SELECT 1 FROM catalog_product_sale_holds h
             WHERE h.product_id=p.id AND h.released_at IS NULL) AS quality_frozen,
           (SELECT COUNT(*)::int FROM catalog_product_quality_notes n
             WHERE n.product_id=p.id) AS quality_note_count,
           (SELECT COUNT(*)::int FROM disputes d
             JOIN order_items oi ON oi.id=d.return_order_item_id
             WHERE oi.product_id=p.id AND d.type='product_return') AS quality_return_count
    FROM products p WHERE p.product_ref=ANY($1::text[])`,[refs]);
  return new Map(rows.map(r=>[r.product_ref,{
    quality_frozen:r.quality_frozen===true,
    quality_note_count:Number(r.quality_note_count)||0,
    quality_return_count:Number(r.quality_return_count)||0,
  }]));
}

async function change({actor,productRef,action,comment,reason}, pool=db){
  assertActor(actor);
  const ref=normalizeRef(productRef);
  const note=normalizeComment(comment,action==='note'?5:10);
  if(!['note','freeze','release'].includes(action))reject('QUALITY_ACTION_INVALID','Action qualité inconnue.');
  if(action==='freeze'&&!REASONS.includes(reason))
    reject('QUALITY_REASON_INVALID','Motif de gel invalide.');
  const client=await pool.getClient();
  try{
    await client.query('BEGIN');
    const product=await lockProduct(client,ref);
    const {rows:[active]}=await client.query(`
      SELECT id FROM catalog_product_sale_holds
      WHERE product_id=$1 AND released_at IS NULL FOR UPDATE`,[product.id]);
    let changed;
    if(action==='note'){
      const {rows:[row]}=await client.query(`
        INSERT INTO catalog_product_quality_notes(product_id,author_id,note)
        VALUES($1,$2,$3) RETURNING id,created_at`,[product.id,actor.id,note]);
      changed={id:row.id,noted_at:row.created_at};
    }else if(action==='freeze'){
      if(active)reject('QUALITY_ALREADY_FROZEN','Ce produit est déjà gelé.',409);
      const {rows:[row]}=await client.query(`
        INSERT INTO catalog_product_sale_holds(product_id,reason,comment,frozen_by)
        VALUES($1,$2,$3,$4) RETURNING id,frozen_at`,
      [product.id,reason,note,actor.id]);
      changed={id:row.id,frozen_at:row.frozen_at};
    }else{
      if(!active)reject('QUALITY_NOT_FROZEN','Ce produit n’est pas gelé.',409);
      const {rows:[row]}=await client.query(`
        UPDATE catalog_product_sale_holds SET released_at=now(),
          released_by=$2,release_comment=$3
        WHERE id=$1 AND released_at IS NULL RETURNING id,released_at`,
      [active.id,actor.id,note]);
      changed={id:row.id,released_at:row.released_at};
    }
    await client.query('COMMIT');
    return {product_ref:product.product_ref,action,...changed};
  }catch(e){
    await client.query('ROLLBACK');
    if(e.code==='23505')reject('QUALITY_ALREADY_FROZEN','Gel actif déjà enregistré.',409);
    throw e;
  }finally{client.release();}
}

module.exports={CatalogQualityError,REASONS,addRelayObservation,qualityByRef,batchSignals,change};

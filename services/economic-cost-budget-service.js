/**
 * @komerce-arch
 * @role          economic-cost-budget-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, explicit_market_code_or_group, post_id, month, expected_revision, native_amount, currency, reason, request_key
 * @outputs       immutable_budget_revision, idempotent_replay
 * @depends       db, services/economic-cost-write-authority.js, services/fx-authority.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       markets, economic_cost_centers, economic_cost_posts, economic_cost_budget_revisions
 * @db-write      economic_cost_budget_revisions
 * @db-txn        service_owned_transaction
 * @doctrine      budget_is_not_realized_cost, explicit_global_authority, exact_scope, eur_is_the_pivot, immutable_budget_revision
 * @impact-areas  economic-engine, finance, governance
 * @version       2026-11
 */
'use strict';

const db = require('../db');
const fx = require('./fx-authority');
const costAuthority=require('./economic-cost-write-authority');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code, status, message) { return Object.assign(new Error(message), { code, status }); }
function text(value, min, max, field) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    throw fail('economic_budget_invalid', 400, field + ' invalide');
  return value.trim();
}
function parseInput(raw) {
  if (!raw || !UUID.test(String(raw.postId || ''))) throw fail('economic_budget_invalid',400,'Poste invalide');
  if (raw.marketCode !== null && (typeof raw.marketCode !== 'string' || !/^[A-Z]{2}$/.test(raw.marketCode)))
    throw fail('economic_budget_invalid',400,'Périmètre explicite requis');
  if (typeof raw.periodStart !== 'string' || !/^[1-9][0-9]{3}-(0[1-9]|1[0-2])-01$/.test(raw.periodStart))
    throw fail('economic_budget_invalid',400,'Mois invalide');
  if (!Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 0 || raw.expectedRevision >= 2147483647)
    throw fail('economic_budget_invalid',400,'Révision attendue invalide');
  const currency = text(raw.currency,3,3,'Devise');
  if (!Object.prototype.hasOwnProperty.call(fx.MINOR_UNITS,currency)) throw fail('economic_budget_invalid',400,'Devise non gouvernée');
  // Never accept floating-point amounts from the browser or silently round them.
  const m = typeof raw.amountNative === 'string' && /^(0|[1-9][0-9]{0,13})(?:\.([0-9]{1,4}))?$/.exec(raw.amountNative);
  if (!m || (m[2] || '').length > fx.MINOR_UNITS[currency]) throw fail('economic_budget_invalid',400,'Montant natif invalide');
  return { postId:raw.postId, marketCode:raw.marketCode, periodStart:raw.periodStart, expectedRevision:raw.expectedRevision,
    currency, amountNative:m[1]+'.'+(m[2]||'').padEnd(4,'0'), reason:text(raw.reason,3,1000,'Motif'), requestKey:text(raw.requestKey,8,200,'Clé de requête') };
}
async function reviseBudget(actor, raw, {preparationOnly=false}={}) {
  const input = parseInput(raw);
  if(preparationOnly && input.marketCode===null)throw fail('market_not_found',404,'Marché explicite requis pour la préparation');
  const central=await costAuthority.classifyActor(actor,input.marketCode);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    let marketId = null;
    if (input.marketCode !== null) {
      const { rows } = await client.query(preparationOnly?"SELECT id FROM markets WHERE code=$1 AND lifecycle_status='PROVISIONING' FOR SHARE":'SELECT id FROM markets WHERE code=$1',[input.marketCode]);
      if (!rows.length) throw fail('market_not_found',404,'Marché introuvable');
      marketId=rows[0].id;
    }
    await costAuthority.check(client,actor,input.marketCode,marketId,central,'budget',{record:true,...(preparationOnly?{preparationOnly:true}:{})});
    // Serializes concurrent budget changes on the same post; scope is resolved
    // server-side. No lock or read of another market's budget history.
    const { rows: posts } = await client.query(
      'SELECT p.id FROM economic_cost_posts p JOIN economic_cost_centers c ON c.id=p.center_id WHERE p.id=$1 AND c.market_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE OF p',
      [input.postId,marketId]);
    if (!posts.length) throw fail('economic_budget_post_not_found',404,'Poste introuvable dans ce périmètre');
    const { rows: prior } = await client.query(
      'SELECT *, amount_native::text AS amount_native, amount_eur::text AS amount_eur FROM economic_cost_budget_revisions WHERE post_id=$1 AND period_start=$2 AND idempotency_key=$3',
      [input.postId,input.periodStart,input.requestKey]);
    if (prior.length) {
      const b=prior[0];
      if (b.currency!==input.currency || b.amount_native!==input.amountNative || b.reason!==input.reason ||
          String(b.recorded_by)!==String(actor.id) || (b.previous_revision||0)!==input.expectedRevision)
        throw fail('economic_budget_idempotency_conflict',409,'Rejeu avec données différentes');
      await client.query('COMMIT');
      return { outcome:'replayed', revision:b };
    }
    const { rows: latest } = await client.query(
      'SELECT revision FROM economic_cost_budget_revisions WHERE post_id=$1 AND period_start=$2 ORDER BY revision DESC LIMIT 1',
      [input.postId,input.periodStart]);
    const current=latest[0]?.revision||0;
    if (current!==input.expectedRevision) throw fail('economic_budget_revision_conflict',409,'Budget modifié entre-temps');
    const { rows: clock }=await client.query('SELECT now() AS as_of');
    const asOf=clock[0].as_of;
    const converted=await fx.convert({amount:input.amountNative,from:input.currency,to:'EUR',at:asOf,client});
    const { rows }=await client.query(
      'INSERT INTO economic_cost_budget_revisions (post_id,period_start,revision,previous_revision,currency,amount_native,amount_eur,fx_legs,fx_as_of,reason,idempotency_key,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) RETURNING *, amount_native::text AS amount_native, amount_eur::text AS amount_eur',
      [input.postId,input.periodStart,current+1,current||null,input.currency,input.amountNative,converted.amount_text,JSON.stringify(converted.legs),asOf,input.reason,input.requestKey,actor.id]);
    await client.query('COMMIT');
    return {outcome:'created',revision:rows[0]};
  } catch(error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
    throw error;
  } finally { client.release(); }
}
module.exports={reviseBudget,parseInput};

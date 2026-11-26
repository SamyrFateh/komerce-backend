/**
 * @komerce-arch
 * @role          hub-global-read-board
 * @domain        logistics
 * @layer         service
 * @criticality   medium
 * @inputs        active market identifiers and canonical hub procurement dossiers
 * @outputs       cross-market read-only board without supplier/financial/identity details
 * @depends       db.js, services/hub-procurement-dossier.js
 * @used-by       routes/hub.js
 * @db-read       markets, orders, order_items, purchase_orders, purchase_lines, hub_physical_units, international_shipments
 * @db-write      none
 * @db-txn        none
 * @doctrine      central_hub_global_read_only_no_client_market_scope, writers_remain_role_guarded
 * @impact-areas  logistics, admin-dashboard, authorization
 * @version       2026-11-v1
 */
'use strict';

const db = require('../db');
const dossier = require('./hub-procurement-dossier');

const number = x => Math.max(0, Number(x) || 0);
const sum = (items, fn) => (items || []).reduce((n, x) => n + number(fn(x)), 0);

const SHIPMENT_STAGES = Object.freeze([
  'hub_ready', 'handed_over', 'forwarder_received', 'in_transit',
  'arrived', 'customs_released', 'local_delivery', 'relay_received',
]);
const shipmentLevel = stage => SHIPMENT_STAGES.indexOf(String(stage || ''));

// Une phase est une projection en lecture seule de preuves canoniques.
// La présence d'un carton ou d'une expédition ne prouve ni emballage terminé,
// ni remise au transitaire, ni retrait client.
function summarizeMarket(market, payload) {
  const result = [];
  for (const order of payload.orders || []) {
    const items = order.items || [];
    const po = (payload.purchase_orders || []).filter(p => (p.lines || []).some(l => l.order_id === order.id));
    const lines = po.flatMap(p => (p.lines || []).filter(l => l.order_id === order.id));
    const needs = (payload.needs || []).filter(n => n.order_id === order.id);
    const boxes = (payload.boxes || []).filter(b => (b.contents || []).some(c => c.order_id === order.id));
    const parcels = (payload.client_parcels || []).filter(p => p.order_id === order.id);
    const linkedShipments = [...new Set(boxes.map(b => b.shipment_ref).filter(Boolean))];
    const ordered = sum(items, item => item.ordered);
    const received = items.some(i => i.received !== undefined && i.received !== null)
      ? sum(items, i => i.received) : sum(lines, l => l.received);
    const notReceived = Math.max(0, ordered - received);
    const anomalies = items.some(i => i.anomaly !== undefined) ? sum(items, i => i.anomaly) : sum(lines, l => l.anomaly);
    const openNeeds = sum(needs, need => need.quantity);
    const toSource = sum(items, item => item.sourcing_required === true ? item.purchasing_missing : 0);
    const notSent = po.some(p => !p.sent_at);
    const draft = po.some(p => p.stage === 'draft');
    const boxQty = sum(boxes, b => sum((b.contents || []).filter(c => c.order_id === order.id), c => c.qty));
    const inBoxes = Math.max(boxQty, sum(items, i => i.in_boxes));
    const inBags = sum(items, i => i.in_bags);
    const readyToPack = Math.max(0, received - inBoxes - inBags);
    const packedBoxes = boxes.filter(b => b.state === 'DISPATCHED');
    const readyBoxes = packedBoxes.filter(b => !b.shipment_ref);
    const boxesToFinish = boxes.filter(b => b.state !== 'DISPATCHED');
    const handed = boxes.filter(b => shipmentLevel(b.shipment_stage) >= 1);
    const relayed = boxes.filter(b => b.shipment_stage === 'relay_received');
    const handedQty = sum(handed, b => sum((b.contents || []).filter(c => c.order_id === order.id), c => c.qty));
    const relayedQty = sum(relayed, b => sum((b.contents || []).filter(c => c.order_id === order.id), c => c.qty));
    const collectedQty = sum(parcels.filter(p => p.status === 'collected'),
      p => sum(p.contents, c => c.quantity));
    const fullyCollected = ordered > 0 && collectedQty >= ordered && notReceived === 0;
    const allHanded = ordered > 0 && handedQty >= ordered && notReceived === 0;
    const allRelayed = ordered > 0 && relayedQty >= ordered && notReceived === 0;
    const mixedDetail = handedQty > 0 && notReceived > 0
      ? 'Transport : ' + handedQty + '/' + ordered + ' · Réception attendue : ' + notReceived + '/' + ordered
      : '';
    const refs = linkedShipments.join(', ');
    let current_phase = 'Achats', current_status = 'À traiter';
    let current_expected = '', next_action = '', current_key = 'po';
    if (toSource) {
      current_status = 'Bloqué · sourcing requis';
      current_expected = 'Identifier le fournisseur de ' + toSource + ' article(s)';
      next_action = 'Résoudre le sourcing';
    } else if (!po.length || openNeeds) {
      current_status = openNeeds ? 'À traiter · ' + openNeeds + ' article(s) sans PO' : 'PO absente · achats à préparer';
      current_expected = 'Constituer les bons de commande nécessaires';
      next_action = 'Constituer PO';
    } else if (draft) {
      current_status = 'PO brouillon';
      current_expected = 'Compléter la PO et obtenir la validation requise';
      next_action = 'Compléter PO';
    } else if (notSent) {
      current_phase = 'Fournisseur'; current_key = 'supplier';
      current_status = 'Envoi non attesté';
      current_expected = 'Attester la transmission réelle au fournisseur';
      next_action = 'Prouver l’envoi fournisseur';
    } else if (anomalies) {
      current_phase = 'Réception Hub'; current_key = 'reception';
      current_status = 'Bloqué · ' + anomalies + ' article(s) à contrôler';
      current_expected = 'Résoudre les écarts avant de continuer';
      next_action = 'Contrôler les écarts';
    } else if (notReceived) {
      current_phase = 'Réception Hub';
      current_status = received ? 'Partielle · ' + received + '/' + ordered + ' reçus' : 'En attente fournisseur';
      if (readyToPack > 0) {
        current_key = 'cartons';
        current_expected = 'Emballer les ' + readyToPack + ' article(s) reçus · ' + notReceived + ' attendu(s)';
        next_action = 'Emballer les articles reçus';
      } else {
        current_key = 'reception';
        current_expected = 'Attendre ' + notReceived + ' article(s) du fournisseur';
        next_action = received ? 'Attente du reliquat' : 'Attendre le fournisseur';
      }
    } else if (readyToPack > 0 || !boxes.length || boxesToFinish.length) {
      current_phase = 'Emballage'; current_key = 'cartons';
      current_status = 'À faire maintenant';
      current_expected = readyToPack > 0 ? 'Mettre ' + readyToPack + ' article(s) reçu(s) en carton'
        : boxesToFinish.length ? 'Contrôler et fermer les cartons en cours' : 'Préparer le carton';
      next_action = readyToPack > 0 || !boxes.length ? 'Préparer le carton' : 'Fermer les cartons';
    } else if (readyBoxes.length) {
      current_phase = 'Départ'; current_key = 'departure';
      current_status = 'Carton prêt à rattacher';
      current_expected = 'Rattacher les cartons prêts à une expédition';
      next_action = 'Rattacher la KOM-BOX';
    } else if (linkedShipments.length && handed.length < boxes.filter(b => b.shipment_ref).length) {
      current_phase = 'Départ'; current_key = 'departure';
      current_status = 'Expédition préparée · remise non attestée';
      current_expected = 'Attester la remise effective au transitaire';
      next_action = 'Attester la remise au transitaire';
    } else if (handed.length && !allRelayed) {
      current_phase = handed.some(b => shipmentLevel(b.shipment_stage) >= 3) ? 'Transport' : 'Transitaire';
      current_key = 'departure';
      current_status = 'Remise au transitaire attestée';
      current_expected = 'Attendre la réception attestée au relais';
      next_action = 'Suivre l’acheminement';
    } else if (allRelayed && !fullyCollected) {
      current_phase = 'Remise client'; current_key = 'remaining';
      current_status = 'Au relais · remise client en attente';
      current_expected = 'Attendre la preuve de remise au client';
      next_action = 'Suivre la remise client';
    } else if (fullyCollected) {
      current_phase = 'Terminé'; current_key = 'remaining';
      current_status = 'Remise client attestée';
      current_expected = 'Tous les articles remis · aucun reliquat';
      next_action = 'Aucune action · aucun reliquat';
    } else {
      current_phase = 'Suivi'; current_key = 'remaining';
      current_status = 'Preuve de remise à vérifier';
      current_expected = 'Vérifier les réceptions et la remise client';
      next_action = 'Consulter la traçabilité';
    }

    // Un QR émis est une identité persistée, jamais la preuve d’une impression ou d’un tri.
    const labelsKnown=items.length>0 && items.every(i=>Number.isSafeInteger(i.article_labels_issued)&&i.article_labels_issued>=0);
    const labelCount=labelsKnown?sum(items,i=>i.article_labels_issued):null;
    const labelState=!labelsKnown?'unknown':labelCount>received?'critical':!received?'muted':labelCount<received?'ready':notReceived?'progress':'complete';
    const stage_states = {
      labels:labelState,
      po: toSource ? 'warning' : !po.length ? 'waiting' : draft || openNeeds ? 'progress' : 'complete',
      supplier: !po.length ? 'muted' : notSent ? 'warning' : notReceived ? 'progress' : 'complete',
      reception: !received ? 'muted' : anomalies ? 'critical' : notReceived ? 'warning' : 'complete',
      cartons: allHanded ? 'locked' : !boxes.length ? (received ? 'ready' : 'muted')
        : boxesToFinish.length ? 'progress' : readyToPack ? 'ready' : 'complete',
      departure: allHanded ? 'locked' : handed.length ? 'progress'
        : linkedShipments.length || readyBoxes.length ? 'ready' : 'muted',
      remaining: fullyCollected ? 'locked' : anomalies ? 'critical' : notReceived ? 'warning'
        : handed.length || allRelayed ? 'progress' : 'muted',
    };
    const stage_notes = {
      labels:labelsKnown?labelCount+'/'+received+' QR article(s) émis pour les unités reçues · impression physique non attestée':'Émission QR non renseignée',
      po: po.length + ' bon(s) de commande · ' + openNeeds + ' article(s) encore à grouper',
      supplier: notSent ? 'Transmission fournisseur non attestée' : 'Transmission fournisseur attestée',
      reception: received + '/' + ordered + ' reçu(s) · ' + notReceived + ' attendu(s)',
      cartons: inBoxes + '/' + ordered + ' placé(s) en carton · ' + packedBoxes.length + ' carton(s) fermé(s)',
      departure: handed.length ? 'Remise attestée : ' + (refs || 'référence indisponible')
        : linkedShipments.length ? 'Expédition ' + refs + ' créée ; remise non attestée'
          : 'Aucune remise au transitaire attestée',
      remaining: fullyCollected ? 'Remise client attestée · aucun reliquat'
        : notReceived ? notReceived + ' non reçu(s) · ' + Math.max(0, ordered - collectedQty) + ' non remis au client'
          : relayedQty ? relayedQty + '/' + ordered + ' au relais · remise client à confirmer'
            : 'Remise finale non attestée',
    };
    result.push({
      id: order.id, reference: order.reference, market: market.code, market_name: market.name,
      relay_name: order.relay_name || null,
      po: toSource ? 'Sourcing requis' : !po.length ? 'À constituer' : draft ? 'Brouillon' : po.length + ' PO liée(s)',
      supplier: !po.length ? 'Non commandé' : notSent ? 'Envoi à prouver' :
        notReceived ? 'Attente fournisseur' : 'Réception au Hub',
      reception: received ? received + ' / ' + ordered + ' reçu(s)' : 'Non reçue',
      cartons: boxes.length ? inBoxes + '/' + ordered + ' en carton · ' + packedBoxes.length + ' fermé(s)' :
        parcels.length ? 'Colis client en préparation' : 'À préparer',
      departure: handed.length ? 'Remise attestée · ' + handedQty + '/' + ordered :
        linkedShipments.length ? 'Expédition préparée · remise non attestée' :
          readyBoxes.length ? 'Prêt à rattacher' : 'Pas de départ attesté',
      remaining: notReceived ? notReceived + ' à recevoir' : anomalies ? anomalies + ' à contrôler' :
        fullyCollected ? 'Aucun reliquat · remise attestée' : 'Remise client à confirmer',
      remaining_detail: [anomalies && anomalies + ' à contrôler', toSource && toSource + ' à sourcer',
        openNeeds && openNeeds + ' à acheter', mixedDetail].filter(Boolean).join(' · '),
      attention: Boolean(notReceived || anomalies || toSource || openNeeds || !po.length || notSent),
      stage_states, stage_notes, current_key, current_phase, current_status,
      physical_focus:current_key==='cartons'&&labelState==='ready'?'labels':current_key,
      qr_issued_count:labelCount,
      current_expected, current_detail: mixedDetail, next_action,
    });
  }
  return result;
}

// Projection de travail PO : une ligne par PO réelle, jamais une PO fictive
// créée depuis une commande. Les quantités restent celles du dossier canonique.
// Pas d'attribution COMBOX par PO déduite d'un simple order_id : une commande
// peut être répartie entre plusieurs PO, et une COMBOX peut mixer plusieurs PO.
function summarizePurchaseOrders(market, payload) {
  const seen = new Set();
  const result = [];
  for (const po of payload.purchase_orders || []) {
    if (!po.id || seen.has(po.id)) continue;
    seen.add(po.id);
    const lines = po.lines || [];
    const orders = [...new Set(lines.map(l => l.order_ref).filter(Boolean))];
    const cancelled = po.status === 'cancelled' || po.stage === 'cancelled';
    const expected = sum(lines, l => l.confirmed);
    const received = sum(lines, l => l.received);
    const missing = sum(lines, l => l.missing == null ? Math.max(0, number(l.confirmed) - number(l.received)) : l.missing);
    const anomalies = sum(lines, l => l.anomaly);
    const linkedBoxes=(payload.boxes||[]).filter(b=>(b.contents||[]).some(c=>String(c.purchase_order_id||'')===String(po.id)));
    const qty=boxes=>sum(boxes,b=>sum((b.contents||[]).filter(c=>String(c.purchase_order_id||'')===String(po.id)),c=>c.qty));
    const validBoxes=linkedBoxes.filter(b=>!['QUARANTINED','SUPERSEDED'].includes(b.state));
    const dispatched=validBoxes.filter(b=>b.state==='DISPATCHED');
    const handed=dispatched.filter(b=>shipmentLevel(b.shipment_stage)>=1);
    result.push({
      id: po.id, reference: po.ref || po.id,
      market: market.code, supplier: po.supplier_name || null,
      order_references: orders, order_count: new Set(lines.map(l => l.order_id).filter(Boolean)).size,
      // Projection minimale, uniquement les lignes réellement rattachées à cette PO.
      // Aucun nom, téléphone, paiement ou autre article de la commande.
      order_lines: lines.filter(l => l.order_ref).map(l => ({
        order_ref:l.order_ref, product:l.product || null,
        product_sku_id:l.product_sku_id || null, ordered:number(l.ordered),
        fifo_rank:Number.isInteger(l.fifo_rank)?l.fifo_rank:null, fifo_next:l.fifo_next===true,
        expected:number(l.confirmed), received:number(l.received),
        missing:l.missing == null ? Math.max(0,number(l.confirmed)-number(l.received)) : number(l.missing),
      })),
      ordered: sum(lines, l => l.ordered), expected, received, missing, anomalies,
      purchase_stage: po.stage || null, purchase_step: po.step?.key || null,
      sent_at: po.sent_at || null, sent_channel: po.sent_channel || null,
      confirmed_at: po.confirmed_at || null,
      receipt_evidence: (payload.receipts || []).filter(r => (r.po_ids || []).some(id => String(id) === String(po.id)))
        .map(r => ({ reference:r.reference, state:r.state, received_at:r.received_at })),
      exceptions: (payload.to_handle || []).filter(t => String(t.po_id || '') === String(po.id))
        .map(t => ({ kind:t.kind, reason:t.reason })),
      trigger_mode: po.trigger_mode || null, sent: Boolean(po.sent_at),
      cancelled,
      // Réception complète ne signifie ni qualité validée, ni départ Hub.
      reception_complete: !cancelled && expected > 0 && missing === 0 && received >= expected && anomalies === 0,
      boxed_quantity:qty(validBoxes), dispatched_quantity:qty(dispatched), handed_quantity:qty(handed),
      box_count:validBoxes.length, shipment_count:new Set(validBoxes.map(b=>b.shipment_ref).filter(Boolean)).size,
    });
  }
  return result;
}

// Charge réelle du Hub, par marché / relais / rail demandé, sans identités client.
// Les cartons fermés ou sortis ne deviennent jamais une preuve de remise.
function summarizeLogisticsWork(market,payload) {
  const groups=new Map(), seenBoxes=new Set();
  const key=row=>row.relais_id?JSON.stringify([String(row.relais_id),row.requested_transport_rail||null]):null;
  const get=row=>{
    const k=key(row);
    if(!k)return null;
    if(!groups.has(k))groups.set(k,{market:market.code,relay:String(row.relais_id),relay_code:row.relais_code||'Relais à vérifier',rail:row.requested_transport_rail||null,group_key:k,to_pack:0,boxes_in_progress:0,boxes_to_dispatch:0,boxes_to_attach:0,boxes_to_handover:0});
    return groups.get(k);
  };
  for(const row of payload.fillable||[]){
    if(!['QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED'].includes(row.source_state)||number(row.quantity)===0)continue;
    const group=get(row);if(group)group.to_pack+=number(row.quantity);
  }
  for(const box of payload.boxes||[]){
    if(!box.unit_id||seenBoxes.has(box.unit_id)||['QUARANTINED','SUPERSEDED'].includes(box.state))continue;
    seenBoxes.add(box.unit_id);
    const contents=box.contents||[];
    if(!contents.length||!key(contents[0])||!contents.every(row=>key(row)===key(contents[0])))continue;
    if(box.shipment_ref&&box.shipment_stage!=='hub_ready')continue;
    if(!['RECEIVED','IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED','PACKED','DISPATCHED'].includes(box.state))continue;
    const group=get(contents[0]);
    if(box.state==='PACKED'&&!box.shipment_ref)group.boxes_to_dispatch++;
    else if(box.state==='DISPATCHED'&&!box.shipment_ref)group.boxes_to_attach++;
    else if(box.state==='DISPATCHED'&&box.shipment_stage==='hub_ready')group.boxes_to_handover++;
    else if(!box.shipment_ref&&box.state!=='DISPATCHED'&&box.state!=='PACKED')group.boxes_in_progress++;
  }
  return [...groups.values()].filter(g=>g.to_pack+g.boxes_in_progress+g.boxes_to_dispatch+g.boxes_to_attach+g.boxes_to_handover>0)
    .sort((a,b)=>a.relay_code.localeCompare(b.relay_code)||String(a.rail||'').localeCompare(String(b.rail||'')));
}

// La vérité Hub reste centrale. Le responsable marché ne reçoit qu'une projection
// filtrée par ses market_id résolus côté serveur, AVANT lecture des dossiers.
// Aucun filtrage client ne peut servir de garde de sécurité.
async function getGlobalBoard(query = db, dossierReader = (marketId) => dossier.getDossier({ marketId }, query), { marketIds = null, includePurchaseOrders = false } = {}) {
  const scoped = Array.isArray(marketIds);
  const { rows: markets } = scoped
    ? await query.query(
      'SELECT id, code, name FROM markets WHERE is_active = TRUE AND id = ANY($1::uuid[]) ORDER BY code',
      [marketIds]
    )
    : await query.query('SELECT id, code, name FROM markets WHERE is_active = TRUE ORDER BY code');
  const orders = [];
  const purchaseOrders = [];
  const logisticsWork = [];
  for (const market of markets) {
    const payload = await dossierReader(market.id);
    orders.push(...summarizeMarket(market, payload));
    // Ne jamais exposer la projection fournisseurs à un responsable marché.
    if (includePurchaseOrders && !scoped) {
      purchaseOrders.push(...summarizePurchaseOrders(market, payload));
      logisticsWork.push(...summarizeLogisticsWork(market,payload));
    }
  }
  return {
    scope: 'HUB_GLOBAL',
    ...(scoped ? { audience: 'MARKET_SCOPED' } : {}),
    markets: markets.map(m => m.code),
    ...(includePurchaseOrders && !scoped ? { purchase_orders: purchaseOrders.sort((a,b) => a.market.localeCompare(b.market) || a.reference.localeCompare(b.reference)), logistics_work:logisticsWork } : {}),
    orders: orders.sort((a, b) => a.market.localeCompare(b.market) || a.reference.localeCompare(b.reference)),
  };
}

module.exports = { summarizeMarket, summarizePurchaseOrders, summarizeLogisticsWork, getGlobalBoard };

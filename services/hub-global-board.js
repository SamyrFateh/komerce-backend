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

function summarizeMarket(market, payload) {
  const result = [];
  for (const order of payload.orders || []) {
    const po = (payload.purchase_orders || []).filter(p => (p.lines || []).some(l => l.order_id === order.id));
    const lines = po.flatMap(p => (p.lines || []).filter(l => l.order_id === order.id));
    const needs = (payload.needs || []).filter(n => n.order_id === order.id);
    const boxes = (payload.boxes || []).filter(b => (b.contents || []).some(c => c.order_id === order.id));
    const linkedShipments = new Set(boxes.filter(b => b.shipment_ref).map(b => b.shipment_ref));
    const ordered = sum(order.items, item => item.ordered);
    const received = sum(lines, line => line.received);
    const notReceived = Math.max(0, ordered - received);
    const anomalies = sum(lines, line => line.anomaly);
    const openNeeds = sum(needs, need => need.quantity);
    const notSent = po.some(p => !p.sent_at);
    const draft = po.some(p => p.stage === 'draft');
    result.push({
      id: order.id,
      reference: order.reference,
      market: market.code,
      market_name: market.name,
      po: !po.length ? 'À constituer' : draft ? 'Brouillon' : po.length + ' PO liée(s)',
      supplier: !po.length ? 'Non commandé' : notSent ? 'Envoi à prouver' :
        notReceived ? 'Attente fournisseur' : 'Réception au Hub',
      reception: received ? received + ' / ' + ordered + ' reçu(s)' : 'Non reçue',
      cartons: boxes.length ? boxes.length + ' KOM-BOX' :
        (payload.client_parcels || []).some(p => p.order_id === order.id) ? 'Colis en préparation' : 'À préparer',
      departure: linkedShipments.size ? linkedShipments.size + ' expédition(s) liée(s)' : 'Pas de départ',
      remaining: notReceived ? notReceived + ' non reçue(s)' :
        anomalies ? anomalies + ' à contrôler' : 'À suivre',
      remaining_detail: [anomalies && anomalies + ' à contrôler', openNeeds && openNeeds + ' à acheter']
        .filter(Boolean).join(' · '),
      attention: Boolean(notReceived || anomalies || openNeeds || !po.length || notSent),
    });
  }
  return result;
}

// Le marché n'est JAMAIS un filtre d'autorité du Hub central. Cette projection
// n'expose que les états de travail, jamais contacts clients, prix, paiements,
// pièces fournisseurs ou contenu détaillé des produits.
async function getGlobalBoard(query = db, dossierReader = (marketId) => dossier.getDossier({ marketId }, query)) {
  const { rows: markets } = await query.query(
    'SELECT id, code, name FROM markets WHERE is_active = TRUE ORDER BY code'
  );
  const orders = [];
  for (const market of markets) {
    orders.push(...summarizeMarket(market, await dossierReader(market.id)));
  }
  return {
    scope: 'HUB_GLOBAL',
    markets: markets.map(m => m.code),
    orders: orders.sort((a, b) => a.market.localeCompare(b.market) || a.reference.localeCompare(b.reference)),
  };
}

module.exports = { summarizeMarket, getGlobalBoard };

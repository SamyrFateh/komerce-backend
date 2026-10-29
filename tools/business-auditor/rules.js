'use strict';

/**
 * Independent, declarative evidence registry.
 * Only exact SQL invariants that were calibrated with disposable PostgreSQL.
 * These are READ-ONLY signals to investigate, NOT automatic bug verdicts.
 * The scanner imports NO Komerce runtime service or business writer.
 */
const RULES=Object.freeze([
 {
  id:'KBA-001',issue:3064,priority:'P1',boundary:'P3_P6_PURCHASE_COST',
  name:'Allocation de coût rattachée à une autre commande que son article',
  grain:'order_item_real_cost_allocations.id',owner:'Economic Engine',
  interpretation:'Une allocation et son order_item doivent appartenir à la même commande',
  sql:"SELECT ca.id::text AS ref FROM order_item_real_cost_allocations ca JOIN order_items oi ON oi.id=ca.order_item_id WHERE ca.order_id<>oi.order_id ORDER BY ca.id LIMIT $1",
 },
 {
  id:'KBA-002',issue:3065,priority:'P1',boundary:'P4_P6_LOGISTICS_COST',
  name:'Fret/douane lié à un colis qui ne contient pas cet article',
  grain:'order_item_real_cost_allocations.id',owner:'Logistics / Economic Engine',
  interpretation:'Le colis historique peut représenter une commande mais ne prouve pas une ligne article; vérification nécessaire',
  sql:"SELECT ca.id::text AS ref FROM order_item_real_cost_allocations ca WHERE ca.cost_type IN ('freight','customs') AND ca.parcel_id IS NOT NULL AND ca.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM parcel_items pi WHERE pi.parcel_id=ca.parcel_id AND pi.order_item_id=ca.order_item_id) ORDER BY ca.id LIMIT $1",
 },
 {
  id:'KBA-003',issue:3065,priority:'P1',boundary:'P4_P6_LOGISTICS_COST',
  name:'Frais logistique attribué à un colis absent de son expédition',
  grain:'order_item_real_cost_allocations.id',owner:'Logistics / Customs',
  interpretation:'Une allocation shipment/parcel doit respecter customs_shipment_parcels',
  sql:"SELECT ca.id::text AS ref FROM order_item_real_cost_allocations ca WHERE ca.cost_type IN ('freight','customs') AND ca.shipment_id IS NOT NULL AND ca.parcel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customs_shipment_parcels sp WHERE sp.shipment_id=ca.shipment_id AND sp.parcel_id=ca.parcel_id) ORDER BY ca.id LIMIT $1",
 },
 {
  id:'KBA-004',issue:3068,priority:'P1',boundary:'P5_P6_CASH_REALITY',
  name:'Collection cash rattachée à une commande Stripe',
  grain:'cash_collections.id',owner:'Payments',
  interpretation:'Le writer cash normal refuse les commandes stripe_eur; vérifier imports et états historiques',
  sql:"SELECT cc.id::text AS ref FROM cash_collections cc JOIN orders o ON o.id=cc.order_id WHERE o.payment_mode='stripe_eur' ORDER BY cc.id LIMIT $1",
 },
 {
  id:'KBA-005',issue:3071,priority:'P1',boundary:'P6_P1_PRICE_REVIEW',
  name:'Événement ACTIVATE prix sans acteur attribué',
  grain:'product_market_price_draft_events.id',owner:'Market Autonomy / Pricing',
  interpretation:'Un événement d audit sans acteur n atteste pas une vraie activation; examiner le writer et les imports',
  sql:"SELECT e.id::text AS ref FROM product_market_price_draft_events e WHERE e.action='ACTIVATE' AND e.actor_id IS NULL ORDER BY e.id LIMIT $1",
 },
 {
  id:'KBA-006',issue:3072,priority:'P1',boundary:'P7_P5_COUNTRY_SETTLEMENT',
  name:'Settlement READY rattaché à un mandat resté DRAFT',
  grain:'market_settlements.id',owner:'Market Settlement',
  interpretation:'Un mandat DRAFT jamais actif ne peut pas autoriser de nouveau READY; vérifier histoires de mandats',
  sql:"SELECT s.id::text AS ref FROM market_settlements s JOIN market_operating_assignments a ON a.id=s.assignment_id WHERE s.status='READY' AND a.status='DRAFT' ORDER BY s.id LIMIT $1",
 },
 {
  id:'KBA-007',issue:3062,priority:'P2',boundary:'P4_P2_RELAY_HANDOFF',
  name:'Scan de remise effectué dans un relais différent de celui de la commande',
  grain:'scans.id',owner:'Customer Handoff / Logistics',
  interpretation:'Possible transfert/retrait exceptionnel; hypothèse à arbitrer, pas faute prouvée automatiquement',
  sql:"SELECT s.id::text AS ref FROM scans s JOIN orders o ON o.id=s.order_id WHERE s.step='collected' AND s.pickup_relais_id IS NOT NULL AND o.relais_id IS NOT NULL AND s.pickup_relais_id<>o.relais_id ORDER BY s.id LIMIT $1",
 }
].map(rule=>Object.freeze(rule)));
module.exports={RULES};

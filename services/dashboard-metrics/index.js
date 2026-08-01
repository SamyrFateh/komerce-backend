/**
 * @komerce-arch
 * @role          dashboard-dashboard-metrics
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       ./_helpers, ./control-tower, ./costing, ./logistics
 * @used-by       routes/admin-dashboard.js
 * @db-read       order_item_cost_imputations, order_item_real_cost_allocations, orders, parcels, scan_events, signals
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Dashboard Metrics Service (Sprint 1) — barrel (Lot C3)
 * ════════════════════════════════════════════════════════════════════════
 *
 * DOCTRINE :
 *   Centralise les definitions canoniques des KPIs dashboard.
 *   Chaque KPI a UNE source de verite. Si deux vues affichent le meme
 *   KPI, elles appellent la meme fonction ici. Pas de SQL inline ailleurs.
 *
 * INVARIANTS GARANTIS :
 *   INV-1 : ca_encaisse == ca_vendu (memes filtres)
 *   INV-2 : cmds_actives identique sur Tour de controle et Logistique
 *   INV-3 : colis_transit identique
 *   INV-4 : taux_completude_couts coherent avec cmds_cout_incomplet
 *   INV-6 : marge hierarchy : items_actual ≤ items_partial ≤ items_estimated
 *
 * ENUM cost_status (canonique Sprint 1) :
 *   estimated     = snapshot pricing-engine seul, aucun cout reel
 *   partial_real  = couts variables alloues mais types attendus manquants
 *   actual        = tous les types attendus alloues (ex-'complete')
 *   incomplete    = imputation absente / cas pathologique
 *
 * cmds_actives = status IN (confirmed, ordered, preparation, shipped, in_transit, available)
 *   (PAS pending, PAS collected, PAS cancelled, PAS refunded)
 *
 * ── Lot C3 (Lot B/C Refacto) ─────────────────────────────────────────────
 * Ce fichier était un monolithe de 1081 lignes, 0 test. Découpé en 4
 * modules par domaine + un module de helpers communs, après pose de tests
 * de caractérisation (tests/unit/dashboard-metrics.test.js, 49 cas).
 * Ce barrel ré-exporte exactement la même interface publique qu'avant —
 * `require('../services/dashboard-metrics')` reste valide à l'identique
 * pour le seul appelant (routes/admin-dashboard.js).
 *
 *   _helpers.js       — buildFiltersClause, buildPreviousPeriod, computeDelta,
 *                       makeKpi, constantes (ACTIVE_ORDER_STATUSES, etc.)
 *   control-tower.js  — 8 KPIs (CA encaissé, commandes, alertes, scans...)
 *   costing.js        — 8 KPIs (CA vendu, coûts, marges...) — dépend de
 *                       control-tower.js pour getCAVendu (alias INV-1)
 *   logistics.js      — 7 KPIs + 1 alias — dépend de control-tower.js pour
 *                       getColisTransit (alias INV-3)
 *
 * Recoupement vérifié avant split (Lot B7) : aucun nom de fonction commun
 * avec services/dashboard-finance-metrics.js (domaine finance standalone,
 * appelant séparé routes/dashboard-finance.js) — pas de risque de collision.
 */

'use strict';

const helpers = require('./_helpers');
const controlTower = require('./control-tower');
const costing = require('./costing');
const logistics = require('./logistics');

module.exports = {
  // Helpers
  buildFiltersClause: helpers.buildFiltersClause,
  buildPreviousPeriod: helpers.buildPreviousPeriod,
  computeDelta: helpers.computeDelta,
  makeKpi: helpers.makeKpi,

  // Constantes
  ACTIVE_ORDER_STATUSES: helpers.ACTIVE_ORDER_STATUSES,
  TRANSIT_PARCEL_STATUSES: helpers.TRANSIT_PARCEL_STATUSES,
  EXPECTED_VARIABLE_COSTS: helpers.EXPECTED_VARIABLE_COSTS,
  EXPECTED_FIXED_COSTS: helpers.EXPECTED_FIXED_COSTS,
  EXPECTED_PAYMENT_COSTS: helpers.EXPECTED_PAYMENT_COSTS,

  // Tour de controle (8)
  getCAEncaisse: controlTower.getCAEncaisse,
  getCmdsCreees: controlTower.getCmdsCreees,
  getCmdsActives: controlTower.getCmdsActives,
  getColisEnTransit: controlTower.getColisEnTransit,
  getAlertesCritiques: controlTower.getAlertesCritiques,
  getCmdsBloquees: controlTower.getCmdsBloquees,
  getTauxCompletudeScans: controlTower.getTauxCompletudeScans,
  getTauxCompletudeCouts: controlTower.getTauxCompletudeCouts,

  // Costing (8)
  getCAVendu: costing.getCAVendu,
  getCoutEstime: costing.getCoutEstime,
  getCoutReel: costing.getCoutReel,
  getMargeEstimee: costing.getMargeEstimee,
  getMargeVariableReelle: costing.getMargeVariableReelle,
  getMargeConsolidee: costing.getMargeConsolidee,
  getCmdsCoutIncompletCount: costing.getCmdsCoutIncompletCount,
  getCmdsCoutIncompletIds: costing.getCmdsCoutIncompletIds,
  getCoutMoyParCmd: costing.getCoutMoyParCmd,

  // Logistics (8)
  getCmdsAujourdhui: logistics.getCmdsAujourdhui,
  getPaiementsEnAttente: logistics.getPaiementsEnAttente,
  getColisPreparation: logistics.getColisPreparation,
  getColisTransit: logistics.getColisTransit,
  getDisponiblesRelais: logistics.getDisponiblesRelais,
  getRetardsCritiques: logistics.getRetardsCritiques,
  getTauxCollecteRelais: logistics.getTauxCollecteRelais,
  // getTauxCompletudeScans deja exporte (control-tower)
};

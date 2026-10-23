/**
 * @komerce-arch
 * @role          market-operation-guard
 * @domain        markets
 * @layer         service
 * @criticality   high
 * @inputs        market_id_or_code, operation
 * @outputs       allowed_or_typed_409_error
 * @depends       db
 * @used-by       routes/admin-pricing-workspace.js, routes/market-delegation-catalog.js, services/customs-shipment-service.js
 * @db-read       markets
 * @db-write      none
 * @db-txn        caller_executor
 * @doctrine      market_status_matrix_q2, new_commitments_refused_when_not_active, existing_obligations_never_blocked
 * @impact-areas  markets, pricing, catalog, customs
 * @version       2026-10
 */

'use strict';

// Matrice Q2 (architecture V2 §6) : seules les opérations ⛔ de la matrice sont gardées ici.
// Les obligations (hub, relais, comptabilité, remboursement, règlements) ne passent JAMAIS par ce garde.
const ACTIVE = 'ACTIVE';
const SUSPENDED = 'SUSPENDED';
const PROVISIONING = 'PROVISIONING';

const OPERATION_STATUSES = Object.freeze({
  // Prix local : brouillon permis en préparation ; activation et exposition seulement sur marché actif.
  local_price_draft: Object.freeze([ACTIVE, PROVISIONING]),
  local_price_activate: Object.freeze([ACTIVE]),
  // Retour en arrière : permis partout sauf marché fermé.
  local_price_reset: Object.freeze([ACTIVE, SUSPENDED, PROVISIONING]),
  catalog_exposure_enable: Object.freeze([ACTIVE]),
  // Nouvelle expédition douane : permise si marché suspendu UNIQUEMENT pour des colis de commandes existantes.
  customs_shipment_create: Object.freeze([ACTIVE, SUSPENDED]),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function operationError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/**
 * Refuse (409 MARKET_SUSPENDED / MARKET_NOT_ACTIVE) une opération qui crée un nouvel engagement
 * sur un marché dont le statut ne la permet pas. `marketRef` : UUID ou code marché.
 * options.carriesOnlyExistingOrders : pour customs_shipment_create sur marché suspendu.
 */
async function assertMarketOperationAllowed(executor, marketRef, operation, options = {}) {
  const allowed = OPERATION_STATUSES[operation];
  if (!allowed) throw new Error(`market_operation_unknown:${operation}`);
  if (!marketRef) return null; // opération sans marché (ex. expédition globale) : hors périmètre du garde
  const byId = UUID_RE.test(String(marketRef));
  const { rows: [market] } = await executor.query(
    `SELECT id, code, lifecycle_status FROM markets WHERE ${byId ? 'id = $1::uuid' : 'code = $1'} LIMIT 1`,
    [byId ? marketRef : String(marketRef).toUpperCase()]
  );
  if (!market) throw operationError(404, 'market_not_found', 'Marché introuvable.');
  const status = market.lifecycle_status;
  if (allowed.includes(status)) {
    if (status === SUSPENDED && operation === 'customs_shipment_create' && !options.carriesOnlyExistingOrders) {
      throw operationError(409, 'MARKET_SUSPENDED', 'Ce marché est suspendu : une expédition douane ne peut porter que des colis de commandes existantes.');
    }
    return market;
  }
  if (status === SUSPENDED) {
    throw operationError(409, 'MARKET_SUSPENDED', 'Ce marché est suspendu : aucun nouvel engagement n’est possible.');
  }
  throw operationError(409, 'MARKET_NOT_ACTIVE', 'Ce marché n’est pas actif pour cette opération.');
}

module.exports = { OPERATION_STATUSES, assertMarketOperationAllowed };

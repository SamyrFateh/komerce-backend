/**
 * @komerce-arch
 * @role          orders-cancel-order-purchase-orders-boundary
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/purchasing-cancel-service.js
 * @used-by       services/order-status-machine.js
 * @db-read       none
 * @db-write      none
 * @db-txn        caller_managed
 * @doctrine      writer_not_owner_campaign_2026_08
 * @impact-areas  orders, purchasing, cancellation
 * @version       2026-08
 */

'use strict';

/**
 * Compatibilité orders -> purchasing.
 *
 * Ce module ne porte plus aucun SQL et n'est plus autorité sur purchase_orders.
 * Il conserve le chemin historique consommé par order-status-machine.js et
 * délègue intégralement au service propriétaire du domaine purchasing.
 */

module.exports = require('./purchasing-cancel-service');

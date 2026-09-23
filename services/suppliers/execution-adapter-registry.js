/**
 * @komerce-arch
 * @role          execution-adapter-registry
 * @domain        purchasing
 * @layer         service
 * @criticality   medium
 * @inputs        none (static composition root)
 * @outputs       map of provider code -> fulfillment adapter object
 * @depends       services/suppliers/allegro-fulfillment-adapter.js, services/suppliers/aliexpress-fulfillment-adapter.js
 * @used-by       services/purchasing-trigger-service.js (GAP-2, GAP-4A/4B, GAP-5)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md
 * @impact-areas  purchasing
 * @version       2026-09
 *
 * GAP-2 — Adapter Resolution.
 *
 * Composition root unique listant les fulfillment adapters connus de
 * Komerce. Ce n'est pas une nouvelle abstraction : c'est le même type
 * d'objet que celui déjà attendu par
 * services/suppliers/canonical-unit-purchasing-gate.js (paramètre
 * `adapters`) et services/suppliers/supplier-fulfillment-readiness.js —
 * validé par le même contrat, services/suppliers/supplier-fulfillment-
 * adapter-contract.js:validateAdapter().
 *
 * Le registre est branché au chemin réel dans
 * services/purchasing-trigger-service.js. GAP-2 a installé la résolution
 * d'adapter ; GAP-4A utilise cette même map dans la readiness canonique
 * (canonical-unit-purchasing-gate.js) et GAP-4B utilise la frontière
 * d'exécution séparée (procurement-execution-boundary.js).
 * GAP-5 a ajouté la frontière evidence -> verify/reconcile -> confirm.
 * Ces étapes sont livrées (#1599, #1601, #1606), non futures.
 * Un provider est enregistré une seule fois dans cette map ; ses capacités
 * sont vérifiées par le consommateur correspondant, sans deuxième registre.
 *
 * Aucun des deux adapters actuels n'expose `placeOrder` — c'est un fait
 * du domaine (ni Allegro ni AliExpress n'offrent de buyer checkout API
 * dans le contrat prouvé par Komerce), pas une lacune de ce registre.
 */
'use strict';

const allegroFulfillmentAdapter = require('./allegro-fulfillment-adapter');
const aliexpressFulfillmentAdapter = require('./aliexpress-fulfillment-adapter');

const EXECUTION_ADAPTER_REGISTRY = Object.freeze({
  allegro: allegroFulfillmentAdapter,
  aliexpress: aliexpressFulfillmentAdapter,
});

module.exports = { EXECUTION_ADAPTER_REGISTRY };

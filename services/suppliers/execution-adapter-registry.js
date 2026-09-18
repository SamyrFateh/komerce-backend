/**
 * @komerce-arch
 * @role          execution-adapter-registry
 * @domain        purchasing
 * @layer         service
 * @criticality   medium
 * @inputs        none (static composition root)
 * @outputs       map of provider code -> fulfillment adapter object
 * @depends       services/suppliers/allegro-fulfillment-adapter.js, services/suppliers/aliexpress-fulfillment-adapter.js
 * @used-by       services/purchasing-trigger-service.js (GAP-2)
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
 * Avant ce fichier, aucun composition root n'assemblait cette map nulle
 * part dans le chemin réel : le gate et la readiness ne sont exercés que
 * par des scripts Golden (cf. GAP-0). GAP-2 en crée le premier usage réel
 * (résolution d'exécution auto-order dans purchasing-trigger-service.js).
 *
 * GAP-4 (branchement du gate sur le vrai chemin Purchasing) doit
 * réutiliser CETTE MÊME map pour l'injecter dans le gate, plutôt que
 * d'en construire une seconde. Un futur provider s'enregistre ici une
 * seule fois, consommé par les deux usages (preflight readiness et
 * résolution d'exécution auto-order).
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

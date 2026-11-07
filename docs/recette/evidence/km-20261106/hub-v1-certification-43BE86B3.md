# Certification Hub V1 — fixture E2E-HUB-V1-43BE86B3

- Mode : APPLY_OFFICIAL_STAGING · base : railway (official-railway-staging)
- Verdict : **PASS_STAGING_TRANSACTION_13_STEPS** · staging : **TRANSACTIONAL_PASS_CHROMIUM_PENDING** (aucun GO staging)
- Commandes : E2E-HUB-V1-43BE86B3-KOM-101, E2E-HUB-V1-43BE86B3-KOM-102, E2E-HUB-V1-43BE86B3-KOM-103, E2E-HUB-V1-43BE86B3-LOCAL

## Étapes

| # | Étape | Statut | Writers | Refus prouvés | Idempotence |
|---|---|---|---|---|---|
| 1 | Commandes par checkout canonique | PASS | order-checkout-service.runOrderCheckout (internalSimulation E2E-HUB-V1) | 5 | 4 |
| 2 | Paiement client fictif sans débit | PASS | hub-v1-fixture-payment.confirmFixturePayment → payment-service.markPaid + order-status-machine | 2 | 4 |
| 3 | Préparation et regroupement des PO | PASS | purchasing-trigger-service.triggerPurchasing<br>purchasing-grouped-service.preparePurchaseOrder | 2 | 5 |
| 4 | Autorisation d'engagement (responsable Hub) | PASS | hub-authorization-service.decide(purchase_commitment)<br>hub-authorization-service.grant | 10 | 2 |
| 5 | Soumission et envoi fournisseur simulé | PASS | purchasing-engagement-service.submitPurchaseOrder<br>purchasing-engagement-service.recordPurchaseOrderSent | 4 | 2 |
| 6 | Autorisation distincte du paiement fournisseur (sans débit) | PASS | hub-authorization-service.decide(supplier_payment)<br>hub-authorization-service.assertPaymentAuthorized | 6 | 2 |
| 7 | Confirmation fournisseur | PASS | purchasing-engagement-service.confirmGroupedPurchaseOrder | 4 | 2 |
| 8 | Réception partielle Hub (FIFO) | PASS | hub-operations.receiveSupplierPackageCommand → hub-physical-identity (allocation FIFO par ligne) | 2 | 1 |
| 9 | Identification, scans et sacs clients | PASS | hub-operations.transitionOperatorUnitCommand<br>hub-operations.createOperatorUnitCommand (HANDLING_UNIT / KOM-SAC)<br>hub-operations.moveAllocationCommand (REPACK, preuve SCAN) | 2 | 0 |
| 10 | Emballage et rattachement KOM-BOX | PASS | auto-parcel.distributeOrder<br>hub-operations.createOperatorUnitCommand (KOM-BOX)<br>hub-bag-box-service.attachBagToBox<br>hub-operations.transitionOperatorUnitCommand (PACKED) | 1 | 2 |
| 11 | Expédition et remise au transitaire | PASS | international-shipment-journey.open / transition (handed_over, forwarder_received)<br>hub-operations.transitionOperatorUnitCommand (DISPATCHED) | 3 | 0 |
| 12 | Réception attestée au relais | PASS | international-shipment-journey (in_transit … local_delivery)<br>customs-shipment-service.createShipment<br>relay-shipment-receipt.receiveShipment (agent relais) | 7 | 0 |
| 13 | Retrait client et traitement du reliquat | PASS | scan-engine.processScan(customer_collected)<br>hub-operations.receiveSupplierPackageCommand (reliquat)<br>local-relay-receipt-service.recordLocalRelayReceipt (LOCAL) | 3 | 4 |

### 1. Commandes par checkout canonique — PASS
- Acteurs : `{"client":"c6a1c48b-1ea4-411e-9355-5af263e58a2b","admin_simulation_actor":"51230920-3a58-4737-a9a4-68482e448088"}`
- UUID : `{"KOM-101":"09fa498d-ef83-4085-ab59-4e0003e0754d","KOM-102":"279510c1-3d82-435c-a7da-e903e87fc165","KOM-103":"84686cb6-3c7c-4542-99cb-adb851635f7a","LOCAL":"f2d9ecf5-3bbd-4f13-be1c-610a43a9f942"}`
- Statuts : `{"KOM-101":"pending/pending","KOM-102":"pending/pending","KOM-103":"pending/pending","LOCAL":"pending/pending"}`
- Quantités : `{"KOM-101":[1,2],"KOM-102":[1],"KOM-103":[2],"LOCAL":[1]}`
- Refus : checkout rejoué KOM-101 → HUB_V1_ORDER_ALREADY_EXISTS
- Refus : checkout rejoué KOM-102 → HUB_V1_ORDER_ALREADY_EXISTS
- Refus : checkout rejoué KOM-103 → HUB_V1_ORDER_ALREADY_EXISTS
- Refus : checkout rejoué LOCAL → HUB_V1_ORDER_ALREADY_EXISTS
- Refus : référence hors fixture → HUB_V1_INTERNAL_CHECKOUT_FORBIDDEN
- Idempotence : {"what":"checkout KOM-101","rows_after_replay":1,"no_duplicate":true}
- Idempotence : {"what":"checkout KOM-102","rows_after_replay":1,"no_duplicate":true}
- Idempotence : {"what":"checkout KOM-103","rows_after_replay":1,"no_duplicate":true}
- Idempotence : {"what":"checkout LOCAL","rows_after_replay":1,"no_duplicate":true}

### 2. Paiement client fictif sans débit — PASS
- Acteurs : `{"admin_simulation_actor":"51230920-3a58-4737-a9a4-68482e448088"}`
- UUID : `{"KOM-101":"09fa498d-ef83-4085-ab59-4e0003e0754d","KOM-102":"279510c1-3d82-435c-a7da-e903e87fc165","KOM-103":"84686cb6-3c7c-4542-99cb-adb851635f7a","LOCAL":"f2d9ecf5-3bbd-4f13-be1c-610a43a9f942"}`
- Statuts : `{"KOM-101":"ordered/paid","KOM-102":"ordered/paid","KOM-103":"ordered/paid","LOCAL":"ordered/paid"}`
- Quantités : `{}`
- Refus : paiement par un non-admin (client) → HUB_V1_FIXTURE_PAYMENT_ADMIN_REQUIRED
- Refus : paiement hors mode approuvé → HUB_V1_FIXTURE_PAYMENT_ENV_FORBIDDEN
- Idempotence : {"what":"paiement KOM-101","second_call_idempotent_replay":true}
- Idempotence : {"what":"paiement KOM-102","second_call_idempotent_replay":true}
- Idempotence : {"what":"paiement KOM-103","second_call_idempotent_replay":true}
- Idempotence : {"what":"paiement LOCAL","second_call_idempotent_replay":true}

### 3. Préparation et regroupement des PO — PASS
- Acteurs : `{"hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927"}`
- UUID : `{"PO_A":"48c651c2-1f5a-4a2d-b955-8d162dd243ba","PO_B":"fb2207a2-6a3b-472f-8547-d074952759fe","lines_A":["1d9094ec-4d4e-4e79-899e-49e6c0a6a364","efe04d60-2469-4f7f-af57-1df225bee807"],"lines_B":["4972ef69-41ea-468c-b9f9-0c84bdaa260b"]}`
- Statuts : `{"PO_A":"draft","PO_B":"draft"}`
- Quantités : `{"PO_A_ordered":3,"PO_B_ordered":1}`
- Refus : rattacher à nouveau des lignes déjà en PO → PURCHASE_LINES_ALREADY_ATTACHED
- Refus : ligne déjà engagée dans PO-B réutilisée dans une PO fournisseur A → PURCHASE_LINES_ALREADY_ATTACHED
- Idempotence : {"what":"triggerPurchasing KOM-101","first":["line_opened","line_opened"],"replay":["already_exists","already_exists"]}
- Idempotence : {"what":"triggerPurchasing KOM-102","first":["line_opened"],"replay":["already_exists"]}
- Idempotence : {"what":"triggerPurchasing KOM-103","first":["no_supplier"],"replay":["no_supplier"]}
- Idempotence : {"what":"triggerPurchasing LOCAL","first":["local_stock_no_purchase"],"replay":["local_stock_no_purchase"]}
- Idempotence : {"what":"preparePurchaseOrder rejoué","purchase_orders_for_fixture":2,"no_duplicate":true}

### 4. Autorisation d'engagement (responsable Hub) — PASS
- Acteurs : `{"hub_director":"73be32c0-5561-41d2-9098-8e647e03cfe3","hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927","market_manager":"e003b96a-3a10-4513-b479-653b61021f8f","admin":"51230920-3a58-4737-a9a4-68482e448088"}`
- UUID : `{"PO_A_commitment":"27392702-9ff2-4b01-90c2-70857d68d66b","PO_B_commitment":"94a6ccdb-15e0-4fe5-b55c-db52cb798547"}`
- Statuts : `{"PO_A":"draft","PO_B":"draft"}`
- Quantités : `{"PO_A_amount":"21 USD","PO_B_amount":"7 USD"}`
- Refus : PO-A soumise sans engagement → PURCHASE_COMMITMENT_NOT_AUTHORIZED
- Refus : PO-A engagement par agent Hub → AUTHORIZATION_GRANT_REQUIRED
- Refus : PO-A engagement par responsable marché → AUTHORIZATION_GRANT_REQUIRED
- Refus : PO-A engagement par admin sans grant → AUTHORIZATION_GRANT_REQUIRED
- Refus : PO-A engagement immuable (UPDATE) → 23514
- Refus : PO-B soumise sans engagement → PURCHASE_COMMITMENT_NOT_AUTHORIZED
- Refus : PO-B engagement par agent Hub → AUTHORIZATION_GRANT_REQUIRED
- Refus : PO-B engagement par responsable marché → AUTHORIZATION_GRANT_REQUIRED
- Refus : PO-B engagement par admin sans grant → AUTHORIZATION_GRANT_REQUIRED
- Refus : PO-B engagement immuable (UPDATE) → 23514
- Idempotence : {"what":"engagement PO-A","replay_idempotent":true,"rows":1}
- Idempotence : {"what":"engagement PO-B","replay_idempotent":true,"rows":1}

### 5. Soumission et envoi fournisseur simulé — PASS
- Acteurs : `{"hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927"}`
- UUID : `{"PO_A":"48c651c2-1f5a-4a2d-b955-8d162dd243ba","PO_B":"fb2207a2-6a3b-472f-8547-d074952759fe"}`
- Statuts : `{"PO_A":"notified","PO_B":"notified"}`
- Quantités : `{}`
- Refus : PO-A soumission rejouée → PURCHASE_ORDER_NOT_DRAFT
- Refus : PO-A second canal d'envoi → PURCHASE_ORDER_ALREADY_SENT
- Refus : PO-B soumission rejouée → PURCHASE_ORDER_NOT_DRAFT
- Refus : PO-B second canal d'envoi → PURCHASE_ORDER_ALREADY_SENT
- Idempotence : {"what":"envoi PO-A","second_call_already_sent":true}
- Idempotence : {"what":"envoi PO-B","second_call_already_sent":true}

### 6. Autorisation distincte du paiement fournisseur (sans débit) — PASS
- Acteurs : `{"hub_director":"73be32c0-5561-41d2-9098-8e647e03cfe3","hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927"}`
- UUID : `{"PO_A_payment_authorization":"bb7610e3-cd83-44d9-b8e0-a9837f9a38f2","PO_B_payment_authorization":"55de9b10-5a52-454b-bc58-bc537b74ea3f"}`
- Statuts : `{"PO_A_payment_authorization":"granted","PO_B_payment_authorization":"granted"}`
- Quantités : `{}`
- Refus : PO-A paiement autorisé par agent Hub → AUTHORIZATION_GRANT_REQUIRED
- Refus : PO-A paiement sans montant → AUTHORIZATION_AMOUNT_REQUIRED
- Refus : PO-A paiement au-delà du plafond → SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION
- Refus : PO-B paiement autorisé par agent Hub → AUTHORIZATION_GRANT_REQUIRED
- Refus : PO-B paiement sans montant → AUTHORIZATION_AMOUNT_REQUIRED
- Refus : PO-B paiement au-delà du plafond → SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION
- Idempotence : {"what":"autorisation paiement PO-A","replay_idempotent":true}
- Idempotence : {"what":"autorisation paiement PO-B","replay_idempotent":true}

### 7. Confirmation fournisseur — PASS
- Acteurs : `{"hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927"}`
- UUID : `{"PO_A":"48c651c2-1f5a-4a2d-b955-8d162dd243ba","PO_B":"fb2207a2-6a3b-472f-8547-d074952759fe"}`
- Statuts : `{"PO_A":"confirmed","PO_B":"confirmed"}`
- Quantités : `{"PO_A_confirmed":3,"PO_B_confirmed":1}`
- Refus : PO-A confirmation sans justificatif → MANUAL_PURCHASE_PROOF_REQUIRED
- Refus : PO-A confirmation rejouée → PURCHASE_ORDER_NOT_NOTIFIED
- Refus : PO-B confirmation sans justificatif → MANUAL_PURCHASE_PROOF_REQUIRED
- Refus : PO-B confirmation rejouée → PURCHASE_ORDER_NOT_NOTIFIED
- Idempotence : {"what":"confirmation PO-A","replay_refused_not_duplicated":true}
- Idempotence : {"what":"confirmation PO-B","replay_refused_not_duplicated":true}

### 8. Réception partielle Hub (FIFO) — PASS
- Acteurs : `{"hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927"}`
- UUID : `{"PO_A":"48c651c2-1f5a-4a2d-b955-8d162dd243ba","PO_B":"fb2207a2-6a3b-472f-8547-d074952759fe","inbound_unit_A":"4c0ac4a8-5d6d-4af9-9ece-b29e6d0d23e1","inbound_unit_B":"df12274a-1b2e-4441-bfe7-174f2198a9f0","allocations":["ad62b63f-2eca-4324-8cad-6541b1de07ac","12d05d64-efb1-40e0-a18f-c55793009e0a"]}`
- Statuts : `{"PO_A":"confirmed","PO_B":"hub_received"}`
- Quantités : `{"PO_A":{"ordered":3,"received":2,"remainder":1},"PO_B":{"ordered":1,"received":1,"remainder":0},"fifo":{"kom101_A":2,"kom102_A":0,"kom101_B":1}}`
- Refus : sur-réception PO-A (2 de plus alors que 1 attendu) → 202
- Refus : mauvais SKU dans PO-A → 202
- Idempotence : {"what":"réception PO-A rejouée (même référence)","http_status":200,"received_after_replay":2,"no_duplicate":true}
- Note : Le libellé « reliquat 1 → FIFO KOM-101 » du mandat est lu comme : KOM-101 (la plus ancienne) est servie d’abord ; le reliquat de 1 est celui de KOM-102.

### 9. Identification, scans et sacs clients — PASS
- Acteurs : `{"hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927"}`
- UUID : `{"bag_KOM101":"1bb9eca5-e3e8-4029-952d-609a560cd487","inbound_unit_A":"4c0ac4a8-5d6d-4af9-9ece-b29e6d0d23e1","inbound_unit_B":"df12274a-1b2e-4441-bfe7-174f2198a9f0"}`
- Statuts : `{"bag_KOM101":"PACKED","inbound_units":"épuisées après REPACK (SUPERSEDED)"}`
- Quantités : `{"bag_KOM101":{"A":2,"B":1,"scans_by_item":[{"order_item_id":"0baabde9-96e8-41ad-89c6-612a158feebe","qty":1,"scans":1},{"order_item_id":"c607ea52-0c67-429a-b1aa-838c6679dd8d","qty":2,"scans":1}]}}`
- Refus : scan du code-barres d’un autre produit → HUB_ORDER_BAG_SCAN_INVALID
- Refus : changer le propriétaire du sac → 23514

### 10. Emballage et rattachement KOM-BOX — PASS
- Acteurs : `{"hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927"}`
- UUID : `{"KOM_BOX":"d15a4e4d-a338-4fdd-b037-a1b22314edd7","bag":"1bb9eca5-e3e8-4029-952d-609a560cd487","parcel_KOM101":"e5e92100-ab3a-49c7-ba17-f2b9f6987f72","parcel_reference":"KOM-P-2026-000093"}`
- Statuts : `{"KOM_BOX":"PACKED","parcel_KOM101":"preparation"}`
- Quantités : `{"parcel_KOM101":{"packed":3,"shipped":0,"quantity":3},"box_effective_content":{"lines":2,"qty":3}}`
- Refus : scan du sac non conforme → HUB_BOX_BAG_SCAN_MISMATCH
- Idempotence : {"what":"distributeOrder KOM-101 rejoué","already_assigned":true}
- Idempotence : {"what":"attachBagToBox W1 rejoué","bag_rows_in_box":1,"already_linked":true}

### 11. Expédition et remise au transitaire — PASS
- Acteurs : `{"hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927","forwarder":"0ba4d1c6-06a2-469c-9790-03a2b01c9f3f"}`
- UUID : `{"shipment":"E2E-HUB-V1-43BE86B3-SHIP-1","KOM_BOX":"d15a4e4d-a338-4fdd-b037-a1b22314edd7","parcel":"e5e92100-ab3a-49c7-ba17-f2b9f6987f72"}`
- Statuts : `{"shipment":"forwarder_received","KOM_BOX":["DISPATCHED"],"parcel":"shipped"}`
- Quantités : `{"parcel_items":{"shipped":3,"quantity":3}}`
- Refus : remise avant expédition du carton (DISPATCHED) → JOURNEY_HUB_UNITS_NOT_DISPATCHED
- Refus : remise rejouée / étape hors ordre → JOURNEY_STAGE_ORDER
- Refus : réception transitaire par un agent Hub (W1) → JOURNEY_ROLE_FORBIDDEN

### 12. Réception attestée au relais — PASS
- Acteurs : `{"forwarder":"0ba4d1c6-06a2-469c-9790-03a2b01c9f3f","admin_customs":"51230920-3a58-4737-a9a4-68482e448088","hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927","relay_agent":"3a2cc933-ce9d-4b87-bfe4-4904146c1074"}`
- UUID : `{"shipment":"E2E-HUB-V1-43BE86B3-SHIP-1","receipts":["72fcc029-b59b-4616-b548-d11442fe01b4","3cdadeef-9709-43dc-b312-10ddf034eded"]}`
- Statuts : `{"shipment":"relay_received","order_KOM101":"available","parcel_KOM101":"available"}`
- Quantités : `{"receipts":[{"expected":1,"received":1,"incident":null},{"expected":2,"received":2,"incident":null}],"parcel_items":{"received":3,"quantity":3}}`
- Refus : relay_received posé par le Hub → JOURNEY_RELAY_ATTESTATION_REQUIRED
- Refus : attestation par un admin → RELAY_RECEIPT_ROLE_FORBIDDEN
- Refus : attestation sans justificatif → RELAY_RECEIPT_PROOF_REQUIRED
- Refus : attestation d’un article non attendu → RELAY_RECEIPT_ITEM_NOT_EXPECTED
- Refus : quantité négative → RELAY_RECEIPT_INVALID
- Refus : attestation rejouée (W1) → RELAY_SHIPMENT_NOT_AT_RELAY
- Refus : attestation immuable (W1) → 23514

### 13. Retrait client et traitement du reliquat — PASS
- Acteurs : `{"relay_agent":"3a2cc933-ce9d-4b87-bfe4-4904146c1074","hub_agent":"de8b02c2-d46b-41e8-8c96-57a98ca59927"}`
- UUID : `{"reliquat_inbound_unit":"f82933a8-8387-4de5-a3cb-fb217e8d6fb9","reliquat_bag":"97c1d885-ffc9-4c4d-bf79-c89220f586ab","reliquat_box":"1d0517ab-d9e5-427f-8139-3b6b10eefdf6","reliquat_shipment":"E2E-HUB-V1-43BE86B3-SHIP-2","parcel_KOM101":"e5e92100-ab3a-49c7-ba17-f2b9f6987f72","parcel_KOM102":"813c53bd-43bd-4c62-beff-ce47c1bcd40d"}`
- Statuts : `{"PO_A":"hub_received","KOM_101":"collected","KOM_102":"collected","reliquat_shipment":"relay_received"}`
- Quantités : `{"KOM_101":{"received":3,"collected":3,"quantity":3},"KOM_102":{"received":1,"collected":1,"quantity":1},"PO_A":{"ordered":3,"received":3}}`
- Refus : réception transitaire par un agent Hub (W2) → JOURNEY_ROLE_FORBIDDEN
- Refus : attestation rejouée (W2) → RELAY_SHIPMENT_NOT_AT_RELAY
- Refus : attestation immuable (W2) → 23514
- Idempotence : {"what":"retrait W1 rejoué","second_success":false,"collected_after":3}
- Idempotence : {"what":"distributeOrder KOM-102 rejoué","already_assigned":true}
- Idempotence : {"what":"attachBagToBox W2 rejoué","bag_rows_in_box":1,"already_linked":true}
- Idempotence : {"what":"retrait W2 rejoué","second_success":false,"collected_after":1}
- Note : Reliquat traité par LIVRAISON (réception tardive 1/1 puis même circuit sac → KOM-BOX → expédition → relais → retrait). Le remboursement fictif n’est pas utilisé : un paiement fictif sans débit ne peut pas être remboursé sans créer de la monnaie interne (wallet) qui n’a jamais été encaissée.

## Circuit LOCAL (hors Hub)

`{"writers":["local-relay-receipt-service.recordLocalRelayReceipt","scan-engine.processScan(customer_collected)"],"order_id":"f2d9ecf5-3bbd-4f13-be1c-610a43a9f942","status":"collected","parcel_id":"1238586e-9b71-43df-af9f-00efb5e5e1f3","replay_refused":{"code":"LOCAL_RECEIPT_PARCEL_ALREADY_EXISTS"},"hub_rows":{"hub_allocations":0,"hub_units":0,"purchase_lines":0,"shipment_receipts":0},"circuit_only_local":true}`

## Effets externes

- Tentatives réseau : 0
- Delta lignes : `{"cash_collections":0,"notification_log_attempts":0,"outbox_events":0,"loyalty_rewards":0,"supplier_execution_payments":0,"supplier_execution_payment_proofs":0,"supplier_payment_settlements":0}`

## Nettoyage de la fixture (inventaire, aucune suppression)

- Décision : RETAIN_FIXTURE_PREFIX_NO_DELETE
- Tables immuables : hub_custody_events, hub_physical_unit_placements, hub_purchase_allocations, incidents, international_shipment_relay_receipts, parcels, purchase_lines, scan_events
- Racines propres : users=7, relais=1, suppliers=2, products=4, product_skus=3, product_suppliers=2, local_stock=1, product_market_price_drafts=4, product_sku_physical_codes=3, sourcing_candidates=3, sourcing_sources=1, purchase_orders=2, hub_physical_units=9, international_shipments=2, customs_shipments=2

## Limites

- KOM-103 : « Sourcing requis » est observé via le trigger d'achat réel (aucune ligne, aucun PO, résultat no_supplier) ; la certification formelle de l'anomalie reste portée par les tests automatisés de #3355, rien n'est fabriqué.
- Paiement fournisseur : seule l'AUTORISATION (hub_authorization_grants + purchase_order_authorizations) est exercée ; aucun débit, aucune écriture supplier_execution_payments / settlements.
- Reliquat KOM-102 traité par LIVRAISON tardive ; le remboursement fictif est volontairement non exécuté (un paiement fictif sans débit ne peut être remboursé sans créer de la monnaie interne jamais encaissée).
- Création du colis client : répartiteur canonique auto-parcel.distributeOrder (aucun rôle Hub dédié n'existe pour cette action).
- Nettoyage : la suppression de la fixture est INTERDITE (tables append-only) ; stratégie = conservation du préfixe E2E-HUB-V1-<RUN8>, jamais de suppression forcée ; cleanup_certified=false.
- Correctifs de services découverts par le runner (commit isolé) : projection colis↔KOM-BOX des sacs (relay-parcel-item-reconciliation, parcel-shipment-handover), référence colis (auto-parcel), suppression des messages WhatsApp pour une commande en simulation_scope (notifications), consommation du stock local au paiement fictif.
- Exécution sur staging Railway officiel, empreinte DB et SHA vérifiés avant toute écriture.
- Verdict transactionnel uniquement : validation Chromium et GO production non encore prononcés.
- Aucune suppression des preuves immuables : conservation du RUN8 de la fixture.

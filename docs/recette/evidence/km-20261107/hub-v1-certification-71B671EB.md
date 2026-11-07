# Certification Hub V1 — fixture E2E-HUB-V1-71B671EB

- Mode : APPLY_OFFICIAL_STAGING · base : railway (official-railway-staging)
- Verdict : **PARTIAL_STOP_AFTER_STEP_PASS** · staging : **FIXTURE_READY_REMAINING_STEPS_BY_UI_NOT_PROVEN** (aucun GO staging)
- Commandes : E2E-HUB-V1-71B671EB-KOM-101, E2E-HUB-V1-71B671EB-KOM-102, E2E-HUB-V1-71B671EB-KOM-103, E2E-HUB-V1-71B671EB-LOCAL

## Étapes

| # | Étape | Statut | Writers | Refus prouvés | Idempotence |
|---|---|---|---|---|---|
| 1 | Commandes par checkout canonique | PASS | order-checkout-service.runOrderCheckout (internalSimulation E2E-HUB-V1) | 5 | 4 |
| 2 | Paiement client fictif sans débit | PASS | hub-v1-fixture-payment.confirmFixturePayment → payment-service.markPaid + order-status-machine | 2 | 4 |

### 1. Commandes par checkout canonique — PASS
- Acteurs : `{"client":"a4575427-23a7-4e47-8f45-fd4f860285c4","admin_simulation_actor":"6f0593da-696f-491d-aba4-f3cd6a27d839"}`
- UUID : `{"KOM-101":"65d32bbf-301e-439e-a0c0-2a26372509ac","KOM-102":"2f94cda1-44d5-4b02-83ba-30213bac7952","KOM-103":"01e6f864-327b-4ac5-ad3d-b86048585d23","LOCAL":"272b0fae-fb81-46d4-a7e6-44d327c4d08b"}`
- Statuts : `{"KOM-101":"pending/pending","KOM-102":"pending/pending","KOM-103":"pending/pending","LOCAL":"pending/pending"}`
- Quantités : `{"KOM-101":[2,1],"KOM-102":[1],"KOM-103":[2],"LOCAL":[1]}`
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
- Acteurs : `{"admin_simulation_actor":"6f0593da-696f-491d-aba4-f3cd6a27d839"}`
- UUID : `{"KOM-101":"65d32bbf-301e-439e-a0c0-2a26372509ac","KOM-102":"2f94cda1-44d5-4b02-83ba-30213bac7952","KOM-103":"01e6f864-327b-4ac5-ad3d-b86048585d23","LOCAL":"272b0fae-fb81-46d4-a7e6-44d327c4d08b"}`
- Statuts : `{"KOM-101":"ordered/paid","KOM-102":"ordered/paid","KOM-103":"ordered/paid","LOCAL":"ordered/paid"}`
- Quantités : `{}`
- Refus : paiement par un non-admin (client) → HUB_V1_FIXTURE_PAYMENT_ADMIN_REQUIRED
- Refus : paiement hors mode approuvé → HUB_V1_FIXTURE_PAYMENT_ENV_FORBIDDEN
- Idempotence : {"what":"paiement KOM-101","second_call_idempotent_replay":true}
- Idempotence : {"what":"paiement KOM-102","second_call_idempotent_replay":true}
- Idempotence : {"what":"paiement KOM-103","second_call_idempotent_replay":true}
- Idempotence : {"what":"paiement LOCAL","second_call_idempotent_replay":true}

## Effets externes

- Tentatives réseau : 0
- Delta lignes : `{"cash_collections":0,"notification_log_attempts":0,"outbox_events":0,"loyalty_rewards":0,"supplier_execution_payments":0,"supplier_execution_payment_proofs":0,"supplier_payment_settlements":0}`

## Nettoyage de la fixture (inventaire, aucune suppression)

- Décision : DELETE_ALLOWED_AFTER_DRY_RUN_REVIEW
- Tables immuables : aucune
- Racines propres : users=7, relais=1, suppliers=2, products=4, product_skus=3, product_suppliers=2, local_stock=1, product_market_price_drafts=4, product_sku_physical_codes=3, sourcing_candidates=3, sourcing_sources=1, purchase_orders=0, hub_physical_units=0, international_shipments=0, customs_shipments=0

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

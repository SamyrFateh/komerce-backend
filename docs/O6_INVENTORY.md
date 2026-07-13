# O6 — Dependency Debt Inventory

> Projection déterministe générée par `scripts/business-graph-gen.js`. Ne pas éditer à la main.
> Chaque paire ci-dessous est une dépendance O5 `OBSERVED_UNDECLARED` classée dans exactement une famille O6, dérivée de ses preuves réelles.
> O6 classifie et gouverne ; **O6 ne remédie pas** encore les coutures.

## Summary by family

| Family | N |
|---|---|
| PROJECTION | 9 |
| COMPOSITION_ROOT_WIRING | 9 |
| NON_RUNTIME_TEST | 9 |
| TECHNICAL_PRIMITIVE | 32 |
| BUSINESS_TRANSVERSAL_SERVICE | 11 |
| CROSS_FEATURE_DIRECT_IMPORT | 18 |
| BUSINESS_FEATURE_INTERFACE | 3 |
| PILOTING_CAPABILITY | 2 |
| UNCLASSIFIED | 0 |
| **TOTAL** | **93** |

## The 94 pairs (from → to)

| from → to | family | evidence role | consumer kind | provider kind | channels | coupling | policy | exception | top evidence |
|---|---|---|---|---|---|---|---|---|---|
| admin-dashboard → catalog | PROJECTION | RUNTIME_ONLY | projection | business-feature | interface | interface | projection-dependency-policy | — | `` |
| admin-dashboard → customs | PROJECTION | RUNTIME_ONLY | projection | business-feature | interface | interface | projection-dependency-policy | — | `` |
| admin-dashboard → dashboard | PROJECTION | RUNTIME_ONLY | projection | business-transversal | interface | interface | projection-dependency-policy | — | `` |
| admin-dashboard → decision-signals | PROJECTION | RUNTIME_ONLY | projection | piloting-capability | interface | interface | projection-dependency-policy | — | `` |
| admin-dashboard → economic-engine | PROJECTION | RUNTIME_ONLY | projection | business-feature | interface | interface | projection-dependency-policy | — | `` |
| admin-dashboard → inventory | PROJECTION | RUNTIME_ONLY | projection | business-feature | interface | interface | projection-dependency-policy | — | `` |
| admin-dashboard → logistics | PROJECTION | RUNTIME_ONLY | projection | business-feature | interface | interface | projection-dependency-policy | — | `` |
| admin-dashboard → orders | PROJECTION | RUNTIME_ONLY | projection | business-feature | interface | interface | projection-dependency-policy | — | `` |
| admin-dashboard → payments | PROJECTION | RUNTIME_ONLY | projection | business-feature | interface | interface | projection-dependency-policy | — | `` |
| auth → auth-identity | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | technical-transversal | static-code | business-file-import | non-runtime-evidence | — | `` |
| auth → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | technical-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| auth → notifications | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-transversal | static-code | business-file-import | non-runtime-evidence | — | `` |
| auth-identity → auth | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | technical-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| auth-identity → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | technical-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| auth-identity → logistics | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| auth-identity → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_ONLY | technical-transversal | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| catalog → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| customs → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| dashboard → catalog | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-transversal | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| dashboard → decision-signals | PILOTING_CAPABILITY | RUNTIME_AND_TEST | business-transversal | piloting-capability | static-code | business-file-import | piloting-capability-dependency | — | `` |
| dashboard → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| dashboard → purchasing | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | business-transversal | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| decision-signals → auth | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | piloting-capability | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| decision-signals → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | piloting-capability | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| decision-signals → logistics | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | piloting-capability | business-feature | static-code | technical-primitive | business-dependency-declare-candidate | — | `` |
| documents → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| economic-engine → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| economic-engine → logistics | NON_RUNTIME_TEST | TEST_ONLY | business-feature | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| economic-engine → loyalty | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| incident-management → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| infrastructure → auth-identity | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | technical-transversal | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → decision-signals | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | piloting-capability | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → loyalty | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → notifications | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-transversal | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → payments | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → platform-ops | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | technical-transversal | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → purchasing | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → sourcing | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → unsold-resolution | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| inventory → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| inventory → logistics | NON_RUNTIME_TEST | TEST_ONLY | business-feature | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| logistics → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| logistics → loyalty | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| logistics → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| logistics → payments | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, runtime-cycle | `` |
| logistics → purchasing | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, runtime-cycle | `` |
| loyalty → auth | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| loyalty → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| loyalty → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| notifications → auth | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| notifications → decision-signals | PILOTING_CAPABILITY | RUNTIME_AND_TEST | business-transversal | piloting-capability | static-code | business-file-import | piloting-capability-dependency | — | `` |
| notifications → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| notifications → orders | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-transversal | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, runtime-cycle | `` |
| orders → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| orders → loyalty | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| orders → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | runtime-cycle | `` |
| orders → payments | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| payments → auth | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| payments → documents | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| payments → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| payments → logistics | BUSINESS_FEATURE_INTERFACE | RUNTIME_AND_TEST | business-feature | business-feature | interface+static-code | mixed | business-dependency-declare-candidate | runtime-cycle | `` |
| payments → loyalty | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| payments → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| payments → platform-ops | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | business-file-import | technical-dependency-policy | — | `` |
| payments → purchasing | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| payments → refunds | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| payments → wallet | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | interface | interface | business-dependency-declare-candidate | runtime-cycle | `` |
| platform-ops → auth | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | technical-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| platform-ops → catalog | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| platform-ops → economic-engine | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, ownership-suspect | `` |
| platform-ops → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | technical-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| platform-ops → logistics | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | technical-transversal | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, ownership-suspect | `` |
| platform-ops → orders | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | technical-transversal | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, ownership-suspect | `` |
| platform-ops → payments | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| platform-ops → purchasing | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| platform-ops → shared-cart | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| purchasing → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| purchasing → logistics | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, runtime-cycle | `` |
| purchasing → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| recommendations → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| refunds → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| shared-cart → auth-identity | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | business-file-import | technical-dependency-policy | — | `` |
| shared-cart → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| shared-cart → loyalty | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| shared-cart → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| shared-cart → payments | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| shared-cart → refunds | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_ONLY | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| sourcing → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| unsold-resolution → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| wallet → auth | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| wallet → documents | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| wallet → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | technical-primitive | technical-dependency-policy | — | `` |
| wallet → payments | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, runtime-cycle | `` |

## Exceptions ledger (measured, not fixed)

Total exceptions : **21**.

| from → to | decision | rationale |
|---|---|---|
| dashboard → catalog | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/admin/index.js -> routes/admin/catalog-approval.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| dashboard → purchasing | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/admin/system.js -> services/repair-ordered-without-purchase-orders.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| economic-engine → loyalty | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/admin-finance-config.js -> services/loyalty-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| logistics → loyalty | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/scan-operations.js -> routes/loyalty.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| logistics → payments | boundary-to-break | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/parcel-auto-create-service.js -> services/payment-service.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration. |
| logistics → purchasing | boundary-to-break | CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/pickup-secret.js -> routes/purchasing.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration. |
| notifications → orders | boundary-to-break | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/authkey-client.js -> services/invoice-public-token.js (rehomé O7.1 CAS A, ex auth-identity -> orders). Direction d'un cycle runtime réel (notifications<->orders) : couture à casser ou dépendance à inverser avant déclaration. Voir docs/O7_1_OWNERSHIP_ANALYSIS.md. |
| orders → loyalty | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/verify-qr-collection.js -> routes/loyalty.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| orders → notifications | boundary-to-break | BUSINESS_TRANSVERSAL_SERVICE — consommation légitime du service de notification par orders (envoi de notifications commande). Direction d'un cycle runtime réel (notifications<->orders, apparu après le rehome O7.1 de services/authkey-client.js) : couture à casser ou dépendance à inverser avant déclaration. |
| orders → payments | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/admin-order-refund.js -> services/payment-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| payments → logistics | boundary-to-break | BUSINESS_FEATURE_INTERFACE — preuve: services/payment-paypal.js -> routes/pickup-secret.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration. |
| payments → loyalty | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/payment-cash-confirm.js -> services/loyalty-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| payments → purchasing | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/cash.js -> services/purchasing-trigger-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| payments → wallet | boundary-to-break | BUSINESS_FEATURE_INTERFACE — preuve: public/boutique/js/b-checkout.js -> /api/wallet. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration. |
| platform-ops → economic-engine | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/modules.js -> services/pricing-engine.js. O7.1 CAS B : OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED — routes/modules.js fait du CRUD/logique métier propre (couture, lunettes, construction) et délègue à pricing-engine.recommend() pour un calcul de prix ponctuel dans un seul sous-cas ; consommation métier réelle et légitime, pas un fichier mal rattaché à economic-engine. (La frontière platform-ops/catalog sur ce même fichier est une dette distincte, déjà documentée et délibérément différée depuis le Lot O2 — hors scope O7.1.) Voir docs/O7_1_OWNERSHIP_ANALYSIS.md. |
| platform-ops → logistics | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/simulator/state-advancer.js -> services/parcel-operations.js. O7.1 CAS C : OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED — le simulateur (surface admin /api/simulator/*, déjà documentée et acceptée dans platform-ops.feature.js) ne revendique jamais l'autorité du lifecycle colis : chaque transition passe par transitionParcelStatus(), la fonction SSOT logistics, avec un flag skipValidation explicite. Doctrine WRITER != LIFECYCLE OWNER vérifiée ligne par ligne. Voir docs/O7_1_OWNERSHIP_ANALYSIS.md. |
| platform-ops → orders | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/simulator/state-advancer.js -> services/order-status-machine.js. O7.1 CAS D : OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED — même raisonnement que CAS C : orders.status n'est jamais écrit directement, toujours via transitionOrderStatus(). Les écritures directes de payment_status (chaos desync_payment + confirmPayment) sont cohérentes avec l'usage établi ailleurs dans le code (colonne à écriture partagée, pas un lifecycle SSOT) et ne constituent pas une prise d'autorité. Voir docs/O7_1_OWNERSHIP_ANALYSIS.md. |
| purchasing → logistics | boundary-to-break | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/purchasing-receive-service.js -> routes/scans.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration. |
| shared-cart → loyalty | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/shared-cart.js -> services/loyalty-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| shared-cart → payments | internal-api-required | CROSS_FEATURE_DIRECT_IMPORT — preuve: public/boutique/js/b-share-cart.js -> public/boutique/js/b-checkout.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes. |
| wallet → payments | boundary-to-break | CROSS_FEATURE_DIRECT_IMPORT — preuve: services/wallet-service.js -> services/payment-service.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration. |

## Runtime cycles

- `logistics` ↔ `payments`
- `logistics` ↔ `purchasing`
- `notifications` ↔ `orders`
- `payments` ↔ `wallet`

## Ontology gap coverage (separate flux)

- `tracking` → auth-identity, logistics, orders — couvert


# O6 — Dependency Debt Inventory

> Projection déterministe générée par `scripts/business-graph-gen.js`. Ne pas éditer à la main.
> Chaque paire ci-dessous est une dépendance O5 `OBSERVED_UNDECLARED` classée dans exactement une famille O6, dérivée de ses preuves réelles.
> O6 classifie et gouverne ; **O6 ne remédie pas** encore les coutures.

## Summary by family

| Family | N |
|---|---|
| PROJECTION | 9 |
| COMPOSITION_ROOT_WIRING | 13 |
| NON_RUNTIME_TEST | 7 |
| TECHNICAL_PRIMITIVE | 29 |
| BUSINESS_TRANSVERSAL_SERVICE | 3 |
| CROSS_FEATURE_DIRECT_IMPORT | 7 |
| BUSINESS_FEATURE_INTERFACE | 7 |
| PILOTING_CAPABILITY | 0 |
| UNCLASSIFIED | 0 |
| **TOTAL** | **75** |

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
| auth → auth-identity | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| auth → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | technical-transversal | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| auth → notifications | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-transversal | static-code | business-file-import | non-runtime-evidence | — | `` |
| auth-identity → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| auth-identity → logistics | NON_RUNTIME_TEST | TEST_ONLY | business-feature | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| auth-identity → platform-ops | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | business-file-import | technical-dependency-policy | runtime-cycle | `` |
| auth-identity → wallet | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| catalog → auth-identity | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | interface | interface | business-dependency-declare-candidate | — | `` |
| catalog → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| catalog → orders | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| catalog → platform-ops | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | business-file-import | technical-dependency-policy | runtime-cycle | `` |
| customs → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| dashboard → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| decision-signals → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | piloting-capability | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| documents → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| economic-engine → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| incident-management → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| infrastructure → auth-identity | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → business-rules | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-transversal | static-code | import-mixed | application-wiring-not-consumption | — | `` |
| infrastructure → decision-signals | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | piloting-capability | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → loyalty | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → notifications | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-transversal | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → payments | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → platform-ops | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | technical-transversal | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → purchasing | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → sourcing | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → unsold-resolution | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| inventory → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| inventory → logistics | NON_RUNTIME_TEST | TEST_ONLY | business-feature | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| inventory → orders | NON_RUNTIME_TEST | TEST_ONLY | business-feature | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| inventory → payments | NON_RUNTIME_TEST | TEST_ONLY | business-feature | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| logistics → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| loyalty → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| notifications → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| orders → auth-identity | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | interface+static-code | mixed | business-dependency-declare-candidate | — | `` |
| orders → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| orders → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| orders → platform-ops | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | business-file-import | technical-dependency-policy | — | `` |
| orders → shared-cart | BUSINESS_FEATURE_INTERFACE | RUNTIME_AND_TEST | business-feature | business-feature | interface+static-code | mixed | business-dependency-declare-candidate | — | `` |
| payments → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | interface+static-code | mixed | technical-dependency-policy | — | `` |
| payments → shared-cart | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, runtime-cycle | `` |
| platform-ops → auth-identity | BUSINESS_FEATURE_INTERFACE | RUNTIME_AND_TEST | technical-transversal | business-feature | interface+static-code | interface | business-dependency-declare-candidate | runtime-cycle | `` |
| platform-ops → catalog | BUSINESS_FEATURE_INTERFACE | RUNTIME_AND_TEST | technical-transversal | business-feature | interface+static-code | interface | business-dependency-declare-candidate | runtime-cycle | `` |
| platform-ops → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | technical-transversal | technical-foundation | interface+static-code | mixed | technical-dependency-policy | — | `` |
| platform-ops → payments | COMPOSITION_ROOT_WIRING | RUNTIME_AND_TEST | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| platform-ops → purchasing | BUSINESS_FEATURE_INTERFACE | RUNTIME_AND_TEST | technical-transversal | business-feature | interface+static-code | interface | business-dependency-declare-candidate | — | `` |
| platform-ops → recommendations | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| platform-ops → shared-cart | COMPOSITION_ROOT_WIRING | RUNTIME_AND_TEST | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| purchasing → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| purchasing → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| recommendations → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| recommendations → orders | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| recommendations → platform-ops | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | static-code | business-file-import | technical-dependency-policy | — | `` |
| refunds → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-transversal | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| refunds → payments | NON_RUNTIME_TEST | TEST_ONLY | business-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| shared-cart → auth-identity | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| shared-cart → catalog | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_ONLY | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import | `` |
| shared-cart → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| shared-cart → notifications | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_AND_TEST | business-feature | business-transversal | static-code | business-file-import | business-dependency-declare-candidate | — | `` |
| shared-cart → payments | CROSS_FEATURE_DIRECT_IMPORT | RUNTIME_AND_TEST | business-feature | business-feature | static-code | business-file-import | boundary-remediation-required | direct-import, runtime-cycle | `` |
| shared-cart → platform-ops | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | business-file-import | technical-dependency-policy | — | `` |
| shared-cart → recommendations | BUSINESS_FEATURE_INTERFACE | RUNTIME_AND_TEST | business-feature | business-feature | interface+static-code | mixed | business-dependency-declare-candidate | — | `` |
| sourcing → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| unsold-resolution → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| wallet → infrastructure | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-foundation | static-code | technical-primitive | technical-dependency-policy | — | `` |
| wallet → platform-ops | TECHNICAL_PRIMITIVE | RUNTIME_AND_TEST | business-feature | technical-transversal | static-code | business-file-import | technical-dependency-policy | — | `` |

## Exceptions ledger (measured, not fixed)

Total exceptions : **7**.

| from → to | decision | rationale |
|---|---|---|
| auth-identity → platform-ops | accepted-dependency | La surface d'identité consomme les primitives techniques du shell — bus, store et utilitaires UI. Cette direction ne transfère aucune autorité métier à platform-ops et ne constitue pas un cycle de modules. |
| catalog → orders | accepted-dependency | Les surfaces catalogue déclenchent les opérations du panier personnel — ajout, quantité et résumé de ligne — à partir d'un produit sélectionné. La dépendance va du canal de découverte vers l'intention d'achat ; le panier ne modifie aucun état du catalogue. |
| catalog → platform-ops | accepted-dependency | Le catalogue consomme le bus, le store, les utilitaires et l'ownership de scroll fournis par le socle. Ces primitives restent techniques et ne possèdent aucune règle catalogue. |
| platform-ops → auth-identity | accepted-dependency | Le client API transversal expose des appels vers les endpoints d'authentification et le shell monte la surface identité. Il s'agit d'un adaptateur technique et de composition, sans ownership de la logique d'identité. |
| platform-ops → catalog | accepted-dependency | Le shell monte les modules de découverte produit et le client API transversal appelle les endpoints catalogue. La couture est un wiring et un adaptateur d'interface ; platform-ops ne possède ni produit, ni prix, ni stock. |
| recommendations → orders | accepted-dependency | Une recommandation permet explicitement d'ajouter le produit suggéré au panier personnel et de construire son résumé de ligne. La recommandation ne possède ni le panier ni son cycle de persistance. |
| shared-cart → catalog | accepted-dependency | Le modal panier partagé consomme en lecture seule les données et fonctions de présentation du catalogue afin d'afficher le produit et de construire le snapshot ajouté au panier. Aucun état catalog n'est modifié. |

## Runtime cycles

- `auth-identity` ↔ `platform-ops`
- `catalog` ↔ `platform-ops`
- `payments` ↔ `shared-cart`

## Ontology gap coverage (separate flux)

- _none_


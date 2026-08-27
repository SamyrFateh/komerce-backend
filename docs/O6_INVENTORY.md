# O6 — Dependency Debt Inventory

> Projection déterministe générée par `scripts/business-graph-gen.js`. Ne pas éditer à la main.
> Chaque paire ci-dessous est une dépendance O5 `OBSERVED_UNDECLARED` classée dans exactement une famille O6, dérivée de ses preuves réelles.
> O6 classifie et gouverne ; **O6 ne remédie pas** encore les coutures.

## Summary by family

| Family | N |
|---|---|
| PROJECTION | 0 |
| COMPOSITION_ROOT_WIRING | 13 |
| NON_RUNTIME_TEST | 4 |
| TECHNICAL_PRIMITIVE | 1 |
| BUSINESS_TRANSVERSAL_SERVICE | 4 |
| CROSS_FEATURE_DIRECT_IMPORT | 0 |
| BUSINESS_FEATURE_INTERFACE | 20 |
| PILOTING_CAPABILITY | 0 |
| UNCLASSIFIED | 0 |
| **TOTAL** | **42** |

## The 94 pairs (from → to)

| from → to | family | evidence role | consumer kind | provider kind | channels | coupling | policy | exception | top evidence |
|---|---|---|---|---|---|---|---|---|---|
| auth-identity → catalog | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| auth-identity → logistics | BUSINESS_FEATURE_INTERFACE | RUNTIME_AND_TEST | business-feature | business-feature | data-read+static-code | data | business-dependency-declare-candidate | — | `` |
| auth-identity → loyalty | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| auth-identity → orders | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| business-rules → auth-identity | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-transversal | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| customs → catalog | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| dashboard → loyalty | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-transversal | business-feature | data-write | data | business-dependency-declare-candidate | — | `` |
| dashboard → shared-cart | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-transversal | business-feature | data-write | data | business-dependency-declare-candidate | — | `` |
| documents → catalog | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-transversal | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| documents → logistics | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-transversal | business-feature | data-read | data | business-dependency-declare-candidate | runtime-cycle | `` |
| economic-engine → auth-identity | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| economic-engine → business-rules | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_ONLY | business-feature | business-transversal | data-read | data | business-dependency-declare-candidate | — | `` |
| economic-engine → customs | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| economic-engine → platform-ops | TECHNICAL_PRIMITIVE | RUNTIME_ONLY | business-feature | technical-transversal | data-read | data | technical-dependency-policy | — | `` |
| economic-engine → refunds | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_ONLY | business-feature | business-transversal | data-read | data | business-dependency-declare-candidate | — | `` |
| incident-management → orders | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-transversal | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| infrastructure → auth-identity | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → auth-passkey | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → business-rules | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-transversal | static-code | import-mixed | application-wiring-not-consumption | — | `` |
| infrastructure → decision-signals | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | piloting-capability | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → documents | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-transversal | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → loyalty | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → purchasing | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → sourcing | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → unsold-resolution | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| inventory → payments | NON_RUNTIME_TEST | TEST_ONLY | business-feature | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| logistics → documents | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_ONLY | business-feature | business-transversal | data-read | data | business-dependency-declare-candidate | runtime-cycle | `` |
| loyalty → economic-engine | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| loyalty → orders | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| notifications → auth-identity | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-transversal | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| notifications → logistics | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-transversal | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| notifications → orders | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-transversal | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| payments → auth-identity | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| platform-ops → auth-passkey | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| platform-ops → documents | BUSINESS_TRANSVERSAL_SERVICE | RUNTIME_ONLY | technical-transversal | business-transversal | data-read | data | business-dependency-declare-candidate | — | `` |
| platform-ops → notifications | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-transversal | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| platform-ops → payments | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| platform-ops → recommendations | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| platform-ops → shared-cart | COMPOSITION_ROOT_WIRING | RUNTIME_AND_TEST | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| purchasing → catalog | BUSINESS_FEATURE_INTERFACE | RUNTIME_ONLY | business-feature | business-feature | data-read | data | business-dependency-declare-candidate | — | `` |
| refunds → auth | NON_RUNTIME_TEST | TEST_ONLY | business-transversal | technical-transversal | static-code | technical-primitive | non-runtime-evidence | — | `` |
| refunds → payments | NON_RUNTIME_TEST | TEST_ONLY | business-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |

## Exceptions ledger (measured, not fixed)

Total exceptions : **6**.

| from → to | decision | rationale |
|---|---|---|
| auth-identity → platform-ops | accepted-dependency | La surface d'identité consomme les primitives techniques du shell — bus, store et utilitaires UI. Cette direction ne transfère aucune autorité métier à platform-ops et ne constitue pas un cycle de modules. |
| catalog → orders | accepted-dependency | Les surfaces catalogue déclenchent les opérations du panier personnel — ajout, quantité et résumé de ligne — à partir d'un produit sélectionné. La dépendance va du canal de découverte vers l'intention d'achat ; le panier ne modifie aucun état du catalogue. |
| catalog → platform-ops | accepted-dependency | Le catalogue consomme le bus, le store, les utilitaires et l'ownership de scroll fournis par le socle. Ces primitives restent techniques et ne possèdent aucune règle catalogue. |
| platform-ops → auth-identity | accepted-dependency | Le client API transversal expose des appels vers les endpoints d'authentification et le shell monte la surface identité. Il s'agit d'un adaptateur technique et de composition, sans ownership de la logique d'identité. |
| platform-ops → catalog | accepted-dependency | Le shell monte les modules de découverte produit et le client API transversal appelle les endpoints catalogue. La couture est un wiring et un adaptateur d'interface ; platform-ops ne possède ni produit, ni prix, ni stock. |
| shared-cart → catalog | accepted-dependency | Le modal panier partagé consomme en lecture seule les données et fonctions de présentation du catalogue afin d'afficher le produit et de construire le snapshot ajouté au panier. Aucun état catalog n'est modifié. |

## Runtime cycles

- `documents` ↔ `logistics`

## Ontology gap coverage (separate flux)

- _none_


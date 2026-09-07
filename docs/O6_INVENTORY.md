# O6 — Dependency Debt Inventory

> Projection déterministe générée par `scripts/business-graph-gen.js`. Ne pas éditer à la main.
> Chaque paire ci-dessous est une dépendance O5 `OBSERVED_UNDECLARED` classée dans exactement une famille O6, dérivée de ses preuves réelles.
> O6 classifie et gouverne ; **O6 ne remédie pas** encore les coutures.

## Summary by family

| Family | N |
|---|---|
| PROJECTION | 0 |
| COMPOSITION_ROOT_WIRING | 16 |
| NON_RUNTIME_TEST | 6 |
| TECHNICAL_PRIMITIVE | 0 |
| BUSINESS_TRANSVERSAL_SERVICE | 0 |
| CROSS_FEATURE_DIRECT_IMPORT | 0 |
| BUSINESS_FEATURE_INTERFACE | 0 |
| PILOTING_CAPABILITY | 0 |
| UNCLASSIFIED | 0 |
| **TOTAL** | **22** |

## The 94 pairs (from → to)

| from → to | family | evidence role | consumer kind | provider kind | channels | coupling | policy | exception | top evidence |
|---|---|---|---|---|---|---|---|---|---|
| dashboard → loyalty | NON_RUNTIME_TEST | TEST_ONLY | business-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| dashboard → platform | NON_RUNTIME_TEST | TEST_ONLY | business-transversal | frontend-transversal | static-code | business-file-import | non-runtime-evidence | — | `` |
| infrastructure → auth-identity | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → auth-passkey | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → business-rules | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-transversal | static-code | import-mixed | application-wiring-not-consumption | — | `` |
| infrastructure → decision-signals | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | piloting-capability | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → documents | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-transversal | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → local-stock | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → loyalty | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → providers-services | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → purchasing | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → sourcing | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| infrastructure → unsold-resolution | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-foundation | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| inventory → payments | NON_RUNTIME_TEST | TEST_ONLY | business-feature | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| platform-ops → auth-passkey | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| platform-ops → notifications | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-transversal | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| platform-ops → payments | NON_RUNTIME_TEST | TEST_ONLY | technical-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |
| platform-ops → providers-services | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| platform-ops → recommendations | COMPOSITION_ROOT_WIRING | RUNTIME_ONLY | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| platform-ops → shared-cart | COMPOSITION_ROOT_WIRING | RUNTIME_AND_TEST | technical-transversal | business-feature | static-code | business-file-import | application-wiring-not-consumption | — | `` |
| refunds → auth | NON_RUNTIME_TEST | TEST_ONLY | business-transversal | technical-transversal | static-code | technical-primitive | non-runtime-evidence | — | `` |
| refunds → payments | NON_RUNTIME_TEST | TEST_ONLY | business-transversal | business-feature | static-code | business-file-import | non-runtime-evidence | — | `` |

## Exceptions ledger (measured, not fixed)

Total exceptions : **0**.

| from → to | decision | rationale |
|---|---|---|

## Runtime cycles

- _none_

## Ontology gap coverage (separate flux)

- _none_


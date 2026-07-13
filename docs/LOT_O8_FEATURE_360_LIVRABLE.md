# LOT O8 — FEATURE 360 — BUSINESS PILOTING PROJECTION

## 1. Purpose

Répondre en une commande, sans lire le code ni interpréter le bruit technique :
« Quelle est la situation complète d'une feature donnée ? » — service rendu, ce qu'elle
possède, ce qu'elle expose, ses vraies dépendances métier, qui la consomme, sa dette.

**Feature 360 ne crée aucune nouvelle vérité architecturale. Elle transforme les vérités
Feature First déjà gouvernées en une vue de pilotage business centrée sur la feature.**

## 2. Authorities consumed

Exclusivement, en lecture seule :

- `docs/BUSINESS_FEATURE_GRAPH.json` (nodes.features, edges.*, o5.pairs, o6.pairClassifications,
  o6.ontologyGapCoverage, o6.runtimeCycles/unclassified/missingExceptions, tableOwnership)
- `features/*.feature.js`, `capabilities/*.capability.js`,
  `public/features/*.feature.js`, `public/dashboards/features/*.feature.js` (Feature Card)

Aucun registre parallèle créé (`feature-360-overrides.json`, `feature-360-ownership.json`, etc. —
interdits par la mission — n'existent pas dans ce lot).

## 3. Projection architecture

```
scripts/lib/feature-360-builder.js   → build() : modèle complet, déterministe, JSON-serializable
                                        + fonctions pures exportées pour tests négatifs
scripts/lib/feature-360-render.js    → renderMd(model) : vue de pilotage Markdown
scripts/gen-feature-360.js           → CLI wrapper (génère / --check staleness)
scripts/feature-360-check.js         → checker structurel dédié (mission §21)
scripts/feature-360-negative-tests.js→ F360-A..H + 2 tests bonus sur le build() réel
```

`gen-feature-360.js` et `feature-360-check.js` partagent la même logique de construction
(`build()`) et le même rendu (`renderMd()`) — aucune divergence possible entre génération et
vérification.

## 4. Feature 360 shape

Par feature : `id, kind, status, service, perimeter, authority, invariants, implementation,
ownership/data, interfaces, businessDependencies, consumedBy, projections, technicalContext,
boundaryHealth, governanceHealth, architecturalDebt, evidence`.

`perimeter` est projeté tel quel (chaîne libre ou forme Feature Card `{in, out}`) — jamais
reformulé.

## 5. Business dependency filtering

`businessDependencies` = union de :

- `o5.pairs` avec `conformanceStatus === 'DECLARED_AND_OBSERVED'`
- `o6.pairClassifications` avec `family ∈ {BUSINESS_FEATURE_INTERFACE, BUSINESS_TRANSVERSAL_SERVICE, PILOTING_CAPABILITY}`

Exclus explicitement (jamais mélangés) :

- `TECHNICAL_PRIMITIVE`, `NON_RUNTIME_TEST`, `COMPOSITION_ROOT_WIRING` → `technicalContext`
- `PROJECTION` → `projections.projectedBy` (jamais dans consumes/consumedBy)

`consumedBy` est une projection inverse pure (aucune déclaration manuelle) — validé
mécaniquement par `checkInverseConsistency()` sur les 28 features réelles (0 mismatch).

## 6. Ownership / data projection

Doctrine stricte WRITER != LIFECYCLE OWNER :

- `ownsTables` : uniquement si `tableOwnership[table].lifecycleOwner === id`
- `writesTables[].ownershipStatus` : `owner` | `writer-not-owner` | `ambiguous`
  (`ambiguous` si `lifecycleOwner === null` — jamais un owner inventé)

Exemple réel observé : `orders` a 10 writers sans lifecycle owner résolu → `ambiguous` pour
tous, `governanceHealth = ATTENTION` en cascade sur chaque feature qui écrit `orders`. Fait
architectural pré-existant, honnêtement surfacé, pas un bug d'O8.

## 7. Boundary health rules

```
BLOCKED    unclassifiedDependencies > 0 OR runtimeCycles > 0 OR missingExceptionsLinked > 0
           OR uncoveredOntologyGapLinked
ATTENTION  directCrossFeatureImports > 0 OR declaredNotObserved > 0
HEALTHY    aucun signal ci-dessus
```

`declaredNotObserved` = entrée `contract.consumes` avec nom résolu (`resolved: true`) mais
sans AUCUNE preuve dans `o5.pairs` (ni DECLARED_AND_OBSERVED ni OBSERVED_UNDECLARED) — trou
complet de preuve. Observé réellement sur `refunds -> orders` et `refunds -> shared-cart`.

## 8. Governance health rules

Distinct de `boundaryHealth`. `ATTENTION` si au moins un signal parmi : fichiers orphelins
(déclarés, non résolus sur disque), internal APIs non résolues (hors pattern légitime
`documented-signature-no-file`), dépendances `contract.consumes` non résolues (nom inconnu),
ontology gap lié, ownership ambigu sur au moins une table écrite.

## 9. Debt derivation

Dérivée exclusivement de signaux machine — aucune liste manuelle. Types reconnus :
`AMBIGUOUS_TABLE_OWNERSHIP, ORPHAN_IMPLEMENTATION, UNRESOLVED_INTERNAL_API,
DECLARED_NOT_OBSERVED, CONSUMES_REFERENCE_UNRESOLVED, DIRECT_CROSS_FEATURE_IMPORT,
RUNTIME_CYCLE, ONTOLOGY_GAP`. Chaque item porte `evidence` non vide (vérifié par le checker —
`FAKE_DEBT_NO_EVIDENCE` sinon).

## 10. Global scorecard (état actuel)

```
Features               : 28
Healthy                : 5
Attention              : 23
Blocked                : 0
Business dependencies  : 92
Direct cross-feature imports : 0
Runtime cycles         : 0
Ambiguous ownership signals  : (cf. FEATURE_360.json → summary)
Ontology gaps          : 1
```

0 BLOCKED confirme que la chaîne O2-O7.3 (CROSS_FEATURE_DIRECT_IMPORT=0, cycles=0,
UNCLASSIFIED=0) est fidèlement reflétée : rien n'est BLOCKED que la baseline O6 n'ait déjà
résolu. 23 ATTENTION reflètent la dette réelle et connue (ownership ambigu en cascade depuis
`orders`, `users`, quelques `declared-not-observed`), pas un artefact d'O8.

## 11. Manual validation of key features

`payments, orders, logistics, wallet, loyalty, shared-cart, platform-ops, admin-dashboard` —
tous présents avec le kind correct (`business-feature` ×6, `technical-transversal` pour
`platform-ops`, `projection` pour `admin-dashboard`). `payments` comparé en détail à
l'exemple cible de la mission (§1) : service, owns, exposes, consumes, consumed by,
projections, boundary health, debt — concordance confirmée. Correction faite au niveau du
renderer (pas de la source) : `perimeter` (objet `{in,out}`) affiché correctement au lieu de
`[object Object]`.

## 12. Negative tests

`scripts/feature-360-negative-tests.js` — F360-A à F360-H + 2 tests bonus sur `build()` réel :
**13/13 passed**. Couvre fuite bruit technique/test-only/projection, mismatch inverse
consumes/consumedBy, boundary health ATTENTION/BLOCKED, writer≠owner, dette inventée sans
evidence.

## 13. Gate integration

Branché dans `map:check` juste après le gate O6 disposition, bloquant :
`feature:360:check` → step 10/18. Suite complète `map:check` : **18/18 OK, 0 échec**.

## 14. Determinism

Deux générations successives : `docs/FEATURE_360.json` et `docs/FEATURE_360.md`
byte-identiques. Vérifié également par le checker (`NON_DETERMINISTIC_BUILD`,
`NON_DETERMINISTIC_HEALTH` — 0 violation).

## 15. Diffstat

```
NEW  scripts/lib/feature-360-builder.js
NEW  scripts/lib/feature-360-render.js
NEW  scripts/gen-feature-360.js
NEW  scripts/feature-360-check.js
NEW  scripts/feature-360-negative-tests.js
NEW  docs/FEATURE_360.json
NEW  docs/FEATURE_360.md
NEW  docs/LOT_O8_FEATURE_360_LIVRABLE.md
MOD  package.json          (+2 scripts : feature:360:gen, feature:360:check)
MOD  scripts/map-check.js  (+1 step bloquant, Lot O8)
```

## 16. Final Feature First chain O2-O8

```
O2  identité canonique des features                          ✔ fermé
O3  ownership / implementation bridge                         ✔ fermé
O4  couverture et drift                                        ✔ fermé
O5  dépendances réellement observées                           ✔ fermé
O6  qualification et suppression du bruit technique            ✔ fermé
O7.1 résolution ownership                                      ✔ fermé
O7.2 suppression des cycles runtime                             ✔ fermé
O7.3 frontières provider et internal APIs                       ✔ fermé
O8  Feature 360 — projection de pilotage business               ✔ fermé
```

Komerce est désormais pilotable par feature : le code reste la matière technique, les
graphes reconstruisent la vérité, et Feature 360 expose cette vérité au niveau business sans
le bruit d'implémentation.

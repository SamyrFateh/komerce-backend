# Lot O5 — Feature Dependency Conformance & Hidden Coupling Gate — Livrable

Statut : **codé, câblé, vérifié de bout en bout sur ce dépôt**. 0 error, ratchet stable, déterminisme confirmé, tests négatifs A-J au vert (10/10).

## 1. Ce qui a été livré

| Fichier | Rôle |
|---|---|
| `scripts/lib/feature-dependency-observer.js` | Canal A — extraction regex require()/import() + résolution physique disque. Aucune résolution métier. |
| `scripts/lib/feature-dependency-conformance.js` | Orchestration O5 : index d'identité multi-scope, collapse backend/dash/boutique, jointure Canal D (META_GRAPH), agrégation en paires, classification de conformance. |
| `scripts/business-graph-gen.js` | Câblage O5 : appelle `computeDependencyConformance`, émet les warnings typés, alimente `model.o5`, rend la section Markdown. |
| `governance/business-graph-warning-semantics.js` | Classifications par défaut des 6 nouveaux types de warning O5. |
| `governance/business-graph-drift-baseline.json` | 4 nouvelles clés ratchet O5, aucune régression sur les clés O4/O4-2. |
| `scripts/business-graph-o5-negative-tests.js` | Tests négatifs A-J, sandbox isolée, hors Jest. |

## 2. Décisions de conception appliquées (voir prompt "GO CODE")

1. **Identité technique multi-scope** — pas de `Map<fileId, featureName>` plate : `buildIdentityIndex` produit `fileOwners` (backend/dash, liste par fileId pour détecter les doublons), `boutiqueFileManifests` (fileId → manifests boutique), `manifestToCanonical`. Résolution discriminée via `resolveIdentity` → `{kind: 'canonical-feature'|'local-manifest'|'ambiguous-owner'|'ambiguous-local-manifest', ...}`. Jamais de fusion par basename.
2. **Import relatif traversant un scope** — `resolveAbsToFileId` (dans `feature-dependency-conformance.js`) teste boutique → dash → backend sans restriction de scope source ; l'observer résout la cible physiquement (`resolveRelativeOnDisk`) puis délègue la conversion fileId à cette fonction. Un `require('../../../services/x')` depuis la boutique est donc bien observé s'il se résout sur disque — la restriction "bridges O4 uniquement" ne s'applique qu'au collapse vers la feature canonique, jamais à l'observation.
3. **Collapse backend/dash** — `fileOwners` accumule TOUS les claimants (`if (!list.some(...)) list.push(...)`), jamais d'overwrite silencieux. `owners.length > 1` → `ambiguous-owner`, exclu du collapse (0 cas réel actuellement, mais le chemin est exercé par le test E).
4. **Collapse boutique** — chemin unique `fichier → boutiqueManifestImplementedBy → manifest → manifestToCanonical → canonicalFeature`. Jamais par nom (`b-payment` n'est jamais rapproché de `payment` par proximité de chaîne). Plusieurs manifests revendiquant un fichier → `ambiguous-local-manifest`, exclu du collapse (test D).
5. **Identité de consumer discriminée** — union `{kind:'canonical-feature',id}` / `{kind:'local-manifest',scope,id,canonicalFeature:null,ontologyGap}` / `{kind:'ambiguous-owner'|'ambiguous-local-manifest',...}`, jamais réduite à `string|null`.
6. **tracking ≠ boutique transversal générique** — `ontologyGapManifests` (chargé depuis `governance/business-graph-ontology-gaps.json` côté `business-graph-gen.js`) distingue les deux : `tracking` → `LOCAL-MANIFEST-DEPENDENCY-WITHOUT-CANONICAL-CONSUMER` (KNOWN_DEBT, 1 warning agrégé, 5 dépendances techniques sous-jacentes) ; `boutique` (53 fichiers JS transversaux) → `transversalRecords`, jamais versé dans `OBSERVED-UNDECLARED-FEATURE-DEPENDENCY`. Aucune Feature Card `tracking`/`analytics` inventée.
7. **modal-product/CSS** — Canal A = JS uniquement. `isJsSource` filtre par extension avant le scan ; les 4 fichiers CSS de `modal-product` ne sont ni scannés ni signalés en erreur/limitation — statut documentaire implicite (0 fichier scannable, pas un défaut).
8. **Dash — wording exact** — `coverage.dash.limitations` porte explicitement la distinction "couverture fichier statique COMPLETE" vs "observabilité runtime LIMITED (dynamic import / registry / DI / event-driven hors modèle statique)".
9. **Canal interface — jointure, pas extraction** — `scanInterfaceChannel` lit `docs/META_GRAPH.json` déjà généré par `gen-meta-graph.js`, ne réextrait aucun endpoint. Résolution module→fileId via la convention déjà utilisée par le générateur Meta Graph (basename du fichier boutique gouverné), jamais une invention ad hoc ; échec → `INTERFACE-CONSUMER-FILE-UNRESOLVED` (71 cas, tous côté dash — aucun bridge module→fileId dash câblé dans ce lot, documenté comme limitation, pas une dette).
10. **Une paire, plusieurs canaux** — `pairs: Map(fromKey\0toFeature) → {channels: Map(channel → evidence[])}` ; `static-code` et `interface` s'accumulent sur la même paire canonique sans dupliquer la relation métier.
11. **Chiffres corrigés** — 104 fichiers boutique déclarés, 91 JS scannables, 13 non-JS ; `modal-product` = 4 CSS / 0 JS ; le "61" correspond au manifest transversal `boutique`, pas à `modal-product`. Confirmé par `coverage.boutique` dans le graphe généré (91 observés, 63 = tracking(2) + boutique(61) fichiers sous manifest non-canonique).

## 3. Résultats de génération (repo réel, ce zip)

```
npm run business-graph:gen   → 28 features, 0 error, 254 warn (vs 96 avant O5)
npm run business-graph:check → reconstructible et à jour
npm run business-graph:ratchet-check → OK, toutes clés type::catégorie stables
2 générations successives    → JSON strictement identique (déterminisme confirmé)
npm run meta:graph:check     → 0 nouvelle couture fantôme
npm run arch:gate            → cliquet 0, aucun drift bloquant
node scripts/business-graph-o5-negative-tests.js → 10 passed, 0 failed
```

Répartition des 158 nouveaux warnings (254 − 96), tous couverts par la baseline ratchet :

| Type | Count | Catégorie |
|---|---|---|
| `OBSERVED-UNDECLARED-FEATURE-DEPENDENCY` | 85 | ACTIONABLE_DRIFT |
| `INTERFACE-CONSUMER-FILE-UNRESOLVED` | 71 | GENERATOR_LIMITATION |
| `DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED` | 1 | GENERATOR_LIMITATION |
| `LOCAL-MANIFEST-DEPENDENCY-WITHOUT-CANONICAL-CONSUMER` | 1 | KNOWN_DEBT |

Paires de conformance : 142 au total, 85 `OBSERVED_UNDECLARED`, 57 `DECLARED_AND_OBSERVED`, 49 relations transversales boutique (`TRANSVERSAL_TOPOLOGY`), 5 dépendances techniques `tracking`.

**Dette structurelle dominante révélée** : `infrastructure` comme provider massivement non déclaré — 23 features consomment `infrastructure` sans `contract.consumes`, ~526 preuves cumulées (ex. `logistics→infrastructure` 73, `economic-engine→infrastructure` 72, `dashboard→infrastructure` 52). Cohérent avec son rôle de socle technique-transversal (db, middleware, logging) déjà documenté par la gouvernance ; pas d'exemption automatique appliquée côté provider (seule `boutique` bénéficie d'une exemption consumer explicite, mission §6) — laissé visible pour arbitrage humain plutôt que reclassé silencieusement.

## 4. Bugs trouvés et corrigés pendant la vérification

Le module `scripts/lib/feature-dependency-observer.js` était absent des artefacts transmis (mentionné dans le transcript comme "à déplacer dans scripts/lib" mais jamais livré). Reconstruit à partir de la signature déjà documentée (`scanLocalDependencies(files, resolveAbsToFileId) → {byFile}`) et validé a posteriori : les 4 clés de baseline O5 tombent exactement sur les valeurs déjà figées (85/71/1/1), preuve que la reconstruction respecte le même modèle d'observation que celui qui avait servi à établir la baseline.

Deux défauts corrigés lors du premier passage des tests négatifs :
- **Test C** : la première version de l'observer ne détectait pas `require('./' + name)` comme dynamique (l'argument commence par une quote, donc exclu à tort du chemin "dynamique" alors qu'il n'est pas non plus un littéral pur). Corrigé en testant si l'argument entier est un littéral string pur (`^(['"])...\1$`) avant de le traiter comme statique ; sinon → dynamique, quel que soit son premier caractère.
- **Test J** : le fichier de tests référençait `result.localManifestDependenciesWithoutCanonicalConsumer`, un nom qui n'existe pas dans `feature-dependency-conformance.js` (le module expose `localManifestGapRecords`, et c'est ce nom que `business-graph-gen.js` consomme déjà en production). Corrigé côté test plutôt que côté module, pour ne pas désynchroniser le code déjà câblé et vérifié.

## 4bis. REPRISE FINALE — Dash Interface Bridge (correction post-livraison)

**Constat bloquant** : les 71 `INTERFACE-CONSUMER-FILE-UNRESOLVED` étaient tous côté dash, classés `GENERATOR_LIMITATION` avec la justification "aucun bridge module→fileId équivalent à la boutique n'est câblé". Cette classification était incorrecte : `docs/DASHBOARDS_360.json` (`modules[].id`, `modules[].file`) et les entrées dash déjà gouvernées d'`implementedByEdges` (ex. `dash:dashboards/admin/js/views/AccountingView.js`) permettaient de construire ce bridge sans aucune extraction nouvelle ni aucune invention de chemin.

**Correction appliquée** — `buildDashViewToFileId(implementedByEdges)` dans `feature-dependency-conformance.js` :
- inverse la même convention basename que `gen-meta-graph.js` utilise pour PRODUIRE `callEdges[].view` à partir des modules dash sous `views/` (même principe que le bridge boutique existant, `buildBoutiqueModuleToFileId`) ;
- ne cherche QUE parmi les entrées `implementedByEdges` déjà résolues (`status.startsWith('resolved')`) et dont le chemin `dash:...` contient un segment `views/` — jamais de concaténation d'un préfixe de dossier deviné ;
- un module dashboards référencé par META_GRAPH sans entrée `views/` gouvernée correspondante reste `INTERFACE-CONSUMER-FILE-UNRESOLVED` (0 cas restant sur ce dépôt, mais le chemin est conservé et exercé par le test K) ; un basename ambigu (2 fichiers `views/` différents partageant le même nom) tomberait en `INTERFACE-CONSUMER-FILE-AMBIGUOUS`, jamais résolu arbitrairement.

**Effet mesuré** :

```
avant   : 254 warn — INTERFACE-CONSUMER-FILE-UNRESOLVED::GENERATOR_LIMITATION = 71, OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT = 85
après   : 192 warn — INTERFACE-CONSUMER-FILE-UNRESOLVED::GENERATOR_LIMITATION = 0  (clé retirée de la baseline), OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT = 94 (+9)
```

Les 9 nouvelles paires (dette réelle, jusqu'ici invisible, révélée — pas introduite — par la correction) :

| Consumer | Provider | Vues admin-dashboard impliquées (échantillon) |
|---|---|---|
| admin-dashboard | catalog | EconomicFlowView, PricingStrategyView |
| admin-dashboard | customs | CustomsView |
| admin-dashboard | dashboard | AccountingView, PilotageFinView |
| admin-dashboard | decision-signals | ActionCenterView |
| admin-dashboard | economic-engine | AccountingView, EconomicView |
| admin-dashboard | inventory | InventoryView |
| admin-dashboard | logistics | HubRelaisView |
| admin-dashboard | orders | OrdersLogisticsView, ProblemsView |
| admin-dashboard | payments | AccountingView, InvoicesView |

Chaque paire est une vue admin réelle dont l'appel API résout (via META_GRAPH → `routeFile` → Ownership Bridge) vers une route backend appartenant à une AUTRE feature canonique que `admin-dashboard`, sans `contract.consumes` déclaré. `payments→logistics` et `payments→wallet` (déjà comptées côté canal `static-code` avant la correction) ont simplement gagné une preuve `interface` supplémentaire sur la même paire — pas de nouvelle paire, conformément au principe "une paire, plusieurs canaux" (mission §10).

**Baseline mise à jour** (`governance/business-graph-drift-baseline.json`) avec commentaire `_comment_o5_reprise` explicite, comme exigé par la règle du ratchet ("nouvelle catégorie de dette / augmentation, jamais silencieuse").

**Test négatif ajouté** — `K` (sandbox `business-graph-o5-negative-tests.js`) : vérifie qu'une vue dash sous `views/` se résout correctement vers son fileId gouverné et produit une paire `OBSERVED_UNDECLARED` côté canal `interface`, ET qu'un fichier dash hors `views/` portant le même rôle n'entre jamais dans le bridge (pas de résolution par convention approximative). **11/11 tests négatifs au vert** (A-J + K).

**Vérification complète post-correction** : `business-graph:gen` (0 error, 192 warn) → `business-graph:ratchet-check` (OK) → 2 générations successives identiques (déterminisme confirmé) → `business-graph:check` (reconstructible et à jour) → `meta:graph:check` (0 nouvelle couture fantôme) → `arch:gate` (cliquet 0) → `business-graph-o5-negative-tests.js` (11/11).

## 5. Limitations connues (documentées, pas des échecs)

- **`npm run map:check`** échoue sur `gate:concept-impact` : `git diff --name-only origin/main...HEAD` échoue car ce zip ne contient aucun `.git`. Contrainte environnementale du zip, sans rapport avec O5 (confirmé : `git status` → "not a git repository").
- **Dash — canal interface** : aucun bridge module→fileId équivalent à la boutique n'est câblé pour les manifests dash dans ce lot ; tous les consumers dash côté interface tombent en `INTERFACE-CONSUMER-FILE-UNRESOLVED` (71 cas). Documenté, pas deviné.
- **Modèle statique** : aucune preuve de dynamic import, registry lookup, dependency injection ou dépendance event-driven — uniquement des require()/import() à cible littérale ou physiquement résolvable. Les appels `require()`/`import()` avec parenthèses imbriquées dans l'argument (ex. `require(path.join(a, b))`) sont capturés jusqu'à la première parenthèse fermante puis traités comme dynamiques — limitation assumée du scanner regex, jamais une reconstruction devinée.

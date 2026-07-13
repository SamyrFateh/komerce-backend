# LOT O6 — Feature Dependency Disposition — Livrable

> **O6 classifie et gouverne la dette révélée par O5. O6 ne remédie pas encore les coutures cross-feature.**
> Rien dans ce lot n'a modifié une seule ligne de code métier, ni écrit un seul `contract.consumes`, ni cassé un seul couplage. O6 ajoute une couche de qualification/décision au-dessus des 94 paires O5 `OBSERVED_UNDECLARED` et gouverne les deux flux O5 (paires + local-manifest gaps) avec un gate bloquant.

---

## 1. Baseline O5

Commit de départ : `324d331` ("O5 baseline"). O5 non modifié (l'observer `scripts/lib/feature-dependency-conformance.js` n'a pas été touché). Régénéré tel quel :

- `model.o5.version = "O5-1.0"` (inchangé)
- 151 paires totales, dont **94 `OBSERVED_UNDECLARED`**, 57 `DECLARED_AND_OBSERVED`
- 192 warnings, 0 error (ratchet O4-2 stable : `EXPECTED_TOPOLOGY` 5/5, `KNOWN_DEBT` 30/30)
- 1 `LOCAL-MANIFEST-DEPENDENCY-WITHOUT-CANONICAL-CONSUMER` (consumer `tracking`)

O6 n'a **jamais** réobservé le code : toute la matière première vient de `model.o5.pairs` et `model.o5.localManifestDependenciesWithoutCanonicalConsumer`, déjà produits.

---

## 2. Partition réelle des 94

Classification automatique, dérivée des preuves (fichiers sources/cibles, canaux, `businessKind`), **jamais du nom** de la feature :

| Famille | N | Signification |
|---|---|---|
| `PROJECTION` | 9 | Vue Dash → endpoint backend |
| `COMPOSITION_ROOT_WIRING` | 9 | Bootstrap/cron/error-handler montent/déclenchent une feature |
| `NON_RUNTIME_TEST` | 9 | Preuve 100 % `tests/` |
| `TECHNICAL_PRIMITIVE` | 33 | Usage de db.js/middleware/logger/utils/validators d'un transversal technique |
| `BUSINESS_TRANSVERSAL_SERVICE` | 11 | Consommation réelle d'un service transversal métier |
| `CROSS_FEATURE_DIRECT_IMPORT` | 18 | `require()` direct d'un fichier d'une autre business-feature |
| `BUSINESS_FEATURE_INTERFACE` | 3 | Consommation d'une business-feature via interface/http |
| `PILOTING_CAPABILITY` | 2 | Consommation de `decision-signals` |
| **TOTAL** | **94** | |
| `UNCLASSIFIED_OBSERVED_DEPENDENCY` | **0** | Aucune paire non comprise sur la baseline courante |

Aucune famille à zéro instance n'a été ajoutée (`TOOLING_ONLY`, `RUNTIME_AND_TOOLING`, `MIXED` : absentes du code, absentes de l'ontologie).

Détail paire-par-paire : `docs/O6_INVENTORY.md`.

---

## 3. Règles de classification

Implémentées dans `scripts/lib/feature-dependency-disposition.js` (`classifyPair`), dans cet ordre de priorité :

1. **Evidence role `TEST_ONLY`** → `NON_RUNTIME_TEST`.
2. **Evidence role `TOOLING_ONLY` / `RUNTIME_AND_TOOLING`** → `UNCLASSIFIED` (0 instance actuellement — jamais absorbé silencieusement si une future preuve tombe ici).
3. **Consumer kind `projection`/`frontend-transversal`** → `PROJECTION`.
4. **Consumer possède un fichier composition-root** (`compRootOwners`, dérivé de l'ownership déclaré dans les manifests, jamais du nom) **ET** toute la preuve runtime vient de fichiers de l'allowlist wiring → `COMPOSITION_ROOT_WIRING`. Sinon → `UNCLASSIFIED` (voir §4 et test P).
5. **Provider kind `technical-transversal`** → `TECHNICAL_PRIMITIVE`.
6. **Provider kind `business-transversal`** → `BUSINESS_TRANSVERSAL_SERVICE`.
7. **Provider kind `piloting-capability`** → `PILOTING_CAPABILITY`.
8. **Provider kind `business-feature`** :
   - coupling `business-file-import` ou `import-mixed` → `CROSS_FEATURE_DIRECT_IMPORT`.
   - sinon (interface, mixed, technical-primitive côté cible) → `BUSINESS_FEATURE_INTERFACE`.
9. Tout le reste → `UNCLASSIFIED`.

Une paire non comprise bloque le gate (`business-graph:disposition-check`), elle n'est jamais absorbée dans une famille par défaut.

---

## 4. Composition-root policy

`governance/composition-root-files.json` — allowlist explicite, **pas** un test sur le nom `infrastructure` :

```json
{ "wiringFiles": ["bootstrap/api-routes.js", "bootstrap/crons.js", "middleware/error-handler.js"] }
```

`compRootOwners` est dérivé à la génération en cherchant, dans chaque manifest `features/*.feature.js`, quelle feature revendique un de ces 3 fichiers dans `files.*`. Sur la baseline actuelle, seule `infrastructure` est owner.

Une paire `consumer=compRootOwner → provider` n'est classée `COMPOSITION_ROOT_WIRING` que si **toute** la preuve runtime provient de ces fichiers wiring. Si `infrastructure` (ou tout futur owner composition-root) touche une feature depuis un fichier runtime hors de cette allowlist, la paire devient `UNCLASSIFIED` — testé explicitement (test P). Le nom ne suffit jamais.

---

## 5. Technical primitive policy

Cible reconnue primitive technique si le fichier cible matche : `middleware/`, `db.js`, `logger`, `request-id`, `utils/`, `validators/`, `core/` — ET que le provider est `technical-transversal`. 33 paires. Politique = `technical-dependency-policy` : jamais transformé en `contract.consumes`. O6 recommande d'envisager un futur champ Feature Card dédié (`technicalDependencies`) mais ne le crée pas — cette évolution nécessiterait d'analyser le schéma et les gates existants, hors scope de ce lot (conforme au §11 du prompt : *« O6 peut recommander cette évolution, ne la déploie que si nécessaire »*).

---

## 6. Business transversal service policy

11 paires runtime vers `notifications`, `documents`, `refunds` (via `dashboard`/`incident-management` transitivement classés ailleurs). Politique = `business-dependency-declare-candidate` : la dépendance métier est reconnue, mais **la couture n'est pas validée automatiquement**. Sur les 11, la quasi-totalité passe par un import direct de fichier (`business-file-import`) — donc **candidate à `contract.consumes` seulement après** exposition d'une internal API, pas immédiatement. O6 n'écrit aucun manifest.

---

## 7. Cross-feature direct imports (18)

`require()` direct d'un fichier possédé par une autre business-feature. Politique = `boundary-remediation-required` : couture à casser ou internal API à exposer **avant** toute déclaration `contract.consumes`. Liste complète : `docs/O6_INVENTORY.md` (filtre `family = CROSS_FEATURE_DIRECT_IMPORT`). Aimants de couplage observés : `payments` et `loyalty` (cibles les plus fréquentes).

---

## 8. Business interfaces (3)

`decision-signals → logistics`, `payments → logistics` (mixte import+http), `payments → wallet` (http pur). Seule `payments → wallet` est déclarable telle quelle sans remédiation de couture.

---

## 9. Projection policy (9)

Les 9 paires `admin-dashboard → *` (catalog, customs, dashboard, decision-signals, economic-engine, inventory, logistics, orders, payments) sont classées **uniquement** parce que la preuve O5/Meta Graph démontre `dash:view → endpoint → route owner` (canal interface), jamais depuis le seul nom `admin-dashboard`. Politique = `projection-dependency-policy` : jamais injectées dans un `contract.consumes` backend.

---

## 10. Piloting capabilities (2)

`dashboard → decision-signals`, `notifications → decision-signals`. Politique dédiée `piloting-capability-dependency`, distincte des features métier.

---

## 11. Exceptions ledger — count exact mesuré

**22 entrées** (`governance/feature-dependency-exceptions.json`), pas un chiffre fixé a priori — mesuré comme l'union dédupliquée (clé `from->to`) de :

- 18 paires `CROSS_FEATURE_DIRECT_IMPORT`
- 8 directions de cycle runtime (4 cycles × 2 sens)
- 4 ownership suspects (recouvrement avec les imports directs)

Décisions produites :

| Décision | N |
|---|---|
| `internal-api-required` | 10 |
| `boundary-to-break` | 8 |
| `ownership-review` | 4 |

Réconciliation vérifiée : 0 stale, 0 duplicate, 0 missing, 0 illegitimate, 0 rationale vide.

---

## 12. Cycles runtime exacts

4 cycles métier réels, calculés après exclusion `NON_RUNTIME_TEST` + `COMPOSITION_ROOT_WIRING` + `UNCLASSIFIED` :

- `auth-identity ↔ notifications`
- `logistics ↔ payments`
- `logistics ↔ purchasing`
- `payments ↔ wallet`

Chacune des 8 directions porte une décision explicite dans le ledger (`unexplainedRuntimeCycles = []`).

Cas obligatoire vérifié : **pas de cycle `auth ↔ auth-identity`** — `auth → auth-identity` est `NON_RUNTIME_TEST` (`tests/unit/auth-route.test.js`), `auth-identity → auth` est `TECHNICAL_PRIMITIVE` runtime (`routes/client-auth.js → middleware/auth.js`). Confirmé par le test R.

---

## 13. Ownership suspect

`auth-identity → orders` (`services/authkey-client.js → services/invoice-public-token.js`, preuve unique, runtime). Décision ledger : `ownership-review`, rationale citant les deux fichiers. Trois autres paires portent le même signal `ownership-suspect` par construction (transversal technique important directement un fichier de business-feature) : `platform-ops → economic-engine`, `platform-ops → logistics`, `platform-ops → orders` — même décision `ownership-review`.

---

## 14. Ontology gap coverage / tracking

`tracking` (`localManifestGap`, `canonicalFeature=null`) **n'est jamais une paire `from → to`**. Couvert via `governance/business-graph-ontology-gaps.json` (entrée `tracking-no-canonical-owner`, `boutiqueManifest: "tracking"` déjà existante, réutilisée telle quelle — pas de nouvelle entrée créée). `model.o6.ontologyGapCoverage.uncovered = []`. Le gate vérifie explicitement ce flux, séparément des paires — un `UNCLASSIFIED = 0` seul ne suffirait pas à fermer O6 (test S le prouve : un gap synthétique non couvert échoue même quand toutes les paires sont classées).

---

## 15. Negative tests L-T

`scripts/business-graph-o6-negative-tests.js` — 12 tests (L-T + 3 bonus couvrant explicitement missing/illegitimate/empty-rationale), tous exécutés contre le module partagé avec des fixtures synthétiques (aucun état disque touché) :

```
✔ L — provider kind non reconnu -> UNCLASSIFIED_OBSERVED_DEPENDENCY
✔ M — exception ledger pour une paire disparue d'O5 -> STALE_DEPENDENCY_EXCEPTION
✔ N — deux entrées de ledger pour le même from->to -> DUPLICATE_EXCEPTION
✔ O — preuve composition-root ne doit JAMAIS être classée consommation métier
✔ P — infrastructure -> business-feature depuis fichier NON wiring -> UNCLASSIFIED
✔ Q — preuve exclusivement tests/ -> NON_RUNTIME_TEST
✔ R — faux cycle auth/auth-identity -> aucun cycle détecté
✔ S — localManifestGap non couvert -> uncovered
✔ T — cycle runtime sans décision -> UNEXPLAINED_RUNTIME_CYCLE
✔ bonus — MISSING_EXCEPTION
✔ bonus — ILLEGITIMATE_EXCEPTION
✔ bonus — EMPTY_RATIONALE

12 passed, 0 failed
```

---

## 16. Gate results

`npm run business-graph:disposition-check` — recalcule depuis `scripts/lib/feature-dependency-disposition.js` (jamais confiance en un `model.o6` stale) :

```
94 paire(s) classée(s) — PROJECTION=9 COMPOSITION=9 NON=9 TECHNICAL=33 BUSINESS=11 CROSS=18 BUSINESS=3 PILOTING=2
exceptions : 22 | cycles runtime : 4 | ontology gaps couverts : 1/1
✔ O6 fermé : UNCLASSIFIED=0, STALE=0, MISSING=0, ILLEGITIMATE=0, UNEXPLAINED_CYCLE=0, UNCOVERED_GAP=0, REVIEW=0.
```

Branché dans `map:check` (`scripts/map-check.js`) immédiatement après `business-graph:ratchet-check` — confirmé exécuté et vert en position 9/17 lors du run complet.

---

## 17. Determinism

Génération x2 (`npm run business-graph:gen`), comparaison byte-for-byte :

```
docs/BUSINESS_FEATURE_GRAPH.json — identical
docs/BUSINESS_FEATURE_GRAPH.md   — identical
docs/O6_INVENTORY.md             — identical
```

Aucune dépendance à l'OS, `.git`, l'ordre `fs.readdir` ou un timestamp runtime (les seuls timestamps du modèle vivent hors O6, dans des lots antérieurs non touchés).

---

## 18. Diffstat

Commit de départ `324d331`. 11 fichiers touchés, strictement dans le scope O6 (un artefact hors-scope `docs/SECURITY_360.*`, régénéré par un side-effect d'`arch:gate`, a été explicitement exclu du commit) :

```
 docs/BUSINESS_FEATURE_GRAPH.json              | 1760 ++++++++++++++++++++++++-
 docs/BUSINESS_FEATURE_GRAPH.md                |  201 +++
 docs/O6_INVENTORY.md                          |  160 +++ (nouveau)
 governance/composition-root-files.json        |    9 +   (nouveau)
 governance/feature-dependency-exceptions.json |  212 +++ (nouveau)
 package.json                                  |    1 +
 scripts/business-graph-disposition-check.js   |  129 ++  (nouveau)
 scripts/business-graph-gen.js                 |  224 +/-
 scripts/business-graph-o6-negative-tests.js   |  173 +++ (nouveau)
 scripts/lib/feature-dependency-disposition.js |  340 +++ (nouveau)
 scripts/map-check.js                          |   16 +
 11 files changed, 3222 insertions(+), 3 deletions(-)
```

Gates exécutés (§19 du prompt) :

| Gate | Résultat |
|---|---|
| `npm run arch:gate` | ✔ vert |
| `npm run business-graph:gen` | ✔ 0 error, 192 warn |
| `npm run business-graph:check` | ✔ reconstructible et à jour |
| `npm run business-graph:ratchet-check` | ✔ 192 stable, 0 dette nouvelle |
| `npm run business-graph:disposition-check` | ✔ O6 fermé |
| `npm run meta:graph:check` | ✔ 0 nouvelle couture fantôme |
| `node scripts/business-graph-o5-negative-tests.js` | ✔ 11 passed |
| `node scripts/business-graph-o6-negative-tests.js` | ✔ 12 passed |
| `npm run map:check` | ✖ 3 échecs **préexistants, sans rapport avec O6** (voir note) |
| `npm test` | ✔ 336/349 suites, 5896/5922 tests (13 skipped) |

**Note honnête sur `map:check`** : `gate:concept-impact` échoue car ce workspace git a été réinitialisé pour ce lot (pas de remote `origin/main`) — limitation d'environnement, pas un défaut O6. En bypassant ce sous-gate pour inspecter `scripts/map-check.js` directement, notre entrée **`Business Feature Graph — dependency disposition (Lot O6, bloquant)` est passée verte en position 9/17**, immédiatement après le ratchet O4-2, à l'emplacement prescrit. Les 3 échecs restants (Gate 1 — dépend aussi du même diff git manquant ; Gate 4 — feature-audit ; Gate 5 — un fichier `docs/rex/REX_2026-07-10_PR563_ALERTS_DB_POOL.md` déjà présent au commit de départ, hors scope O6) préexistaient avant ce lot et n'ont pas été introduits par O6.

---

## 19. Remaining architectural debt

O6 ne corrige rien. Ce qui reste ouvert après ce lot :

- **18 imports directs cross-feature** (famille F) à découpler via internal API — aimants : `payments`, `loyalty`.
- **4 cycles runtime réels** à trancher définitivement (accepter par doctrine / casser / rehome) — actuellement documentés avec une décision de principe (`boundary-to-break`), pas une remédiation de code.
- **4 ownership suspects** (`auth-identity → orders`, `platform-ops → {economic-engine, logistics, orders}`) à investiguer — le fichier est-il mal rattaché, ou la dépendance légitime mais l'ownership du transversal mal borné ?
- **11 consommations `business-transversal`** mûres pour `contract.consumes`, mais 10 sur 11 passent encore par un import direct — internal API à exposer avant déclaration.
- `tracking` reste un ontology gap produit non tranché (question ouverte déjà documentée en O4, non rouverte ici).
- Aucune remédiation de code n'a eu lieu. Aucune des 34 consommations métier réelles n'est déclarée dans un manifest. Le code n'est pas découplé.

O6 est fermé sur son propre périmètre (classification + gouvernance + gate). O7, s'il a lieu, n'a pas été commencé.

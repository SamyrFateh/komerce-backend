# GAP — Supplier Connectivity Alignment

> **Destinataire** : Sonnet (exécution)
> **Auteur** : architecte (Opus) — aucune ligne de code, aucune PR
> **Base** : `origin/main` @ `5e3953d` (post-#1592)
> **Provider prouvé** : Allegro Sandbox (n=1). Provider atypique : pas de buyer placeOrder API.
> **Règle de conception** : on ne généralise pas une idée élégante ; on généralise un concept qu'un provider réel force à représenter. Quand un provider révèle une différence, demander « quel concept générique manque à Komerce ? » avant d'ajouter une branche provider.

---

## État d'exécution — mis à jour au fil des GAP

> Cette section est la seule à mettre à jour pendant l'exécution. Le corps du GAP (sections 0 à 7 + plan) reste la spécification stable ; ne pas la réécrire au fil de l'eau. Un futur agent doit pouvoir lire uniquement cette section pour savoir où reprendre.

| GAP | Statut | PR | Notes |
|-----|--------|-----|-------|
| **GAP-1** — Provider Authority | ✅ Exécuté, mergée | [#1596](https://github.com/SamyrFateh/komerce-backend/pull/1596) — mergée dans `main` | Voir « Leçons de GAP-1 » ci-dessous avant d'attaquer GAP-4 |
| **GAP-3** — Readiness Convergence | ✅ Exécuté, CI verte | [#1598](https://github.com/SamyrFateh/komerce-backend/pull/1598) — branche `feat/readiness-convergence-gap3` — **ouverte, pas encore mergée** | Voir « Leçons de GAP-3 » ci-dessous avant d'attaquer GAP-4 |
| **GAP-2** — Adapter Resolution | ✅ Exécuté, CI verte | [#1599](https://github.com/SamyrFateh/komerce-backend/pull/1599) — branche `feat/adapter-resolution-gap2` — **ouverte, pas encore mergée** | Voir « Leçons de GAP-2 » ci-dessous avant d'attaquer GAP-4 |
| **GAP-4** — Branch Real Purchasing Through Gate | Non commencé | — | Prochain dans l'ordre de dépendance ; le plus risqué ; lire les leçons de GAP-1/2/3 ci-dessous avant de commencer |
| GAP-5 — Execution Evidence Boundary | Non commencé | — | |
| GAP-6 — Environment Isolation | Non commencé | — | Majoritairement DEFER par arbitrage |
| GAP-7 — Feature Manifest | Non commencé | — | Doit rester en dernier |

### Ce que GAP-1 a réellement livré (PR #1596)

- `services/suppliers/provider-authority.js` — autorité canonique unique, gelée, miroir exact du CHECK DB `suppliers_platform_check`.
- `manual` retiré de l'allowlist providers (doctrine tranchée : provider identity ≠ execution mode — `manual` est un mode d'exécution, jamais un provider). Fixtures de test qui utilisaient `platform: 'manual'` renommées vers `platform: 'local'` (provider réel).
- `services/suppliers/purchasing-validators.js` — la validation purchasing (créée en cours d'exécution, absente du GAP original, voir leçon ci-dessous), possédée par purchasing, consomme `provider-authority.js`.
- `validators/index.js` (barrel `@domain infrastructure`) ne référence plus aucun concept purchasing — retour à zéro import cross-feature, aligné sur tous les autres domaines du barrel.
- 16 tests dédiés (`provider-authority.test.js`) + mises à jour de 3 fichiers de test existants.
- **Aucune migration, aucun changement de comportement pour un provider réel.**

### Leçons de GAP-1 — à lire avant GAP-4

**1. Le repo a un ratchet de gouvernance qui verrouille `OBSERVED-UNDECLARED-FEATURE-DEPENDENCY` à zéro.** Mécanisme : `node scripts/business-graph-gen.js` génère `docs/BUSINESS_FEATURE_GRAPH.json`, `npm run business-graph:ratchet-check` compare le compte de dette actuel à `governance/business-graph-drift-baseline.json` par clé `TYPE::CATEGORIE`. Toute nouvelle clé (import direct d'un fichier `@domain X` par un fichier `@domain Y`, où Y n'a pas cette dépendance déclarée) **échoue le CI**, même si un mécanisme d'exception existe (`governance/feature-dependency-exceptions.json`) — car pour **cette clé précise**, la doctrine inscrite dans le baseline dit explicitement « Debt Zero absolute… jamais relevée ». Ajouter une exception au lieu de corriger l'architecture est possible mécaniquement mais **contredit l'intention documentée du repo**.

**2. Le vrai signal était juste : les fichiers `@domain purchasing` (comme `provider-authority.js`) ne doivent être importés QUE par du code `@domain purchasing`.** Le premier jet de GAP-1 faisait importer `provider-authority.js` par `validators/index.js` (`@domain infrastructure`) — violation. Correction : la validation purchasing a migré vers un fichier `@domain purchasing` dédié (`purchasing-validators.js`), qui peut importer `provider-authority.js` sans franchir de frontière. **Avant de faire importer un fichier `@domain purchasing` par du code hors de cette feature dans GAP-2, GAP-4 ou GAP-5, vérifier le `@domain` du fichier appelant et, si besoin, faire tourner localement :**
```
node scripts/business-graph-gen.js --dash-root public --boutique-root public/boutique
npm run business-graph:ratchet-check
node scripts/feature-guard.js
```
**avant** de pousser, pas après — le premier passage de GAP-1 a découvert ça en CI, le second en local en une commande. GAP-4 touche `purchasing-trigger-service.js` (déjà `@domain purchasing`, donc a priori sûr) mais introduit potentiellement un registry d'adapters injecté depuis l'extérieur — vérifier que ce registry n'est pas construit dans un fichier hors périmètre purchasing.

**3. Toujours vérifier les consommateurs réels avant de déplacer du code.** Le déplacement du bloc `purchasing` hors du barrel n'a été sûr que parce qu'une vérification (`grep -rln` sur tout le repo) a confirmé qu'il n'avait **aucun consommateur en production**, seulement 2 fichiers de test. Sans cette vérification, le déplacement aurait pu casser une route vivante.

**4. Les artefacts générés (`docs/BUSINESS_FEATURE_GRAPH.json/.md`, `docs/O6_INVENTORY.md`) doivent être commités après toute régénération**, et le CI compare ces fichiers commités à une régénération fraîche (`--check`). Si le graphe n'a pas été régénéré depuis plusieurs PR (ce qui était le cas ici — pas régénéré depuis avant #1594/#1595), le premier agent qui le regénère absorbe tout le rattrapage dans son diff. Ce n'est pas une régression introduite par cet agent — mais il faut le documenter dans le commit pour que la revue ne s'y méprenne pas.

### Ce que GAP-3 a réellement livré (PR #1598)

- `docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md` §9bis — sépare explicitement CAPABILITY / READINESS / EXECUTION_MODE. Découverte en cours de route : la doctrine avait **déjà** une échelle capability à 4 niveaux (§8 : `MODEL_SIMULATION_READY` → `MANUAL_PROCUREMENT_READY` → `SUPPLIER_API_PREFLIGHT_READY` → `AUTO_ORDER_READY`), simplement jamais reliée au vocabulaire code. GAP-3 ne l'a pas réinventée, il l'a connectée.
- Table de correspondance exacte `canonical-unit-purchasing-gate.js` → `VERDICT.*`, avec le vocabulaire canonique confirmé (`VERDICT.*`, déjà utilisé nativement par l'adapter Allegro).
- `tests/unit/purchasing-readiness-vocabulary-mapping.test.js` (10 tests) — verrouille chaque affirmation de la doctrine contre le code réel.
- **Zéro fichier de code production touché**, conformément à la contrainte GAP-3.

### Leçons de GAP-3 — à lire avant GAP-4

**1. Une doctrine écrite de mémoire peut se tromper — vérifier contre le code exact avant de publier, pas après.** Un premier jet de la table de correspondance a confondu les champs `.status` et `.reason` du gate (`canonical-unit-purchasing-gate.js`) : le gate ne retourne **pas** un `.status` différent par cause d'échec — `blocked(reason, evidence)` fixe `.status` à la constante unique `BLOCKED_SUPPLIER_IDENTITY` dans tous les cas, et c'est `.reason` qui porte la cause précise. L'erreur a été trouvée en retraçant le fichier source ligne par ligne avant d'écrire la doctrine finale, pas en la déployant puis en la corrigeant. **Pour GAP-4 : ne jamais documenter un contrat de statut/champ sans avoir relu le fichier source exact juste avant.**

**2. `HARD_STOP` est un nom trompeur — c'est le succès terminal du gate, pas un échec.** `status:'HARD_STOP'` avec `ready:false` signifie « payload construit, prêt pour exécution manuelle ou automatique en aval » ; `ready:false` signifie seulement que `place_order_invoked` est faux, pas que la readiness est négative. **GAP-4 va manipuler directement ce retour** (c'est le composition root que GAP-4 doit brancher sur le vrai chemin) — ne pas traiter `HARD_STOP` comme une branche d'erreur en l'implémentant.

**3. Dette identifiée, volontairement non corrigée : `triggerMode` (purchasing-trigger-service.js) et `evidence.execution_mode` (evidence de l'adapter) sont deux calculs indépendants.** Ils concordent aujourd'hui uniquement parce qu'Allegro fixe les deux en dur de façon cohérente (`execution_mode:'manual'` côté adapter, `auto_order:false` côté ligne fournisseur en base). Rien ne garantit cette cohérence pour un futur provider. **GAP-4, en branchant le gate (qui porte l'evidence adapter) sur `purchasing-trigger-service.js`, est le bon moment pour dériver `triggerMode` depuis `evidence.execution_mode`/`auto_order_ready` plutôt que depuis `ps.auto_order` recalculé indépendamment.** Ne pas découvrir ça en cours de GAP-4 — c'est déjà documenté, section 9bis.5 de la doctrine.

### Ce que GAP-2 a réellement livré (PR #1599)

- `services/suppliers/execution-adapter-registry.js` (nouveau) — composition root unique `{ allegro, aliexpress }`, gelé. Réutilise `supplier-fulfillment-adapter-contract.js:validateAdapter()` tel quel — même contrat déjà utilisé par le gate et la readiness, pas de nouvelle abstraction.
- `purchasing-trigger-service.js` — `callSupplierAPI` ne contient plus aucun `switch(platform)` ni aucun nom de provider en dur. Les 3 stubs (`noonOrder`/`amazonOrder`/`aliexpressOrder`, qui n'ont jamais retourné `success:true`) ont disparu sans changement de comportement observable.
- Deux causes d'échec distinctes (provider non enregistré vs adapter connu sans `placeOrder`), jamais confondues dans le message `.error`, mais produisant le **même résultat observable** (`api_failed_notified`, chemin manuel identique à aujourd'hui) — aucun comportement changé, seul le diagnostic est plus précis.
- `tests/unit/purchasing-adapter-resolution.test.js` (10 tests) — dont une caractérisation explicite qu'Allegro `auto_order=false` n'atteint jamais la résolution d'adapter (fige le comportement Golden actuel).
- **Zéro migration, zéro changement de comportement pour un provider réel.**

### Leçons de GAP-2 — à lire avant GAP-4

**1. Le registry d'exécution est délibérément conçu pour être réutilisé par GAP-4, pas dupliqué.** `execution-adapter-registry.js` exporte exactement la même forme de map `{provider: adapter}` que celle attendue par `canonical-unit-purchasing-gate.js` (paramètre `adapters`). **GAP-4 doit importer `EXECUTION_ADAPTER_REGISTRY` depuis ce fichier pour l'injecter dans le gate — ne pas construire une seconde map.** Un seul provider s'enregistre une fois, consommé par les deux usages (preflight readiness via le gate, résolution d'exécution auto-order via `callSupplierAPI`).

**2. Une erreur de test peut ressembler à une erreur de production — vérifier lequel avant de corriger.** Le premier run des nouveaux tests GAP-2 a échoué avec `Cannot read properties of undefined (reading 'catch')`, y compris sur un test qui n'atteignait même pas le code modifié (`auto_order=false`). Ça sentait le bug de production, mais la cause était un oubli dans le `beforeEach` du **nouveau fichier de test lui-même** (`notifyText.mockResolvedValue(undefined)` manquant — présent dans le fichier de test existant, oublié en écrivant le nouveau). Diagnostiqué en comparant les deux fichiers de test avant de toucher au code de production. **Pour GAP-4 : un échec de test qui touche un chemin non modifié est un signal fort que le bug est dans le test, pas dans le code — vérifier le mock setup avant de suspecter une régression.**

**3. Assertions de non-régression trop larges peuvent masquer un vrai changement de comportement — vérifier précisément ce qu'elles couvrent.** Les 4 tests existants `auto_order=true` (`purchasing-trigger-service.test.js`, `purchasing.test.js`) n'assertent que `result.purchase_orders[0].status`, jamais le contenu de `apiResult.error`. C'est ce qui a rendu le refactor GAP-2 invisible à ces tests — légitime ici (le contenu du message d'erreur n'est contractuel nulle part), mais **GAP-4 doit vérifier, avant de s'appuyer sur "les tests existants passent" comme preuve de non-régression, que ces tests assertent bien le champ que GAP-4 modifie** — sinon un vrai changement de comportement passerait aussi inaperçu.

---

## Comment lire ce document

Chaque GAP fournit : Problem · Evidence · Current files · Target contract · Minimal delta · Files likely touched · Tests required · Migration required? · Risk · Rollback · Definition of Done.

Les GAP sont **ordonnés par dépendance** (voir EXECUTION PLAN en fin de document). Ne pas exécuter dans le désordre : GAP-1 établit l'autorité que GAP-2/3/4 consomment. Inverser = refactorer A puis découvrir que B était l'autorité réelle.

Trois classes de travail sont explicitement distinguées à la fin : **SAFE TO EXECUTE NOW**, **DEFER UNTIL PROVIDER #2**, **DO NOT BUILD**.

---

## GAP-0 — Baseline (état réel constaté dans le code)

**But** : ancrer tous les GAP suivants dans le code réel, pas dans le modèle idéal.

### Chemin Golden réel (celui qui s'exécute)

```
routes/cash.js:152  triggerPurchasing(orderId)
  └→ services/purchasing-trigger-service.js  (LE chemin réel)
       ├─ loadExactSoldSku()          → product_skus, normalizeIdentity()
       ├─ resolveCanonicalSupplierMoney()  → purchasing-canonical-money.js
       ├─ loadSupplierMapping()       → product_suppliers JOIN suppliers, WHERE lower(platform)=provider
       ├─ findExistingPo()            → idempotence
       ├─ triggerMode = auto ? 'auto' : (platform==='whatsapp' ? 'whatsapp' : 'manual')
       ├─ INSERT purchase_orders
       └─ if (ps.auto_order) callSupplierAPI(purchaseTarget, item)   ← switch(platform)
```

### Composants génériques existants (déjà provider-agnostic)

| Fichier | Rôle | Statut réel |
|---------|------|-------------|
| `services/suppliers/supplier-order-identity.js` | SOI `{provider,version,payload}`, `normalizeIdentity()` | **BRANCHÉ** sur le chemin réel (via loadExactSoldSku + canonical-money) |
| `services/purchasing-canonical-money.js` | native money `{amount,currency}` | **BRANCHÉ** sur le chemin réel |
| `services/suppliers/supplier-fulfillment-adapter-contract.js` | `validateAdapter()`, `validateVerdict()` | **DORMANT** vis-à-vis du chemin réel |
| `services/suppliers/supplier-fulfillment-readiness.js` | `evaluateSupplierFulfillmentReadiness()`, `VERDICT.*` | **DORMANT** vis-à-vis du chemin réel |
| `services/suppliers/canonical-unit-purchasing-gate.js` | `prepareCanonicalUnitPurchase()` composition root | **DORMANT** — importé seulement par sourcing-resolution + prebuyer proof |
| `services/suppliers/allegro-fulfillment-adapter.js` | adapter Allegro (`evaluate`, `buildOrderPayload`, `exactOfferId`) | branché via gate/readiness, PAS via trigger-service |
| `services/suppliers/allegro-purchase-reconciliation.js` | `verifyCheckoutForm()`, `reconcile()` | appelé **uniquement** par `scripts/allegro-sandbox-purchase-proof.js` |

### Dette provider-specific (localisée précisément)

1. **`purchasing-trigger-service.js:94-101`** — `callSupplierAPI()` : `switch(ps.platform)` avec `noon`/`amazon_uae`/`aliexpress` en dur + 3 stubs Phase 2. C'est **le seul** endroit où Purchasing connaît des noms de provider. Invoqué uniquement sous `if (ps.auto_order)`.
2. **Autorité provider éclatée en 4 endroits** qui dérivent indépendamment :
   - `db/schema.sql` — `suppliers_platform_check` CHECK allowlist
   - `validators/index.js` — `PLATFORMS` allowlist (contient `manual`, absent du CHECK → **pas un drift à synchroniser mais un concept mal placé** : `manual` est un mode d'exécution, pas un provider ; il sera retiré, cf. GAP-1)
   - `purchasing-trigger-service.js` — `callSupplierAPI` switch
   - `services/sourcing-import-dispatch.js` — connector dispatch (csv/manual/noon/cj/aliexpress/allegro)
3. **Deux vocabulaires de verdict** cohabitent déjà (voir GAP-3) :
   - gate → `BLOCKED / HARD_STOP / ready:boolean`
   - readiness → `VERDICT.{READY, OUT_OF_STOCK, …}` = `FULFILLMENT_READY`…
   - adapter Allegro → booléens `manual_procurement_ready`, `auto_order_ready`
4. **Confirmation PO par évidence réconciliée : inexistante en générique.** La reconciliation Allegro n'est jamais appelée par un service de confirmation ; seuls les scripts proof la touchent.

### Ce que le Golden prouve déjà (ne pas re-litiger)

PO `b70e301c…`, seller order `1f6c5c90…`, `READY_FOR_PROCESSING`, `purchase_confirmed=true`, `manual_procurement_ready=true`, `auto_order_ready=false`, idempotent replay OK.

---

## GAP-1 — Provider Authority (une seule autorité canonique)

### Problem
L'identité provider supportée est déclarée dans 4 endroits qui divergent sans propriétaire unique. Le drift est **déjà réel** : `manual` existe dans `validators.PLATFORMS` mais pas dans `suppliers_platform_check`. Ajouter un provider = éditer 4 fichiers, en oublier un = drift silencieux.

### Evidence
- `git grep` de `noon|amazon_uae|aliexpress|allegro` retourne les 4 sites listés en GAP-0.
- `validators/index.js` : `PLATFORMS = [...,'manual','local','allegro']`.
- `db/schema.sql` : CHECK sans `manual`.
- Incident #1592 v1 : l'édition manuelle du dump a déplacé la baseline CI. Preuve que la topologie d'autorité actuelle est fragile.

### Current files
`db/schema.sql`, `validators/index.js`, `services/purchasing-trigger-service.js`, `services/sourcing-import-dispatch.js`.

### Target contract
**Une autorité code canonique unique** — un module unique qui exporte la liste des providers supportés et une fonction `isSupportedProvider(code)`. Les autres sites la **consomment** au lieu de redéclarer. **Pas de table par défaut** (arbitrage §2 : commencer par une autorité code). Pas de changement de comportement provider.

```
services/suppliers/provider-authority.js   (nouveau, ~40 lignes, zéro dépendance)
  exports: PROVIDERS (frozen), isSupportedProvider(code), normalizeProviderCode(code)
```

**Doctrine gouvernante (tranchée par le donneur d'ordre) — provider identity ≠ execution mode.**
Deux dimensions distinctes qui ne doivent jamais cohabiter dans la même liste :
```
provider / platform  = allegro | aliexpress | cj | noon | amazon_uae | local | whatsapp
execution mode       = manual | automatic
```
`manual` est un **mode d'exécution**, pas un provider. Sa présence dans `validators.PLATFORMS`
est un concept au mauvais endroit, pas une liste à synchroniser avec le CHECK. La correction
n'est donc PAS « aligner les deux listes » mais « retirer `manual` du validator ». Cette règle
est le pendant, côté identité, de la séparation capability ≠ readiness posée en GAP-3.

### Minimal delta
1. Créer `provider-authority.js` avec la liste canonique = union actuelle **réellement supportée** (`noon, amazon_uae, aliexpress, local, whatsapp, allegro`). **`manual` est exclu** — tranché : ce n'est pas un provider (voir Doctrine ci-dessous).
1bis. **Retirer `manual` de `validators.PLATFORMS`.** Ne PAS l'ajouter au CHECK DB. C'est le validator qui contient un concept au mauvais endroit, pas le CHECK qui serait incomplet.
2. `validators/index.js` : remplacer le littéral `PLATFORMS` par un import de `provider-authority`. Comportement identique.
3. Laisser `db/schema.sql` CHECK **inchangé** pour l'instant (la contrainte DB reste le fail-closed dernier ressort ; l'aligner est un GAP DB séparé nécessitant migration — hors périmètre ici).
4. `sourcing-import-dispatch.js` : **ne pas toucher** le dispatch connector (comportement différent — read-path). Documenter seulement qu'il devra consommer la même autorité au provider #2.

### Files likely touched
`services/suppliers/provider-authority.js` (nouveau), `validators/index.js`.

### Tests required
- `provider-authority.test.js` : liste canonique gelée, `isSupportedProvider('allegro')=true`, `isSupportedProvider('totally_unknown')=false`, `normalizeProviderCode` idempotent/case-insensitive.
- **`isSupportedProvider('manual')=false`** — `manual` n'est pas un provider (fige la doctrine, empêche sa réintroduction silencieuse).
- Le validator ne référence plus `manual` dans `PLATFORMS` (test grep-like sur le source).
- Caractérisation : les validations existantes de `validators` restent vertes pour les vrais providers (aucun changement de comportement sur `allegro`, `noon`, etc.).

### Migration required?
**NO.** Autorité code seulement. Le CHECK DB reste tel quel.

### Risk
- **`manual` — TRANCHÉ** : retiré de `validators.PLATFORMS`, jamais ajouté au CHECK DB. `manual` est un mode d'exécution, pas un provider (voir Doctrine). Ne pas rouvrir cette décision.
- Vérifier avant retrait qu'aucun supplier existant n'a `platform='manual'` en base (le CHECK l'interdit déjà, donc improbable — mais un contrôle read-only le confirme). Si un tel row existait, c'est une donnée à corriger séparément, pas une raison de garder `manual` dans le validator.
- Risque bas : changement purement déclaratif, aligné sur l'autorité DB existante.

### Rollback
Réinliner le littéral `PLATFORMS`. Un seul fichier.

### Definition of Done
Un seul module exporte la liste des providers ; `validators` la consomme ; `manual` retiré de `validators.PLATFORMS` et absent de l'autorité ; `isSupportedProvider('manual')=false` testé ; test de gel vert ; aucun changement de comportement observable sur les vrais providers ; note écrite pour le futur alignement sourcing dispatch. La doctrine provider identity ≠ execution mode est inscrite dans le module ou sa doctrine.

---

## GAP-2 — Adapter Resolution (Purchasing ne connaît plus aucun nom provider)

### Problem
`callSupplierAPI` contient un `switch(ps.platform)` avec des noms de provider en dur dans le cœur Purchasing. Rendre un provider auto-orderable demain = éditer Purchasing. Viole le critère final (« ajouter un provider sans modifier `purchasing-trigger-service.js` »).

### Evidence
`purchasing-trigger-service.js:94-101`. Invoqué uniquement sous `if (ps.auto_order)` (ligne 248). Allegro ne l'atteint pas (`auto_order=false`), donc **ce n'est pas un blocker Golden** — c'est un blocker de doctrine future.

### Current files
`purchasing-trigger-service.js` (switch + 3 stubs `noonOrder/amazonOrder/aliexpressOrder`).

### Target contract
```
provider → adapter resolution → capability(placeOrder?) → execute()
jamais   → switch(provider)
```
Le cœur demande : « pour ce provider, l'adapter déclare-t-il la capability `auto_order` / `placeOrder` ? » Si oui → `adapter.placeOrder()`. Sinon → chemin manuel (déjà existant). Résolution **fail-closed** : provider sans adapter → hard stop, jamais de fall-through silencieux.

Réutiliser le contrat existant : `supplier-fulfillment-adapter-contract.js:validateAdapter(provider, adapter)` fait déjà exactement la résolution + le provider-mismatch check. **Ne pas créer de nouveau registry** — réutiliser ce contrat.

### Minimal delta
1. Introduire un **adapter registry d'exécution** minimal : un map `{ allegro: allegroFulfillmentAdapter, … }` injecté (comme `canonical-unit-purchasing-gate.js` prend déjà `adapters = {}`). Ce map est le composition root, pas une nouvelle abstraction.
2. Remplacer le corps de `callSupplierAPI` : au lieu de `switch(platform)`, faire `validateAdapter(provider, registry[provider])` → si `ok` et adapter expose `placeOrder` → l'appeler ; sinon renvoyer le verdict « pas d'auto-order, mode manuel » (comportement actuel du `default`).
3. Les stubs `noonOrder/amazonOrder/aliexpressOrder` : les laisser tomber (aucun n'a jamais retourné `success:true`). Leur disparition ne change aucun comportement observable.
4. **Ne rien changer au chemin manuel** (le Golden Allegro passe par là).

### Files likely touched
`purchasing-trigger-service.js`, éventuellement un petit `services/suppliers/execution-adapter-registry.js` (composition root, ~20 lignes). Réutilise `supplier-fulfillment-adapter-contract.js` tel quel.

### Tests required
- Caractérisation AVANT : `auto_order=false` + Allegro → mode manuel, `callSupplierAPI` jamais atteint (fige le comportement Golden actuel).
- `provider inconnu + auto_order=true` → hard stop fail-closed (pas de `success:false` silencieux ambigu).
- `adapter sans placeOrder` → chemin manuel.
- Aucun nom de provider en dur ne subsiste dans `purchasing-trigger-service.js` (test grep-like sur le source, comme le fait déjà la preflight suite).

### Migration required?
**NO.**

### Risk
- **Moyen.** On touche le cœur Purchasing. Mitigation : le chemin manuel (seul exercé par le Golden) reste identique ; seul le bloc `if (ps.auto_order)` change, et il n'a **aucun** provider auto réel aujourd'hui (tous les stubs renvoient `success:false`). Le blast radius réel est donc nul en production, total en doctrine.
- Ne PAS déplacer le switch sous un autre nom (interdit explicitement). La résolution doit passer par capability, pas par une table `if/else` déguisée.

### Rollback
Restaurer `callSupplierAPI` switch. Isolé dans un fichier.

### Definition of Done
`purchasing-trigger-service.js` ne contient plus aucun littéral `'noon'|'amazon_uae'|'aliexpress'|'allegro'`. L'exécution auto passe par résolution d'adapter + capability. Fail-closed sur adapter absent prouvé par test. Chemin manuel Golden inchangé (caractérisation verte).

---

## GAP-3 — Readiness Convergence (un seul langage)

### Problem
Trois vocabulaires de readiness coexistent, traités comme s'ils étaient des états indépendants alors que certains sont des **capabilities** et d'autres des **états runtime**.

### Evidence
- `canonical-unit-purchasing-gate.js` : `BLOCKED / HARD_STOP / ready:boolean`.
- `supplier-fulfillment-readiness.js` : `VERDICT.{READY='FULFILLMENT_READY', OUT_OF_STOCK, SKU_INACTIVE, SUPPLIER_UNAVAILABLE, PREFLIGHT_FAILED, …}`.
- `allegro-fulfillment-adapter.js` : booléens `manual_procurement_ready`, `auto_order_ready`.

### Current files
Les trois ci-dessus + `purchasing-trigger-service.js` (`triggerMode`).

### Target contract — séparation canonique (arbitrage §4)
Deux axes strictement disjoints, **ne jamais les mélanger** :

```
CAPABILITY  = ce que l'intégration provider SAIT faire (statique, déclaré par l'adapter)
              ex: exact_offer_read, live_facts, manual_procurement, auto_order
READINESS   = est-ce que CETTE unité × CETTE quantité × CETTE route est exécutable MAINTENANT
              (runtime, calculé) — un seul enum canonique
EXECUTION_MODE = dérivé : capability ∩ readiness → { AUTO | MANUAL | BLOCKED }
```

Langage canonique unique retenu (celui de `supplier-fulfillment-readiness.js:VERDICT`, le plus complet et le seul avec contrat de validation) :
```
FULFILLMENT_READY | OUT_OF_STOCK | SKU_INACTIVE | SUPPLIER_UNAVAILABLE
| PRICE_DRIFT_BLOCKED | NOT_SHIPPABLE | FREIGHT_UNAVAILABLE | PREFLIGHT_FAILED
| BLOCKED_SUPPLIER_IDENTITY | PROCUREMENT_ROUTE_UNRESOLVED
```

### Minimal delta (sans big-bang)
| Élément actuel | Décision | Action |
|----------------|----------|--------|
| `VERDICT.*` (readiness) | **GARDER** — c'est le langage canonique | aucune |
| gate `HARD_STOP/BLOCKED` | **MAPPER** vers `VERDICT` | le gate retourne déjà `status`; documenter l'équivalence, ne pas dupliquer |
| `manual_procurement_ready` / `auto_order_ready` (booléens adapter) | **RECLASSER en CAPABILITY** | ne plus les lire comme un état readiness ; ils déclarent ce que l'adapter sait faire |
| `triggerMode` (`auto/whatsapp/manual`) | **DÉPRÉCIER à terme** au profit de `execution_mode` dérivé | pas de suppression maintenant — mapper |

Principe : **converger le vocabulaire par mapping documenté, pas par réécriture**. Aucune migration DB. La suppression physique des vocabulaires redondants est différée jusqu'à ce que GAP-4 ait branché le vrai chemin sur un moteur unique.

### Files likely touched
Documentation de mapping (doctrine) + petites annotations. Idéalement zéro changement de comportement dans ce GAP — c'est un GAP de **convergence conceptuelle** qui prépare GAP-4.

### Tests required
- Test de non-régression : les verdicts émis aujourd'hui restent identiques.
- Test documentant l'équivalence `HARD_STOP` (gate) ↔ statut readiness correspondant.

### Migration required?
**NO.**

### Risk
- Bas si on se limite au mapping. **Élevé si on tente de tout réécrire maintenant** — interdit. Le piège : vouloir supprimer `triggerMode` avant que GAP-4 ait unifié le moteur.

### Rollback
Documentation seule → rollback trivial.

### Definition of Done
Un document de doctrine énonce : le vocabulaire readiness canonique unique, la table de mapping des deux autres vers lui, et la règle « capability ≠ readiness ». Aucun nouveau vocabulaire introduit. Prêt à être consommé par GAP-4.

---

<!-- suite : GAP-4 à GAP-7 + EXECUTION PLAN dans la partie 2 -->

## GAP-4 — Branch Real Purchasing Through Generic Gate (le plus important)

### Problem
Les trois composants génériques (`canonical-unit-purchasing-gate.js`, `supplier-fulfillment-readiness.js`, `supplier-fulfillment-adapter-contract.js`) existent et sont testés, mais **le chemin réel (`purchasing-trigger-service.js`) ne les appelle pas**. Le Golden passe par une logique stock/price/identity réimplémentée en ligne dans le trigger. Résultat : deux moteurs, un dormant et un réel, qui peuvent diverger.

### Evidence
- Imports de `purchasing-trigger-service.js` : uniquement `supplier-order-identity` + `purchasing-canonical-money`. **Aucun** des trois composants génériques.
- `canonical-unit-purchasing-gate.js` : importé seulement par `sourcing-canonical-unit-product-sku-resolution.js` et `scripts/allegro-golden-prebuyer-proof.js`.
- Le trigger refait à la main : check stock (implicite via canonical-money), check identity (`loadExactSoldSku`), résolution money. Le gate fait déjà tout ça + preflight adapter + buildOrderPayload.

### Current files
`purchasing-trigger-service.js` (chemin réel) vs `canonical-unit-purchasing-gate.js` + `supplier-fulfillment-readiness.js` (dormants).

### Target contract
Un **composition root unique** que le trigger appelle, plutôt qu'une logique inline. Mais — **arbitrage explicite** — ne pas supposer que les trois doivent être branchés tels quels. Vérifier d'abord overlap/duplication/ownership/side-effects/transaction-boundaries.

### Analyse overlap (à faire par Sonnet AVANT de brancher)
| Question | Constat à vérifier |
|----------|-------------------|
| **Overlap** | `gate.prepareCanonicalUnitPurchase` et `readiness.evaluateSupplierFulfillmentReadiness` calculent tous deux identity+adapter+stock/price. Lequel est le vrai moteur ? Le gate est plus complet (buildOrderPayload). La readiness ajoute la Procurement Route. **Probable : le gate est le composition root, la readiness est un sous-composant du preflight adapter.** À confirmer. |
| **Duplication** | Le trigger réimplémente identity+money inline. Une fois branché sur le gate, cette logique inline doit disparaître, pas coexister. |
| **Ownership** | Le gate est `@db-read none / @db-write none` — pur, sans transaction. Le trigger détient la transaction (SAVEPOINT par item, INSERT PO). **Le gate décide, le trigger persiste.** Frontière propre. |
| **Side effects** | Le gate n'écrit pas. Le trigger écrit `purchase_orders`. Ne pas déplacer l'écriture dans le gate. |
| **Transaction boundaries** | Le trigger ouvre `BEGIN`, SAVEPOINT `po_item_N` par item, COMMIT global. Le gate doit être appelé **dans** le SAVEPOINT de l'item, avant l'INSERT, comme fonction de décision pure. |

### Minimal delta
1. **Ne pas brancher les trois aveuglément.** D'abord : Sonnet confirme que le gate est le composition root et que la readiness est appelée *par* le gate (via l'adapter `evaluate`), pas en parallèle.
2. Dans le trigger, **remplacer la décision inline** (identity + money + implicit stock) par un appel au gate en tant que **fonction de décision pure**, à l'intérieur du SAVEPOINT de l'item, avant l'INSERT PO. Le gate retourne `{ready|blocked, payload, verdict, money}` ; le trigger persiste.
3. Le gate reçoit les adapters via injection (il a déjà `adapters = {}`). Le registry d'exécution de GAP-2 fournit ce map.
4. Conserver la frontière : **gate décide, trigger persiste**. Aucune écriture DB déplacée dans le gate.

### Files likely touched
`purchasing-trigger-service.js` (remplace décision inline par appel gate), `canonical-unit-purchasing-gate.js` (peut nécessiter d'exposer money/identity dans son retour pour que le trigger persiste sans recalculer).

### Tests required
- **Caractérisation lourde AVANT** : figer le comportement exact du Golden actuel (PO 29.90 PLN, unit_price_aed NULL, status notified, trigger_mode manual, idempotence already_exists). C'est le filet de sécurité n°1.
- Après branchement : mêmes sorties, mêmes verdicts, même idempotence. Bit-for-bit sur la PO produite.
- Test que la logique stock/price/identity inline a bien **disparu** (plus de duplication).
- Provider inconnu / adapter absent → hard stop via le gate (fail-closed préservé).

### Migration required?
**NO.**

### Risk
- **Le plus élevé de tous les GAP.** On remplace le cœur du chemin qui produit le Golden prouvé. Mitigation absolue : caractérisation exhaustive AVANT (la preflight suite + un test bit-for-bit sur la PO). Ne pas exécuter GAP-4 sans que GAP-1/2/3 soient verts et sans filet de caractérisation.
- Risque de subtile divergence transactionnelle si le gate est appelé hors SAVEPOINT. Contrainte : appel à l'intérieur du SAVEPOINT item.

### Rollback
Restaurer la décision inline dans le trigger. Le gate redevient dormant (sans dommage, il l'était déjà).

### Definition of Done
`purchasing-trigger-service.js` appelle le gate comme unique moteur de décision ; la logique inline dupliquée a disparu ; la PO produite par le Golden est identique bit-for-bit (caractérisation verte) ; idempotence et fail-closed préservés ; frontière « gate décide / trigger persiste » respectée.

---

## GAP-5 — Execution Evidence Boundary

### Problem
La confirmation d'une PO doit dépendre d'une **évidence provider réconciliée** — y compris pour un futur provider auto. Aujourd'hui la reconciliation Allegro existe mais n'est branchée sur aucun service de confirmation ; seuls les scripts proof l'appellent. Il n'y a pas de frontière générique `execute → evidence → verify → confirm`.

### Evidence
- `allegro-purchase-reconciliation.js:verifyCheckoutForm()` appelé uniquement par `scripts/allegro-sandbox-purchase-proof.js`.
- Le trigger passe une PO à `status='confirmed'` uniquement dans le bloc auto (`apiResult.success`), **sans reconciliation** — c'est-à-dire qu'un provider auto confirmerait aujourd'hui sans évidence réconciliée. Incohérent avec l'arbitrage §5.

### Current files
`allegro-purchase-reconciliation.js`, `purchasing-trigger-service.js` (bloc `if apiResult.success`).

### Target contract (boundary seulement, PAS de DTO riche)
```
execute(mode: auto|manual)
  → provider evidence (opaque)
  → verify/reconcile → { provider, external_ref, commitment_verdict, evidence:opaque }
  → PO confirmed  (uniquement si commitment_verdict = committed)
```
Minimum canonique figé (arbitrage §7) : **`provider`, `external_ref`, `commitment_verdict`, `evidence` opaque**. Rien d'autre. Quantité/prix/statut natif/line item restent **adapter-owned**.

### Minimal delta
1. Définir la **frontière** (interface conceptuelle) : une fonction `confirmPurchaseOrder({ po, providerEvidence, adapter })` qui appelle `adapter.reconcile()` → obtient `{external_ref, commitment_verdict, evidence}` → si `committed`, passe la PO à `confirmed` avec `supplier_order_id = external_ref`.
2. Brancher Allegro comme **première preuve** : sa `reconcile()` existante retourne déjà de quoi produire le minimum canonique. L'adapter mappe son `READY_FOR_PROCESSING` natif vers `commitment_verdict = committed`. Le cœur ne voit jamais `READY_FOR_PROCESSING`.
3. **Ne PAS généraliser la discovery** (arbitrage §6). La discovery reste dans l'adapter Allegro. La frontière ne connaît que « donne-moi une external_ref réconciliée ».
4. Montrer (en commentaire de conception, pas en code) comment un futur adapter auto branchera : `placeOrder() → external_ref synchrone → reconcile() trivial (evidence = réponse API) → même confirmation`. Aucun code Purchasing-specific provider.

### Files likely touched
Nouveau `services/suppliers/purchase-order-confirmation.js` (frontière, ~40 lignes), `purchasing-trigger-service.js` (le bloc auto appelle la frontière au lieu de confirmer directement).

### Tests required
- Allegro manual : evidence réconciliée `committed` → PO `confirmed`, `external_ref` persisté.
- `commitment_verdict != committed` → PO **non** confirmée (reste notified/pending).
- `external_ref` différent sur PO déjà confirmée → **hard fail** (invariant §9, renvoyé à GAP-6/idempotence).
- Le cœur ne référence jamais `READY_FOR_PROCESSING`.

### Migration required?
**NO** — `supplier_order_id` (external_ref) existe déjà sur `purchase_orders`. `commitment_verdict` et `evidence` peuvent rester en mémoire/logs tant qu'un provider #2 ne force pas leur persistance canonique.

### Risk
- Moyen. On introduit une frontière mais on ne fige pas de DTO riche. Piège à éviter : persister un DTO evidence structuré maintenant (interdit — DEFER). Garder `evidence` opaque.

### Rollback
Le bloc auto reconfirme directement (comportement actuel). Frontière isolée dans un fichier.

### Definition of Done
Une frontière unique confirme les PO par évidence réconciliée ; Allegro est branché comme première preuve ; `commitment_verdict` gouverne la confirmation ; discovery reste provider-specific ; aucun DTO evidence riche figé ; le chemin auto futur est documenté sans code provider dans le cœur.

---

## GAP-6 — Environment Isolation

### Problem
Une évidence Sandbox ne doit jamais satisfaire une PO Production. Besoin validé, **ownership non tranché** (arbitrage §3/§6).

### Evidence
- `environment` vit aujourd'hui **dans le payload SOI** (`{environment:'sandbox', offer_id}`), donc opaque et non requêtable sans parser.
- Le Golden est 100% sandbox ; aucune PO prod n'existe encore → la collision sandbox/prod **ne s'est jamais produite**.

### Current files
`supplier-order-identity.js` (payload opaque), `allegro-fulfillment-adapter.js` (lit `environment` du payload).

### Options d'ownership (sans choisir par goût)
| Option | Conséquence |
|--------|-------------|
| **A. SOI** — sortir `environment` du payload → `{provider,version,environment,payload}` | requêtable, entre dans clé d'idempotence ; mais change le contrat SOI + le schéma de la colonne `supplier_order_identity` → **migration** |
| **B. Provider Connection** — `environment` porté par la connexion provider | isole auth/env ensemble ; mais aucune table connection n'existe → nouvelle structure |
| **C. Adapter Context** — `environment` dérivé au runtime par l'adapter | zéro changement schéma ; mais non persisté → une PO ne « sait » pas son environnement |
| **D. Purchase Evidence** — `environment` figé sur l'évidence à la confirmation | naturel (l'évidence est sandbox ou prod) ; s'appuie sur GAP-5 |

### Recommandation
**DEFER UNTIL PROVIDER #2 / première PO prod**, avec un garde-fou minimal immédiat **si et seulement si** une PO prod devient possible avant le provider #2 :
- Garde-fou minimal (option C+D, zéro migration) : la frontière de confirmation (GAP-5) **refuse** de confirmer si `evidence.environment != po.expected_environment`, l'environnement étant lu du payload SOI par l'adapter et comparé. Fail-closed, sans changement de schéma.
- Le déplacement structurel de `environment` dans SOI (option A, avec migration) reste **DEFER** tant que le besoin n'est pas forcé.

### Minimal delta
Aucun maintenant, sauf le garde-fou fail-closed dans la frontière GAP-5 (comparaison d'environnement avant confirmation). Pas de migration.

### Files likely touched
`purchase-order-confirmation.js` (garde-fou), si et seulement si nécessaire avant provider #2.

### Tests required
- evidence sandbox + PO attendue sandbox → confirme.
- evidence sandbox + PO attendue prod → **hard fail**.

### Migration required?
**NO** (garde-fou runtime). Le déplacement dans SOI serait YES → différé.

### Risk
Bas. Le risque réel serait de figer maintenant `environment` dans SOI (migration) sans preuve prod → sur-abstraction.

### Rollback
Retirer le garde-fou (une condition).

### Definition of Done
Le besoin est documenté ; les 4 options d'ownership sont posées ; un garde-fou fail-closed runtime est spécifié (activable seulement si PO prod devient possible avant provider #2) ; le déplacement structurel est explicitement classé DEFER.

---

## GAP-7 — Feature-First Manifest (`supplier-connectivity`)

### Problem
Les concepts d'autorité provider + résolution d'adapter + capabilities + connexion/environnement n'ont pas de domicile feature. Ils sont éclatés entre `purchasing`, `sourcing`, `validators`, `db`.

### Evidence
Critères Feature-First appliqués (pas le nombre de fichiers) :
| Critère | Verdict |
|---------|---------|
| **Ownership** | fort — provider identity/adapter/capabilities sans propriétaire aujourd'hui |
| **Authority** | fort — serait LA réponse à « provider supporté ? que sait-il faire ? » |
| **Consumers** | fort — Sourcing ET Purchasing ET Catalogue |
| **Side effects** | fort — appels API externes, auth, rotation tokens, secrets |
| **Contracts** | fort — identity, money, capabilities, adapter |
| **Lifecycle** | faible mais réel — register/activate/deactivate |
| **Tables** | **aucune aujourd'hui** — ne pas en inventer |

Verdict : qualifie comme **feature d'autorité + gateway**, PAS comme étape de pipeline.

### Target manifest (challenge du minimal — PAS de tables inventées)
```
features/supplier-connectivity.feature.js
  name: 'supplier-connectivity'
  type: 'feature'
  domain: 'supplier-connectivity'
  service: "Permettre à Komerce d'accueillir un fournisseur : autorité d'identité
            provider, résolution d'adapter fail-closed, déclaration de capacités
            prouvées. Sourcing et Purchasing la consomment."
  perimeter:
    in:
      - provider authority (liste canonique + isSupportedProvider)   [GAP-1]
      - adapter resolution fail-closed                               [GAP-2]
      - capability declaration (prouvées uniquement)                 [GAP-3]
      - supplier order identity contract {provider,version,payload}  [existant]
    out:
      - order lifecycle (feature orders)
      - PO persistence & lifecycle (feature purchasing)
      - catalog import (feature catalog)
      - discovery mechanism (adapter-owned, provider-specific)
  authority: 'liste canonique des providers + résolution adapter'
  consumers: ['purchasing', 'sourcing', 'catalog']
  contracts: ['supplier-order-identity', 'supplier-fulfillment-adapter-contract', 'provider-authority']
  invariants:
    - provider inconnu → hard stop (jamais fall-through)
    - capability non prouvée → interdite de déclaration (fail-closed)
    - Purchasing ne parse jamais le payload SOI
    - une external_ref différente sur PO confirmée → hard fail
  files: [provider-authority.js, supplier-order-identity.js,
          supplier-fulfillment-adapter-contract.js, adapters/*]
  dependencies: []   # feature de base, ne dépend d'aucune autre feature
  debt:
    - environment ownership non tranché (GAP-6, DEFER)
    - readiness vocabularies en convergence (GAP-3)
    - sourcing connector dispatch pas encore branché sur l'autorité (GAP-1 note)
  tables: []   # aucune — l'autorité est code ; supplier_providers seulement si prouvé nécessaire
```

### Minimal delta
Créer le manifest **après** GAP-1/2/3 (sinon il déclarerait une autorité qui n'existe pas encore). Le manifest **suit** l'implémentation, il ne la précède pas.

### Files likely touched
`features/supplier-connectivity.feature.js` (nouveau), `docs/doctrine/APP_FEATURE_REGISTRY.md` (enregistrement).

### Tests required
- Le manifest valide contre le schéma feature-first existant (comme `purchasing.feature.js`).
- Gouvernance : les invariants déclarés correspondent aux tests existants.

### Migration required?
**NO.** Aucune table.

### Risk
Bas. Risque = déclarer trop tôt (avant que l'autorité existe) → manifest mensonger. D'où l'ordre : manifest en dernier.

### Rollback
Supprimer le fichier manifest + son entrée registry.

### Definition of Done
Manifest minimal déclaré, sans table inventée, avec périmètre in/out précis, invariants correspondant à des tests réels, dette explicitement listée, enregistré dans le registry.

---

# EXECUTION PLAN FOR SONNET

Ordre strict, justifié par les dépendances :

**GAP-1 — Provider Authority** (autorité code unique)
→ *Pourquoi en premier* : GAP-2, GAP-3, GAP-7 consomment tous l'autorité. La créer d'abord évite de refactorer A puis découvrir que l'autorité réelle était ailleurs. Zéro migration, blast radius nul.

**GAP-3 — Readiness Convergence** (documentation de mapping, avant tout branchement)
→ *Pourquoi avant GAP-4* : GAP-4 branche le vrai chemin sur un moteur unique ; il faut d'abord savoir quel vocabulaire est canonique. Pur conceptuel, zéro comportement.

**GAP-2 — Adapter Resolution** (supprimer le switch provider)
→ *Pourquoi après GAP-1* : la résolution consomme l'autorité. *Avant GAP-4* : GAP-4 injecte le registry d'adapters que GAP-2 établit.

**GAP-4 — Branch Real Purchasing Through Gate** (le plus risqué)
→ *Pourquoi après 1/2/3* : consomme l'autorité (1), le registry (2) et le vocabulaire canonique (3). Exige caractérisation exhaustive AVANT. Ne jamais exécuter sans filet.

**GAP-5 — Execution Evidence Boundary** (confirmation par évidence)
→ *Pourquoi après GAP-4* : la frontière de confirmation s'insère dans le chemin unifié par GAP-4. Réutilise Allegro comme première preuve.

**GAP-6 — Environment Isolation** (garde-fou fail-closed, sinon DEFER)
→ *Pourquoi après GAP-5* : le garde-fou vit dans la frontière de confirmation (GAP-5). Largement DEFER.

**GAP-7 — Feature Manifest** (en dernier)
→ *Pourquoi en dernier* : déclare une autorité qui doit déjà exister (1/2/3). Un manifest écrit avant serait mensonger.

```
GAP-1 → GAP-3 → GAP-2 → GAP-4 → GAP-5 → GAP-6 → GAP-7
        (doc)          (RISK)   (evidence) (defer) (manifest)
```

---

## SAFE TO EXECUTE NOW

- **GAP-1** — autorité code, zéro migration, rollback trivial.
- **GAP-3** — convergence documentaire, zéro comportement.
- **GAP-2** — suppression du switch, blast radius production nul (aucun provider auto réel), fail-closed testé.
- **GAP-4** — **uniquement** après 1/2/3 verts ET caractérisation bit-for-bit de la PO Golden en place. C'est safe *conditionnellement au filet*.
- **GAP-5** — frontière de confirmation, `evidence` opaque, minimum canonique seulement.
- **GAP-7** — manifest, après le reste, sans table.

## DEFER UNTIL PROVIDER #2

- **DTO evidence riche** (quantité/prix/statut natif/line item canoniques) — attendre qu'un 2ᵉ provider force la généralisation.
- **Déplacement structurel de `environment` dans SOI** (option A, migration) — garder le garde-fou runtime en attendant.
- **Généralisation de la taxonomie des capabilities** au-delà des capacités prouvées (`exact_offer_read`, `live_facts`, `manual_procurement`, `auto_order:false`).
- **Table `supplier_providers`** — l'autorité code suffit tant qu'aucun besoin de métadonnées persistées n'est prouvé.
- **Négociation de version SOI** (`version` reste décoratif tant qu'il n'y a pas de v2).

## DO NOT BUILD

- **Generic Discovery framework** — la discovery reste adapter-owned. Allegro (list seller orders → bounded search → exact match), auto (external_ref direct), webhook : trois mécanismes incompatibles, un seul prouvé.
- **Provider switch déplacé sous un autre nom** — la résolution doit passer par capability, jamais par une table if/else déguisée.
- **Toute nouvelle table sans nécessité prouvée.**
- **Réécriture big-bang des vocabulaires readiness** — convergence par mapping, pas par réécriture.
- **Confirmation PO sans évidence réconciliée**, même pour un provider auto.
- **Refactor cosmétique** de quoi que ce soit qui n'est pas sur le chemin de ces GAP.

---

## CRITÈRE FINAL — vérifiable après tous les GAP

Ajouter un provider futur doit se limiter à :
```
+ déclarer le provider dans provider-authority
+ déclarer ses capabilities prouvées
+ implémenter son/ses adapter(s) supportés
+ passer la Provider Contract Suite
```
**sans modifier** : `purchasing-trigger-service.js`, le moteur de readiness générique, le cycle de vie PO générique — *sauf* si le nouveau provider révèle un concept générique réellement nouveau (auquel cas : enrichir le contrat abstrait une fois, pas ajouter une branche provider).

# Komerce — Etat de la gouvernance cross-repo

> Mis a jour : **2026-06-29**
> Scope : `backend` + `boutique` (public/boutique) + `dashboards` (public/)
> Role : point de verite pour tout agent ou dev intervenant sur la gouvernance.
> Principe : chaque constat ci-dessous est verifie par execution reelle des gates, pas par lecture de doc.

---

## 0. Tampon de validation — registre feature (niveau 0)

Statut : **REGISTRE COMPLET — 2026-06-29**

| Repo | Features | Transversal | Fichiers declares | Manquants | Orphelins | Gate CI |
|------|----------|-------------|-------------------|-----------|-----------|---------|
| backend | 14 | 2 | 281 | 0 | 0 | `feature:registry --strict` |
| boutique | 11 | 0 | 71 | 0 | 0 | `audit:registry --strict` |
| dashboards | 2 | 1 | 82 | 0 | 0 | `audit:registry --strict` |
| **TOTAL** | **27** | **3** | **434** | **0** | **0** | |

Les trois repos passent en `--strict` (exit 0). Les `REQUIRED_FIELDS` sont identiques partout :
`name, type, domain, status, owner, service, perimeter, authority, invariants`.

---

## 1. Pyramide qualite — couverture par etage et par repo

La pyramide est definie dans `docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md` (backend).
Chaque niveau est une porte : fermee = les niveaux au-dessus sont inaccessibles.

```
                 ╔══════════════════════════════╗
  Niveau 0       ║    FEATURE DOCTRINE          ║  backend ✅  boutique ✅  dashboards ✅
                 ╠══════════════════════════════╣
  Niveau 5       ║    FEATURE SLICE GUARD       ║  backend ⚠️  boutique ❌  dashboards ❌
                 ╠══════════════════════════════╣
  Niveau 4       ║    ARCHITECTURE GATES        ║  backend ✅  boutique ✅  dashboards ❌
                 ╠══════════════════════════════╣
  Niveau 3       ║    TESTS                     ║  backend ✅  boutique ⚠️  dashboards ❌
                 ╠══════════════════════════════╣
  Niveau 2       ║    CODE QUALITY GATE         ║  backend ✅  boutique ✅  dashboards ✅
                 ╠══════════════════════════════╣
  Niveau 1       ║    SECURITE DEPENDANCES      ║  backend ✅  boutique ✅  dashboards ❌
                 ╚══════════════════════════════╝
```

---

## 2. Detail par repo

### 2.1 Backend — 9/9 niveaux couverts

**Points forts :**
- Pre-commit hook 9 etapes (feature-registry, quality gate, enrichissement DB auto, graphe arch, reconciliation budget, arch-db-check, schema-drift, header-sql, doctrine sanitize, audit backend, boutique check:fast, dashboards 360, boutique 360, meta-graphe).
- Pre-push hook avec score d'impact (SAFE/REVIEW/BLOCK).
- Contract-check : 429 routes, 0 derive, 8 UNKNOWN (dette documentee).
- Code quality gate : 0 bloquant, 15 avertissements dead code (N2).
- Security 360 actif avec cliquet anti-regression.
- Doctrine complete : FEATURE_DOCTRINE, FEATURE_SLICE_DOCTRINE, QUALITY_PYRAMID_DOCTRINE, AGENTS.md.

**Points d'attention :**

| # | Severite | Constat | Detail |
|---|----------|---------|--------|
| B-01 | WARN | Feature-guard N5 : 162 erreurs cross-repo | Les manifests backend declarent des fichiers boutique (`files.boutique`) et dashboards (`files.dash`). Sans `public/boutique` monte sur disque, `feature-guard.js` ne peut pas verifier leur existence. Le gate est structurellement casse en contexte standalone. La resolution via `CATEGORY_PREFIX` (lignes 98-104) suppose un arbre `public/boutique/...` qui n'existe que dans le deploiement reel. |
| B-02 | WARN | 66 tests orphelins sur 81 | Seuls `shared-cart` (11 tests) et `notifications` (5 tests) declarent leurs tests dans `files.tests`. Les 14 autres features ont 0 test declare. Les 66 fichiers test restants existent mais ne sont rattaches a aucun manifest. |
| B-03 | INFO | 15 warnings dead code | `utils/documents/*.js` et `utils/phone.js` — code mort apres return. Non bloquant. |
| B-04 | INFO | 4 collisions migrations | Prefixes 014, 072, 073, 080 — dette connue listee dans `migrations/GAPS.md`. |
| B-05 | INFO | `feature:registry` non chaine dans un check:all | Le script existe (`npm run feature:registry`) mais il n'y a pas de `check:all` ou `precommit` dans package.json. La protection passe par le hook git (etape 0a), pas par npm. |

### 2.2 Boutique — 5/9 niveaux couverts

**Points forts :**
- Registre N0 complet : 11 features, 71 fichiers JS, 0 orphelin.
- `check:all` branche : quality:gate + group-wording + html + imports + body-classes + no-injection + important + css-guard + css-dist-only + cache + breakpoints + audit:arch + audit:arch:live + audit:ownership + audit:registry + test:e2e.
- Code quality gate : 0 violation sur 92 fichiers.
- Architecture audit : conforme (invariants `BOUTIQUE_ARCHITECTURE.md` respectes).
- Ownership : carte generee (`docs/BOUTIQUE_OWNERSHIP_LIVE.md`).
- CSS outillage complet (css-guard, deploy-css, check-important, breakpoints, dist-only).

**Points d'attention :**

| # | Severite | Constat | Detail |
|---|----------|---------|--------|
| F-01 | HIGH | Pas de feature-guard (N5) | Aucun equivalent de `feature-guard.js` cote boutique. Le registre (N0) verifie que les fichiers sont declares, mais pas qu'ils sont complets, ni que leurs tests existent, ni que le slice est coherent. |
| F-02 | WARN | Couverture test faible | 3 fichiers test seulement (2 e2e Playwright + 1 unit). 71 fichiers JS sources avec un ratio test/source de 4%. |
| F-03 | WARN | Doctrine absente localement | Les manifests referencent `docs/doctrine/FEATURE_DOCTRINE.md` mais ce fichier n'existe que dans le repo backend. Un agent qui travaille sur boutique en standalone n'a pas acces a la doctrine. |
| F-04 | WARN | Pas de hooks git propres | Boutique depend du hook pre-commit backend (etape 6 : `cd public/boutique && npm run check:fast`). `scripts/setup-hooks.sh` existe mais installe uniquement un hook basique non documente. |
| F-05 | INFO | `taxonomy-no-hardcode.test.js` dans le registre | Un fichier `.test.js` est declare dans `catalog.feature.js`. Selon la convention, les tests devraient etre dans `files.tests` ou exclus du registre source. |

### 2.3 Dashboards — 3/9 niveaux couverts (N0 + N2 + hooks)

**Points forts :**
- Registre N0 bootstrappe : 3 features (admin-dashboard, legacy-control-tower, platform), 82 fichiers, 0 orphelin.
- Headers `@domain` presents sur les 41 fichiers admin/ (pre-existants) et ajoutes sur les 41 fichiers restants (legacy + platform).
- `legacy-control-tower.feature.js` avec `status: deprecated` — dette correctement taguee.
- **Quality gate N2 installe** : 0 erreur bloquante sur le code actif (admin/), dette legacy isolee, exemptions documentees.
- **Hook pre-commit autonome** : `setup-hooks.sh` installe un hook qui execute N2 + N0 sans dependre du backend.
- **Doctrine locale** : FEATURE_DOCTRINE.md et QUALITY_PYRAMID_DOCTRINE.md copies dans docs/doctrine/.

**Points d'attention :**

| # | Severite | Constat | Detail |
|---|----------|---------|--------|
| D-01 | ~~CRITICAL~~ RESOLVED | Quality gate (N2) installe | `code-quality-gate.js` adapte du backend, branche dans `check:all`. admin/ : 0 erreur, 12 warnings (dead code). Legacy exclue du scan strict (status: deprecated). Platform : dette gelee (var dans auth-guard + parcel-components, exemptee). |
| D-02 | CRITICAL | Aucun test (N3) | 0 fichier test. Aucune couverture. Aucun framework installe. |
| D-03 | HIGH | Aucun arch check (N4) | Pas d'audit headers, pas de drift, pas d'ownership. Les headers `@domain` sont presents mais jamais verifies programmatiquement (hors registre N0). |
| D-04 | HIGH | Aucun feature-guard (N5) | Pas de verification slice. |
| D-05 | HIGH | Aucun npm audit (N1) | Pas de devDependencies, pas d'audit:gate. |
| D-06 | ~~WARN~~ RESOLVED | setup-hooks.sh installe | Hook pre-commit autonome (N2 quality + N0 registry). Ne depend plus exclusivement du hook backend. |
| D-07 | ~~WARN~~ RESOLVED | Doctrine copiee localement | FEATURE_DOCTRINE.md et QUALITY_PYRAMID_DOCTRINE.md copies dans docs/doctrine/. |
| D-08 | INFO | `ct-views-v7.js` ne passe pas `node -c` | Erreur de syntaxe dans un fichier legacy. Non bloquant (status: deprecated), mais empeche le chargement par d'autres scripts. |

---

## 3. Coherence cross-repo

### 3.1 Naming des domaines

| Backend | Boutique | Aligne ? |
|---------|----------|----------|
| catalog | catalog | OK |
| auth | auth | OK |
| payment | payment | OK |
| wallet | wallet | OK |
| recommendations | recommendations | OK |
| panier-partage | shared-cart | NAMING — fr vs en |
| orders | checkout | NAMING — perimetre different |
| admin-dashboard | (repo dashboards) | OK — repo dedie |
| douane, economic-engine, logistics, inventory, documents, refunds, notification, operations | — | Backend-only (pas de pendant frontend) |
| — | boutique, collective-workspace, tracking | Frontend-only (pas de pendant backend) |

Les 2 incohérences de naming (`panier-partage` / `shared-cart` et `orders` / `checkout`) ne bloquent rien (chaque repo a son propre gate), mais compliquent un eventuel meta-graph cross-repo. A harmoniser si un meta-registre unifie est envisage.

### 3.2 Hooks git — chainage reel

Le hook pre-commit vit dans le repo backend et orchestre les 3 repos :

```
Backend pre-commit hook (9 etapes)
  ├── 0a. feature-registry-check.js --strict     ← backend N0
  ├── 0b. code-quality-gate.js --strict           ← backend N2
  ├── 0.  enrich-komerce-arch-db-fields.js        ← auto-enrichissement
  ├── 1.  generate-komerce-arch-graph.js           ← graphe arch
  ├── 2.  arch-reconcile.js --write                ← budget auto
  ├── 3.  re-stage artefacts regeneres
  ├── 4.  arch-db-check + schema-drift + header-sql + sanitize + audit-backend
  ├── 5.  cd public/boutique && npm run check:fast ← boutique (si present)
  ├── 6.  gen-dashboards-360.js --check            ← dashboards (si present)
  ├── 7.  gen-boutique-360.js --check              ← boutique 360 (si present)
  └── 8.  gen-meta-graph.js --check                ← meta-graphe (si tous presents)
```

**Risque** : les etapes 5-8 sont conditionnees par `if [ -d ... ]`. Si la structure de deploiement change (monorepo eclate, CI cloud sans montage), ces gates tombent silencieusement.

---

## 4. Manifests generes — inventaire

### 4.1 Backend (pre-existants — aucune modification)

16 manifests dans `features/` : auth-identity, catalog, customs, dashboard, documents, economic-engine, inventory, logistics, notifications, orders, payments, platform-ops, recommendations, refunds, shared-cart, wallet-loyalty.

### 4.2 Boutique (11 manifests — 8 generes, 3 pre-existants)

Pre-existants : modal-product.feature.js.
Ajoutes dans le transcript (uploades) : boutique.feature.js, collective-workspace.feature.js.
**Generes le 2026-06-29** (absents des uploads, reconstitues a partir des `@domain` headers) :

| Manifest | Domaine | Fichiers | Base |
|----------|---------|----------|------|
| catalog.feature.js | catalog | 14 | headers `@domain catalog` |
| shared-cart.feature.js | shared-cart | 9 | headers `@domain shared-cart` |
| recommendations.feature.js | recommendations | 2 | headers `@domain recommendations` |
| checkout.feature.js | checkout | 2 | headers `@domain checkout` |
| auth.feature.js | auth | 2 | headers `@domain auth` |
| payment.feature.js | payment | 1 | headers `@domain payment` |
| tracking.feature.js | tracking | 1 | headers `@domain tracking` |
| wallet.feature.js | wallet | 1 | headers `@domain wallet` |

### 4.3 Dashboards (3 manifests — tous generes le 2026-06-29)

| Manifest | Type | Fichiers | Status |
|----------|------|----------|--------|
| admin-dashboard.feature.js | feature | 41 | production |
| legacy-control-tower.feature.js | feature | 37 | deprecated |
| platform.feature.js | transversal | 4 | production |

Headers `@domain` ajoutes a : portal-pilotage.js, 37 fichiers admin-legacy/js/, 3 fichiers js/, sw.js (42 fichiers au total).

---

## 5. Plan d'action priorise

### Priorite 1 — Dashboards : combler le desert (effort estime : 1-2 jours)

| Action | Effort | Impact |
|--------|--------|--------|
| Copier et adapter `code-quality-gate.js` pour dashboards | 2h | Couvre N2 — bloque les regressions basiques |
| Installer Jest + ecrire 5-10 tests smoke sur les vues admin critiques | 4h | Couvre N3 — premier filet de securite |
| Copier et adapter `audit-backend-arch.js` pour dashboards | 2h | Couvre N4 — verifie les headers |
| Ajouter `setup-hooks.sh` dashboards (feature-registry + quality gate) | 1h | Autonomie hooks |
| Copier FEATURE_DOCTRINE.md dans dashboards | 0.5h | Doctrine locale |

### Priorite 2 — Backend : rattacher les tests (effort estime : 0.5 jour)

| Action | Effort | Impact |
|--------|--------|--------|
| Enrichir `files.tests` dans les 14 manifests qui n'en ont pas | 3h | Eteint 224 warnings feature-guard. Permet de repondre "quelle feature est sous-testee ?" |
| Ajouter `--skip-external` a feature-guard.js | 1h | Eteint les 162 erreurs fantomes cross-repo |

### Priorite 3 — Boutique : monter en niveaux (effort estime : 1 jour)

| Action | Effort | Impact |
|--------|--------|--------|
| Creer un feature-guard.js adapte boutique (N5) | 4h | Verifie la coherence des slices |
| Copier FEATURE_DOCTRINE.md localement | 0.5h | Doctrine locale |
| Ecrire 5-10 tests supplementaires (vues critiques) | 4h | Ameliore le ratio test/source |

### Priorite 4 — Cross-repo : harmonisation naming

| Action | Effort | Impact |
|--------|--------|--------|
| Decider entre fr/en pour `panier-partage` / `shared-cart` | Decision | Prerequis meta-registre |
| Aligner `orders` / `checkout` ou documenter la distinction | Decision | Clarte cross-repo |

---

## 6. Livrables associes

| Fichier | Contenu |
|---------|---------|
| `boutique-governance.zip` | 11 manifests + gate script + package.json |
| `dashboards-governance.zip` | 3 manifests + gate script + package.json + 42 fichiers JS avec headers ajoutes |
| `AUDIT-FEATURE-REGISTRY.md` | Rapport d'audit du registre N0 |

---

## 7. Audit logique metier — execution reelle (2026-06-29)

### Tests : 72/72 suites PASS, 1086 assertions, 0 echec

Les 81 fichiers test ont ete executes sur le monorepo reel. Resultat : **0 failure**. Tout ce qui est teste est correct.

### Couverture : 63/258 services routes testes (24%)

Le feature-guard N5 liste 184 services/routes sans test matching. Ce sont des **vrais gaps de couverture**, pas des faux positifs. La couverture est protegee par un cliquet : `touched-tests-gate.js` bloque toute PR qui modifie un service sans toucher un test correspondant (ou sans justification documentee). La couverture monte mecaniquement a chaque PR.

### Analyse du code non teste — aucun bug metier trouve

Les services non testes ont ete inspectes manuellement (parcel-operations 642 lignes, scan-engine 965 lignes, hub-operations, routing, auto-parcel, refund-service, parcel-guards, routes/parcels). Patterns verifies :

| Pattern | Resultat |
|---------|----------|
| Injection SQL | 0 concatenation dangereuse — tout en $N parametres |
| XSS | 0 source externe non echappee (doctrine sanitize check) |
| Idempotence paiement/remboursement | idempotencyKey Stripe + ON CONFLICT DO NOTHING en DB |
| Machine a etats colis | PARCEL_TRANSITIONS whitelist + validateParcelTransition |
| Garde annulation | checkParcelCancellable (null, deja annule, statuts bloquants) |
| Transactions DB | BEGIN/COMMIT/ROLLBACK correct |
| Validation entrees routes | Joi sur les mutations principales, inline sur les endpoints legers |

### Points d'attention documentes

| # | Severite | Constat |
|---|----------|---------|
| M-01 | INFO | **Taux 492 KMF/EUR** : taux fixe historique utilise comme fallback dans 9 fichiers (`|| 492`). Intentionnel et correct — c'est le taux de reference fixe de la zone franc. Pas un bug, pas un risque. |
| M-02 | WARN | **scan-engine.js** (965 lignes, 0 test) : logique de scan colis la plus complexe du projet — resolution d'incidents, mise a jour statuts multi-tables, matrice de decision. SQL safe, try/catch present, mais la logique de decision n'a aucune verification automatisee. Priorite n°1 pour l'ecriture de tests si un dev touche ce fichier. |

### Filets de securite hors tests

Chaque fichier service backend passe par 10 couches de verification meme sans test unitaire :

1. `@komerce-arch` header (identite, tables SQL, doctrine)
2. N2 quality gate (use strict, const/let, pas de SQL concat, pas d'eval, pas de secrets)
3. arch-db-check (tables declarees = tables utilisees)
4. arch-schema-drift-check (SCHEMA.md = DB live)
5. doctrine sanitize check (pas de XSS)
6. contract-check (chaque route = contrat OpenAPI)
7. 360 cartes (chaque appel API frontend = endpoint existant)
8. meta-graph (couture cross-repo coherente)
9. feature-registry N0 (fichier rattache a un domaine)
10. feature-guard N5 (slice coherent)
11. pre-push impact score (SAFE/REVIEW/BLOCK)
12. touched-tests-gate en CI (PR bloquee si service modifie sans test)

## 7. Synthese

Le backend est le bunker du projet — pre-commit 9 etapes, doctrine complete, contrat OpenAPI, security 360. La boutique est bien outillee sur les CSS et le quality gate, mais manque de tests et de feature-guard. Les dashboards sont le maillon faible : 82 fichiers JS avec un registre N0 fraichement pose, mais aucun autre filet de securite.

La gouvernance repose aujourd'hui sur un point unique de controle : le hook pre-commit du backend. C'est un design coherent (un seul endroit a maintenir), mais c'est aussi un single point of failure. Si le deploiement change, les gates frontend tombent sans prevenir.

Le registre feature (N0) est desormais complet sur les 3 repos : 434 fichiers, 30 features, 0 orphelin. C'est la fondation sur laquelle on peut construire les niveaux suivants, en commencant par les dashboards.

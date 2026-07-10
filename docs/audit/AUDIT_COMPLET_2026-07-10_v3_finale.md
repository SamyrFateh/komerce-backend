# AUDIT COMPLET — komerce-backend (v3 finale)
**Date : 10/07/2026 — `origin/main` @ `130fdbe`**

---

## 1. BOOT GUARDS : GARDER OU RETIRER ?

### Verdict : garder le framework, retirer les flags d'urgence

Le framework `boot-guard.js` (withTimeout + runSequential + logging par étape) est **une amélioration permanente** — il rend tout blocage de boot diagnosticable en logs, ce qui était impossible avant (fire-and-forget parallèle sans logging). Il doit rester.

Les **flags d'urgence**, en revanche, doivent être retirés dès que la prod est stabilisée :

| Flag | Rôle | Verdict |
|------|------|---------|
| `KOMERCE_SKIP_BOOT_ENSURE=true` | Skip `ensureRoutingColumns` + `ensureSecurityTables` | **Retirer** une fois la purge DB faite. Ces ALTER TABLE sont idempotents (IF NOT EXISTS / IF NOT EXISTS) et prennent ~20ms quand la DB n'est pas verrouillée. Les garder skippés masquerait un schéma incomplet si Railway reprovisionne un jour la DB. |
| `KOMERCE_SKIP_STARTUP_MIGRATIONS=true` | Skip `runStartupMigrations` (rename colonne, ajout enum, CREATE TABLE invoices…) | **Retirer** aussi. Même logique : idempotent quand tout est déjà appliqué, mais nécessaire si la DB est recréée. |
| `KOMERCE_DISABLE_CRONS` | N'existe pas dans le code actuel (les crons sont toujours schedulés) | **Non implémenté** — si tu veux le garder comme levier d'isolation, il faudrait l'implémenter dans `bootstrap/crons.js`. Pas urgent. |

### Plan de retrait

1. **Purger les sessions fantômes** (SQL pg_terminate_backend — toujours en attente)
2. **Restart Railway** → les `ensureRoutingColumns` / `ensureSecurityTables` doivent passer en ~50ms
3. **Vérifier les logs** : chercher `[boot-guard] "ensureRoutingColumns" OK duration_ms: XX` avec XX < 500
4. Si OK → **supprimer les deux variables** de l'onglet Variables Railway
5. Si timeout de nouveau → le verrou revient, il faut chercher qui le recrée (deuxième instance ? cron ?)

### Amélioration long terme (non urgent)

`ensureRoutingColumns` et `ensureSecurityTables` font du DDL (ALTER TABLE, CREATE TABLE) qui prend des locks ACCESS EXCLUSIVE. Ce DDL ne devrait tourner qu'**une seule fois**, pas à chaque boot. La vraie solution est de migrer ces `ensure*` vers des fichiers `migrations/` numérotés (idempotents avec IF NOT EXISTS) et de supprimer les appels dans `server-lifecycle.js`. Mais c'est un refacto, pas une urgence — tant que le pool n'est pas verrouillé, ça prend 20ms.

---

## 2. COUVERTURE DE TESTS — ÉTAT COMPLET

### Vue d'ensemble

| Codebase | Suites | Tests | Stmts | Branch | Funcs | Lines |
|----------|--------|-------|-------|--------|-------|-------|
| **Backend** | 332 | 5817 | **95.6%** | **86.7%** | **94.9%** | **96.4%** |
| **Boutique** | 64 | 1697 | **46.4%** | **35.0%** | **38.2%** | **67.0%** |
| **Dashboards** | 38 | 972 | **83.3%** | **69.8%** | **79.8%** | **84.7%** |

Le backend est exemplaire. Les dashboards sont honorables. La boutique est le point faible — c'est normal : c'est du vanilla JS/DOM sans framework, plus difficile à tester unitairement, et les modules les moins couverts sont ceux qui font du rendu DOM pur (modale, panier, suggestions).

### Backend (95.6% stmts) — excellent

Quasiment tout est au-dessus de 90%. Les seuls fichiers sous 80% :

| Fichier | Stmts | Raison |
|---------|-------|--------|
| `utils/alerts-compat.js` | 87.6% | Branches d'erreur du monkey-patch retiré — couverture suffisante |
| `dashboard-metrics/workspaces.js` | 86.1% | Branches conditionnelles de métriques agrégées |
| `services/documents/refund-receipt.js` | 96.8% | 1 branche d'erreur rare (59% branch) |
| `state-advancer.js` | 97.5% (mais 53.8% funcs) | 7 fonctions du simulateur non appelées directement (wrappers) |
| `normalized-product.js` | 90.2% | Branches de normalisation edge-case |

**Aucun de ces fichiers n'est à risque.** Les chemins non couverts sont des branches d'erreur/edge-case, pas de la logique métier critique.

### Boutique (46.4% stmts) — la zone à renforcer

Les fichiers critiques (checkout, wallet, tracking, group) sont bien couverts grâce aux tests ajoutés lors de l'incident. Les trous sont sur les modules de **rendu pur** :

**Bien couverts (>80% stmts) :**
- `b-checkout.js` — 87% (state machine relais, submitOrder)
- `b-wallet.js` — 93% (erreur+retry, gate auth)
- `b-tracking.js` — 85% (erreur+retry, mode recherche)
- `komerce-api.js` — 95% (timeout central, queue)
- `b-identity.js` — 92%
- `b-cart-core.js` — 95%
- `b-checkout-render.js` — 89%
- `group/group-api.js` — 91%

**Moyennement couverts (50-80%) :**
- `b-group-view.js` — 54% (rendu DOM créateur complexe, polling)
- `b-modal-product.js` — 67% (galerie, stepper, suggestions)
- `b-modal-core.js` — 39% (navigation modale, historique, scroll)
- `b-utils.js` — 41% (helpers DOM, sanitize, formatage)
- `b-store.js` — 50% (state global, restore)
- `b-pager.js` — 50% (pagination)

**Peu couverts (<50%) :**
- `b-cart.js` — 38% (rendu du panier + drawer complet)
- `b-share-cart.js` — 35% (rendu partage panier)
- `b-subcat.js` — 41% (sous-catégories, filtres)
- `product-store.js` — 33% (cache produits, normalisation)
- `shop-schema.js` — 36% (schéma structuré)
- `b-catalog-desktop-enhancers.js` — 29% (améliorations desktop)
- `b-group-banner.js` — 26% (bannière groupe)

**Non couverts (0%) :**
- `b-scroll-owner.js`, `b-paypal.js`, `b-home-premium-v1.js` (partiellement) — modules de rendu/intégration sans tests dédiés

### Dashboards (83.3% stmts) — correct

**Points faibles :**
- `app.js` — 2.6% : le point d'entrée SPA (router, event delegation). Normal de ne pas le tester unitairement (c'est du wiring), mais les vues individuelles sont testées.
- `api-client.js` — 34% : beaucoup de méthodes d'appel API. Les méthodes vivantes sont testées via les tests de vues, mais les wrappers simples (GET/POST) ne sont pas testés individuellement.
- `components/UI.js` — 29% : composants UI génériques (modal, toast, dropdown). Même logique que la boutique — rendu DOM pur.
- `components/KpiCard.js` — 40% : composant de carte KPI.

---

## 3. PRIORITÉS DE RENFORCEMENT COVERAGE

### Priorité 1 — Impact métier + risque de régression (à faire au prochain sprint)

| Module | Coverage actuel | Risque | Action |
|--------|----------------|--------|--------|
| `b-cart.js` | 38% stmts | **Élevé** — rendu panier = chemin critique | Ajouter tests : ajout/suppression, quantités, drawer ouvert/fermé |
| `b-modal-core.js` | 39% stmts | **Élevé** — ouverture produit = 1er geste utilisateur | Tester openModal, closeModal, navigation historique |
| `product-store.js` | 33% stmts | **Moyen** — cache offline + normalisation | Tester cache hit/miss, normalisation edge-cases |
| `b-utils.js` | 41% stmts | **Moyen** — helpers partagés | Tester fmt, sanitize, optimizeImgUrl |

### Priorité 2 — Dette informative (à éponger progressivement)

| Module | Coverage | Action |
|--------|----------|--------|
| `b-share-cart.js` | 35% | Tester le rendu partage + restauration |
| `b-subcat.js` | 41% | Tester filtres sous-catégories |
| `b-group-view.js` | 54% | Renforcer le flux créateur (rendu cartes, polling) |
| `b-modal-product.js` | 67% | Tester galerie, stepper, lot hybride |
| `shop-schema.js` | 36% | Tester la génération de schéma structuré |
| Dashboards `api-client.js` | 34% | Tester les wrappers API non couverts |
| Dashboards `app.js` | 3% | Test d'intégration SPA ou accepter comme wiring |

### Priorité 3 — Cosmétique (pas de risque)

`b-catalog-desktop-enhancers.js` (29%), `b-group-banner.js` (26%), `b-home-premium-v1.js` (63%), `b-desktop-upgrade.js` (66%) — modules de rendu sans logique métier. À couvrir si/quand on les modifie.

---

## 4. RÉCAP GLOBAL — TOUT CE QUI RESTE

### Opérationnel (immédiat)
- [ ] Purger sessions DB fantômes + restart Railway
- [ ] Vérifier que `ensureRoutingColumns`/`ensureSecurityTables` passent en <500ms
- [ ] Retirer les flags `KOMERCE_SKIP_BOOT_ENSURE` et `KOMERCE_SKIP_STARTUP_MIGRATIONS`
- [ ] Fix cosmétique « les relaisRéessayer » (espace manquant)

### Décisions produit (quand prêt)
- [ ] D-09 : passer `inventory` + `recommendations` en `production`
- [ ] D-10 : confirmer migration 100 appliquée en prod Railway

### Coverage (prochain sprint)
- [ ] Tests `b-cart.js` : +40 points visés (38% → 75%)
- [ ] Tests `b-modal-core.js` : +30 points visés (39% → 70%)
- [ ] Tests `product-store.js` : +30 points visés (33% → 65%)
- [ ] Tests `b-utils.js` : +25 points visés (41% → 65%)

### Hygiène progressive (au fil des tickets)
- [ ] D-11 : éponger les 59 contrats dashboards non prouvés
- [ ] Découper `shared-cart.js` (990 lignes) à la prochaine extension
- [ ] Découper `radar-queries.js` (858 lignes) à la prochaine extension
- [ ] Migrer `ensureRoutingColumns`/`ensureSecurityTables` en migrations one-shot

### Ce qui est FAIT et ne nécessite plus d'attention
- D-01 à D-04, D-06 à D-08, D-12 à D-14, D-16 — ✅ résolu dans le code
- D-05, D-15 — 🟡 documenté/normal
- Boot-guard framework (withTimeout, runSequential, logging) — ✅ en place
- Frontend résilience (timeout central, state machine relais, erreur+Réessayer) — ✅ déployé + testé
- db.js protections (query_timeout, keepAlive, idle_in_transaction) — ✅ en place
- REX incident PR563 — ✅ documenté
- Backend coverage 95.6% — ✅ excellent
- Dashboards coverage 83.3% — ✅ correct

# Session de revue de code — Statut

> **Dernière mise à jour :** 5 avril 2026

## Objectif global

Restructurer la documentation du projet Komerce-backend :
1. ✅ **Étape 1** — Analyser la doc existante (8 fichiers, 86 KB) et identifier les problèmes
2. 🔄 **Étape 2** — Revue de code complète pour établir la "vérité terrain"
3. ⏳ **Étape 3** — Produire la cartographie d'impact 360°
4. ⏳ **Étape 4** — Rédiger les 5 nouveaux documents (README, ARCHITECTURE, CARTOGRAPHY, STATUS, DEPLOYMENT)

---

## 🚨 Actions prioritaires (avant de continuer la revue)

### Si le projet est EN PRODUCTION — Hotfix immédiat recommandé

| # | Faille | Fichier | Sévérité |
|---|--------|---------|----------|
| 1 | **SQL injection** — interpolation de strings dans les requêtes | `routes/products.js`, `routes/orders.js` | 🔴 CRITIQUE |
| 2 | **XSS** — `client_name`/`relais_name` non-échappés dans template HTML | `routes/orders.js` | 🔴 CRITIQUE |
| 3 | **Admin-reset sans auth** — endpoint destructif (reset/seed) accessible sans authentification | `routes/admin.js` | 🔴 CRITIQUE |
| 4 | **Route ordering bug** — `GET /:type` masque `GET /fabrics` et `GET /models` → 404 | `routes/modules.js` | 🔴 CRITIQUE |

> ⚠️ Ces 4 failles doivent être corrigées en priorité si l'app est accessible publiquement.

---

## 🧹 Nettoyage du repo prévu

| Problème | Détails |
|----------|---------|
| **Fichiers `.old`** | `public/komerce-api.old` — ancienne version à supprimer |
| **Migrations SQL mal placées** | `public/migration_v6_to_v71.sql` et `public/migration_v7_2_ceremony_orders.sql` devraient être dans `db/migrations/` |
| **Dashboards en doublon** | Versions `_v2`, `_v7`... dans `public/` — identifier les versions mortes et ne garder que les actuelles |
| **Documentation obsolète** | 3 roadmaps 100% terminées, audit frontend périmé — à archiver ou supprimer après rédaction des nouveaux docs |

---

## 🗺️ Cartographie d'impact 360° (OBJECTIF CLÉ)

### Objectif
Permettre à tout développeur de répondre instantanément à :
> **"Si je touche à X, qu'est-ce qui est impacté ?"**

Sécuriser chaque modification en ayant une vue complète sur tous les composants liés.

### Structure de la cartographie

#### A. Matrice de dépendances croisées
Tableau exhaustif croisant CHAQUE composant avec ses dépendances :

| Composant | Routes | Middleware | Utils | Tables DB | Frontends |
|-----------|--------|-----------|-------|-----------|----------|
| *chaque route* | — | auth utilisées | fonctions appelées | tables lues/écrites | dashboards liés |
| *chaque table* | routes qui y accèdent | — | utils qui la référencent | tables jointes | dashboards affichant ses données |
| *chaque util* | routes appelantes | — | autres utils | tables accédées | — |
| *chaque dashboard* | endpoints API appelés | — | — | — | — |

#### B. Vue par fonctionnalité métier
Pour chaque fonctionnalité (commandes, fidélité, paiements, stocks...) :
- Routes impliquées
- Tables DB touchées
- Utils et middleware concernés
- Dashboards impactés
- ⚠️ Effets de bord et dépendances cachées

#### C. Graphe d'impact par table DB
Pour chaque table :
- Qui la lit (SELECT) → quelles routes, quels dashboards
- Qui l'écrit (INSERT/UPDATE/DELETE) → quelles routes
- Jointures → quelles autres tables
- Triggers / cascades

#### D. Format
- **Option 1** : `docs/CARTOGRAPHY.md` — document markdown structuré
- **Option 2** : **App interactive** — cliquer sur un composant pour voir tous ses liens en temps réel (recommandé si le projet grossit)

---

## Structure documentaire cible (5 documents)

| Document | Rôle |
|----------|------|
| `README.md` | Point d'entrée, quickstart, structure repo |
| `docs/ARCHITECTURE.md` | Référence technique (DB, API, flux, middlewares) |
| `docs/CARTOGRAPHY.md` | 🗺️ Cartographie d'impact 360° — dépendances croisées entre tous les composants |
| `docs/STATUS.md` | État vivant : features, bugs ouverts, backlog, changelog |
| `docs/DEPLOYMENT.md` | Config, sécurité, déploiement Railway |

---

## Revue de code — Avancement

| Tâche | Statut | Fichier d'analyse |
|-------|--------|-------------------|
| server.js (570 lignes) | ✅ Terminé | `docs/review/analysis_server_js.md` |
| Routes lot 1 — admin, auth, baskets, dashboard, finance, health, logistics, loyalty, modules (57 endpoints) | ✅ Terminé | `docs/review/analysis_routes_batch1.md` |
| Routes lot 2 — orders, payments, pilotage, pricing, products, purchasing, relais, scans, unsold (56 endpoints) | ✅ Terminé | `docs/review/analysis_routes_batch2.md` |
| Middleware + utils + schéma DB | ❌ Interrompu — À refaire | — |
| Frontends (dashboards HTML + komerce-api.js) | ⏳ Pas commencé | — |
| Vérification des 7 écarts identifiés | ⏳ Pas commencé | — |
| Cartographie d'impact 360° | ⏳ Pas commencé — après revue de code | — |
| Rapport de revue de code consolidé | ⏳ Pas commencé | — |

---

## Résumé des découvertes critiques (routes)

### 🔴 Critiques
- **Route ordering bug** dans `modules.js` — `GET /:type` masque `GET /fabrics` et `GET /models` (404)
- **XSS** dans `orders.js` — `client_name`/`relais_name` non-échappés dans template HTML
- **SQL injection** dans `products.js` et `orders.js` — interpolation de strings au lieu de requêtes paramétrées
- **Endpoint admin-reset non authentifié** — reset/seed destructif accessible sans auth

### 🟠 Importants
- JWT fallback secret unsafe
- Pas d'auth sur les routes POST pricing
- Route morte 501 dans scans.js
- Rate-limiting in-memory (ne scale pas)
- Fuite de messages d'erreur internes

### ✅ Points positifs
- 95% des requêtes SQL sont paramétrées
- Try/catch présent sur toutes les routes
- Cookies sécurisés (httpOnly, SameSite, Secure)

---

## Prochaines étapes (session suivante)

1. **🚨 Discuter hotfix des 4 failles critiques** (si production)
2. **Refaire l'analyse middleware + utils + schema.sql** (interrompue)
3. **Auditer les 17 dashboards HTML** dans public/
4. **Identifier les dashboards morts** (versions _v2, _v7...)
5. **Vérifier les 7 écarts docs ↔ code**
6. **Construire la cartographie d'impact 360°** (matrice croisée + vues métier + graphe DB)
7. **Nettoyage repo** (.old, migrations mal placées, docs obsolètes)
8. **Consolider tout dans un rapport de revue unique**
9. **Rédiger les 5 documents cibles** (README, ARCHITECTURE, CARTOGRAPHY, STATUS, DEPLOYMENT)

---

## Pour reprendre

> **Instruction à donner à n'importe quel agent :**
> *"Connecte-toi à GitHub SamyrFateh/komerce-backend, lis SESSION_STATUS.md et reprends là où ça s'est arrêté."*

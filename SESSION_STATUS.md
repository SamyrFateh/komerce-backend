# Session de revue de code — Statut

> **Dernière mise à jour :** 5 avril 2026

## Objectif global

Restructurer la documentation du projet Komerce-backend :
1. ✅ **Étape 1** — Analyser la doc existante (8 fichiers, 86 KB) et identifier les problèmes
2. 🔄 **Étape 2** — Revue de code complète pour établir la "vérité terrain"
3. ⏳ **Étape 3** — Rédiger les 4 nouveaux documents (README, ARCHITECTURE, STATUS, DEPLOYMENT)

## Structure documentaire cible (validée)

| Document | Rôle |
|----------|------|
| `README.md` | Point d'entrée, quickstart, structure repo |
| `docs/ARCHITECTURE.md` | Référence technique (DB, API, flux, middlewares) |
| `docs/STATUS.md` | État vivant : features, bugs ouverts, backlog, changelog |
| `docs/DEPLOYMENT.md` | Config, sécurité, déploiement Railway |

## Revue de code — Avancement

| Tâche | Statut | Fichier d'analyse |
|-------|--------|-------------------|
| server.js (570 lignes) | ✅ Terminé | `docs/review/analysis_server_js.md` |
| Routes lot 1 — admin, auth, baskets, dashboard, finance, health, logistics, loyalty, modules (57 endpoints) | ✅ Terminé | `docs/review/analysis_routes_batch1.md` |
| Routes lot 2 — orders, payments, pilotage, pricing, products, purchasing, relais, scans, unsold (56 endpoints) | ✅ Terminé | `docs/review/analysis_routes_batch2.md` |
| Middleware + utils + schéma DB | ❌ Interrompu — À refaire | — |
| Frontends (dashboards HTML + komerce-api.js) | ⏳ Pas commencé | — |
| Vérification des 7 écarts identifiés | ⏳ Pas commencé | — |
| Rapport de revue de code consolidé | ⏳ Pas commencé | — |

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

## Prochaines étapes (session suivante)

1. **Refaire l'analyse middleware + utils + schema.sql** (interrompue)
2. **Auditer les 17 dashboards HTML** dans public/
3. **Vérifier les 7 écarts docs ↔ code**
4. **Consolider tout dans un rapport de revue unique**
5. **Rédiger les 4 documents cibles** (uniquement basés sur le code réel)

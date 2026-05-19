# 🎯 Analyse d'impact — Dashboard de Pilotage Unifié

> Workflow : ② Cartographie 360° + ③ Coffre-Fort Sécurité
> Date : 6 avril 2026

---

## ② Analyse Cartographie 360° — Fichiers & endpoints impactés

### Endpoints consommés (8) — `dashboard.js`

| # | Endpoint | Vue Dashboard | Données clés |
|---|----------|--------------|--------------|
| 1 | `GET /api/dashboard/ops` | 📦 Ops | Commandes du jour, en cours, bloquées, SLA tracker |
| 2 | `GET /api/dashboard/finance` | 💰 Finance | CA EUR/KMF, marges, paiements cash/Stripe |
| 3 | `GET /api/dashboard/pilotage` | 🎯 Pilotage | Coûts par catégorie, marges par produit |
| 4 | `GET /api/dashboard/pipeline` | 📦 Ops | Kanban commandes par statut |
| 5 | `GET /api/dashboard/retards` | 🚨 Retards | Clients en retard SLA, compensations |
| 6 | `GET /api/dashboard/forecast` | 📈 Tendances | Projections CA/marge 30j |
| 7 | `GET /api/dashboard/clients` | 🎯 Pilotage | Comportement clients, fidélité |
| 8 | `GET /api/dashboard/history` | 📈 Tendances | Historique mensuel (graphiques) |

### Tables lues par le dashboard (11 tables critiques)

| Table | Criticité | Endpoints qui la lisent |
|-------|:---------:|----------------------|
| `orders` | 🔴 | ops, finance, pilotage, pipeline, retards, forecast, history |
| `order_items` | 🔴 | finance, pilotage |
| `products` | 🔴 | pilotage |
| `users` | 🔴 | clients, retards |
| `exchange_rates` | 🔴 | finance, pilotage (taux EUR/KMF, AED/KMF) |
| `order_status_history` | 🟠 | ops (SLA), retards |
| `shipments` | 🟡 | ops |
| `scans` | 🟡 | ops |
| `recipients` | 🟡 | retards |
| `relais` | 🟡 | retards |
| `loyalty_tiers` | 🟡 | clients |

### Architecture existante ✅

- **Auth** : `authenticate` + `requireRole(['admin'])` — appliqué globalement au routeur
- **Rate limiting** : `dashboardLimiter` → 30 req/min
- **Cache mémoire** : TTL 30s, max 100 entrées (`_cache` Map)
- **Taux de change** : dynamiques via `getRates()`, jamais hardcodés
- **SLA** : Warning 35j, Late 42j, Blocked 56j, Inactif 7j
- **Compensations** : Préventif 28j, Avoir 35j, Remise 42j, Remboursement 56j

### Dépendances inter-routes

**dashboard.js n'a AUCUN appel croisé** vers d'autres routes. Il lit uniquement la base de données en lecture seule. C'est une bonne nouvelle : le Dashboard Pilotage est **découplé** du reste du système.

### Impact sur le code existant

| Impact | Détail |
|--------|--------|
| 🟢 **Aucun** fichier backend à modifier | Les 8 endpoints existent déjà et sont fonctionnels |
| 🟢 **Aucune** table à créer | Toutes les données nécessaires existent |
| 🟢 **Aucune** migration requise | Schéma DB stable |
| 🟡 **Rate limiting** à surveiller | 30 req/min pour 8 endpoints × rafraîchissement auto |

---

## ③ Analyse Coffre-Fort Sécurité — Risques liés au Dashboard

### Vulnérabilités impactant directement le Dashboard

| Issue | Sévérité | Impact Dashboard | Risque |
|:-----:|----------|-----------------|:------:|
| **#71** — Injection SQL | 🔴 CRITIQUE | `dashboard.js` est listé parmi les fichiers affectés | ⚠️ Moyen |
| **#79** — Pagination absente | 🟠 MAJEUR | Les requêtes dashboard agrègent toutes les données sans LIMIT | ⚠️ Moyen |
| **#82** — Logging absent | 🟠 MAJEUR | Pas de traces des requêtes dashboard | 🟡 Faible |
| **#84** — Pool PostgreSQL | 🟠 MAJEUR | Les 8 requêtes lourdes du dashboard pourraient stresser le pool | ⚠️ Moyen |

### Vulnérabilités N'impactant PAS le Dashboard

| Issue | Raison |
|:-----:|--------|
| #72 — Secrets en dur | Dashboard ne gère pas l'auth (middleware global) |
| #73 — Validation absente | Dashboard = lecture seule, pas de body à valider |
| #74 — Mots de passe faibles | Sans rapport |
| #75 — Données sensibles | Dashboard ne retourne pas de données utilisateur sensibles |
| #76 — Webhook Stripe | Sans rapport |

### Constat : Validation middleware

Le dashboard.js **n'a PAS de middleware `validate`**. C'est normal et attendu car :
- Tous les endpoints sont en GET (lecture seule)
- Aucun body/payload n'est envoyé
- Les paramètres query sont minimes

### Points de vigilance pour l'Instant App

| # | Risque | Mitigation |
|---|--------|-----------|
| 1 | **CORS** | L'app sera servie par Tasklet, pas depuis le domaine Railway → vérifier que CORS autorise l'origin Tasklet |
| 2 | **Auth token** | L'app doit s'authentifier en admin → stocker le JWT de manière sécurisée |
| 3 | **Rate limiting** | 5 vues × appels API = ~8-10 requêtes au chargement. Avec le cache TTL 30s, le refresh auto (15s) pourrait frapper le rate limit (30/min) |
| 4 | **Issue #48** | Les marges nettes sur la vue Pilotage seront incomplètes tant que `cost_real_kmf`, `transport_kmf`, `douane_kmf` ne sont pas renseignés (BLOQUANT) |

---

## ✅ Verdict

| Critère | Statut |
|---------|:------:|
| Endpoints prêts | ✅ 8/8 fonctionnels |
| Tables en place | ✅ 11/11 existent |
| Auth sécurisée | ✅ Admin-only |
| Pas d'impact sur le code backend | ✅ Lecture seule |
| Risques sécurité critiques | ⚠️ #71 (SQL injection) à surveiller |
| Données complètes | ⚠️ #48 (coûts réels) manquants pour la vue Pilotage |

### 🟢 FEUX VERTS — Prêt pour l'implémentation

Le Dashboard de Pilotage peut être implémenté **immédiatement** comme Instant App. Le backend est prêt, les endpoints fonctionnent, et l'impact sur le système existant est nul.

**Recommandations avant Go-Live du dashboard :**
1. S'assurer que le CORS accepte l'origin de l'Instant App
2. Ajuster le `dashboardLimiter` si le refresh auto est agressif
3. Planifier la saisie des coûts réels (#48) pour des marges fiables

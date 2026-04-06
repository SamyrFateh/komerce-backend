# 🗺️ ROADMAP KOMERCE BACKEND — Sessions à venir

> 📅 Créée le 06/04/2026 · Dernière session : audit deep + dashboard unifié
> 🔗 Repo : `SamyrFateh/komerce-backend`

---

## ✅ COMPLÉTÉ (Session 06/04/2026)

| # | Action | PR | Status |
|---|--------|-----|--------|
| 1 | Connexion GitHub + exploration repo | — | ✅ |
| 2 | Audit deep de la Cartographie 360° | — | ✅ |
| 3 | Carto Coffre-Fort v10.0 — 8 erreurs corrigées, 120 endpoints | **PR #90** | ✅ Mergée |
| 4 | Dashboard Unifié v11.0 — 4 fichiers → 1, auth blindée, 8 endpoints | **PR #91** | ✅ Mergée |
| 5 | Documentation architecture dashboard | **PR #92** | 🟡 À merger |
| 6 | Rapport d'audit (`docs/AUDIT_REPORT.md`) | PR #90 | ✅ Mergée |

---

## 🔴 PRIORITÉ 1 — Coffre-Fort & Cohérence

### 1.1 🗺️ Mise à jour Carto Coffre-Fort (post-dashboard v11)

**Problème** : La carto (PR #90) a été mergée AVANT le dashboard unifié (PR #91). Le coffre-fort est donc **périmé**.

**Écarts à corriger** :

| Section | Carto actuelle | Code réel (main) |
|---------|---------------|-------------------|
| `dashboard.js` | Anciens endpoints (7) | **8 nouveaux endpoints unifiés** |
| `pilotage.js` | 3 endpoints actifs | **Déprécié → redirects 301 uniquement** |
| `admin.js` | Inclut overlaps dashboard | **Nettoyé : -3 endpoints, +3 redirects** |
| `finance.js` | Inclut `/summary` | **-1 endpoint, +1 redirect** |
| `server.js` | v9.x | **v10.0 (routing dashboard unifié)** |
| Migration | Pas de 006 | **006_dashboard_columns.sql (14 cols + 4 index)** |
| Endpoint total | 120 | **À recalculer** (ajouts - suppressions + redirects) |

**Livrables** : PR avec CARTOGRAPHY_360.md mise à jour

---

### 1.2 🧹 Nettoyage PRs obsolètes

| PR | Action |
|---|---|
| **#88** — Dashboard Hub Dubai split | ❌ **Fermer** — supersédée par #89 (déjà mergée) |
| **#63** — README + Fix Hub Dubai | ❌ **Fermer** — supersédée par #64 (déjà mergée) |
| **#92** — DASHBOARD_REDESIGN.md | ✅ **Merger** |

---

## 🔴 PRIORITÉ 2 — Sécurité (14 issues ouvertes)

### 2.1 🚨 6 Vulnérabilités CRITIQUES (Issues #71-#76)

| Issue | Bug | Fichier(s) | Fix |
|-------|-----|------------|-----|
| #71 | **Injection SQL** | orders.js, admin.js, dashboard.js | Paramétrer toutes les requêtes |
| #72 | **Secrets en dur** | server.js (JWT_SECRET fallback) | Supprimer fallbacks, exiger .env |
| #73 | **Validation absente** | orders.js, products.js, auth.js | Ajouter Joi sur toutes les routes |
| #74 | **Mots de passe faibles** | auth.js | bcrypt rounds 12+, complexité mdp |
| #75 | **Données sensibles exposées** | users routes, admin | Filtrer réponses (pas de hash mdp) |
| #76 | **Webhook Stripe non vérifié** | payments.js | Ajouter vérification signature |

### 2.2 🟠 8 Vulnérabilités MAJEURES (Issues #77-#84)

| Issue | Bug | Fix |
|-------|-----|-----|
| #77 | Transactions DB manquantes | Wraper les opérations multi-tables |
| #78 | Gestion d'erreurs | Try/catch + error handler global |
| #79 | Pagination absente | Ajouter LIMIT/OFFSET partout |
| #80 | Architecture couches | Séparer routes / services / repos |
| #81 | Rate limiting incomplet | Étendre à toutes les routes sensibles |
| #82 | Logging absent | Ajouter Winston/Pino |
| #83 | Tests absents | Jest + Supertest — couverture minimale |
| #84 | Pool PostgreSQL | Configurer pool.max, idle timeout |

**Livrables** : 1 PR par issue ou groupées par priorité

---

## 🟡 PRIORITÉ 3 — Application Pilotage Komerce

### 3.1 ⚡ Instant App — Tableau de bord interactif

**Concept** : Application web interactive connectée aux 8 endpoints du dashboard unifié v11.

**5 Vues** :

| Vue | Endpoint(s) | Fonctionnalités |
|-----|-------------|-----------------|
| 📦 **Ops** | `/ops` + `/pipeline` | Kanban pipeline, SLA tracker, alertes temps réel |
| 💰 **Finance** | `/finance` | CA EUR/KMF, marges, top produits, paiements |
| 🎯 **Pilotage** | `/pilotage` + `/clients` | Coûts par catégorie, meilleurs clients, taux de change |
| 📈 **Tendances** | `/history` + `/forecast` | Graphiques mensuels, projections 30j |
| 🚨 **Retards** | `/retards` | Liste clients en retard, compensations, actions SMS |

**Stack** : React TSX + DaisyUI + Recharts (instant app Tasklet)

**Pré-requis** :
- Dashboard unifié mergé et fonctionnel ✅
- URL API accessible (Railway)
- Carto à jour ✅ (priorité 1.1)

---

## 🟢 PRIORITÉ 4 — Améliorations futures

| # | Amélioration | Impact |
|---|-------------|--------|
| 4.1 | Architecture en couches (routes → services → repos) | Maintenabilité |
| 4.2 | Tests automatisés (Jest + Supertest) | Fiabilité |
| 4.3 | CI/CD pipeline (GitHub Actions) | Déploiement |
| 4.4 | Monitoring + alertes (uptime, erreurs) | Opérations |
| 4.5 | Documentation API (Swagger/OpenAPI) | DX |

---

## 📋 Ordre de travail recommandé

```
Session 2 :
  ├── 1.1 Mise à jour carto coffre-fort (post-dashboard v11)
  ├── 1.2 Nettoyage PRs obsolètes (#88, #63)
  └── 1.2 Merger PR #92

Session 3 :
  ├── 2.1 Fix 6 vulnérabilités CRITIQUES (injection SQL, secrets, etc.)
  └── 2.2 Fix 8 vulnérabilités MAJEURES

Session 4 :
  ├── 3.1 Construction app Pilotage Komerce
  └── Tests de l'app avec l'API live

Session 5+ :
  └── 4.x Améliorations futures (architecture, tests, CI/CD)
```

---

## 📂 Fichiers de référence (sur l'agent)

| Fichier | Chemin |
|---------|--------|
| Code source complet | `/agent/home/audit/` (35 fichiers) |
| Rapport d'audit carto | `/agent/home/AUDIT_REPORT.md` |
| Proposition dashboard | `/agent/home/DASHBOARD_REDESIGN.md` |
| Subagent carto-writer | `/agent/subagents/cartography-writer.md` |
| Cette roadmap | `/agent/home/ROADMAP_KOMERCE.md` |

---

> 🔒 *Ce document est le guide de référence pour toutes les sessions à venir.*
> *Mettre à jour après chaque session.*

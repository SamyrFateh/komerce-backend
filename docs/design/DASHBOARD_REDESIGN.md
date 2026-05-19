# 🎯 REFONTE DASHBOARDS — Komerce Backend

> 📅 Audit 06/04/2026 — Proposition d'architecture **simple, claire et terriblement efficace**

---

## 🔴 ÉTAT DES LIEUX : POURQUOI TOUT REFAIRE

### Problème #1 — SÉCURITÉ CRITIQUE
**29 endpoints dashboard/admin SANS authentification.** N'importe qui peut :
- Voir toutes les commandes, CA, marges, clients (`/api/dashboard/*`, `/api/pilotage/*`)
- Supprimer des commandes (`DELETE /api/admin/orders/:id`)
- **WIPER LA BASE ENTIÈRE** (`POST /api/admin/reset`)
- Changer les mots de passe (`PUT /api/admin/users/:id/password`)
- Modifier les rôles (`PUT /api/admin/users/:id/role`)

### Problème #2 — OVERLAP MASSIF
Les mêmes données sont calculées à **3-5 endroits différents** :

| Donnée | Endpoints qui la servent |
|--------|-------------------------|
| Comptage par statut | dashboard /ops, admin /dashboard, pilotage / |
| CA total KMF | dashboard /sales, /forecast, finance /summary, pilotage /, admin /dashboard |
| Top produits | admin /dashboard, pilotage / |
| Alertes retards | dashboard /retards, admin /alerts, dashboard /ops |
| Marges | admin /margins, admin /dashboard, finance /summary, pilotage / |
| Historique mensuel | pilotage /history, finance /report |

**Résultat** : 12+ endpoints quand **5 bien conçus suffisent.**

### Problème #3 — PERFORMANCE
- 3 requêtes `SELECT` sans `LIMIT` sur des tables potentiellement volumineuses
- 1 boucle N+1 dans admin.js
- Pas de cache
- Pas d'index dédiés pour les dashboards

### Problème #4 — CODE
- 1 route sans `try/catch` (crash silencieux)
- Colonne fantôme `o.client_nom` référencée (n'existe pas)
- Taux EUR hardcodé à `492.0` au lieu d'utiliser `exchange_rates`

---

## 🏗️ NOUVELLE ARCHITECTURE : 3 DASHBOARDS + 2 UTILITIES

### Principe directeur
> **1 question = 1 endpoint. 1 rôle = 1 dashboard. 0 overlap.**

```
┌─────────────────────────────────────────────────────────────┐
│                    MIDDLEWARE LAYER                          │
│  authenticate → requireRole → dashboardLimiter → sanitize   │
└──────────┬───────────────┬──────────────────┬───────────────┘
           │               │                  │
     ┌─────▼─────┐  ┌─────▼──────┐  ┌────────▼────────┐
     │  📦 OPS   │  │  💰 FINANCE│  │  🎯 PILOTAGE   │
     │ (quotidien)│  │ (hebdo)    │  │  (stratégique)  │
     └───────────┘  └────────────┘  └─────────────────┘
```

### Dashboard 1 : 📦 OPS — Vue Opérationnelle
**Route** : `GET /api/dashboard/ops`
**Auth** : `authenticate` + `requireRole('admin', 'logistics', 'agent_relais')`
**Usage** : Ouvert chaque matin. Répond à "Comment vont les opérations ?"

```json
{
  "date": "2026-04-06",
  "pipeline": {
    "confirmed": 5,
    "ordered": 12,
    "preparation": 8,
    "shipped": 3,
    "in_transit": 7,
    "available": 15,
    "collected": 234,
    "cancelled": 18,
    "total_actif": 50,
    "total_termine": 252
  },
  "today": {
    "nouvelles_commandes": 4,
    "scans_effectues": 7,
    "collectes": 3,
    "ca_kmf": 450000
  },
  "bottlenecks": [
    {
      "reference": "KOM-20260401-A1B2",
      "status": "ordered",
      "jours_bloque": 5.2,
      "client": "Ali Mohamed",
      "relais": "Relais Moroni Centre"
    }
  ],
  "hub_dubai": {
    "en_preparation": 8,
    "expedies": 3,
    "en_transit": 7
  }
}
```

**SQL** : 2 requêtes maximum, toutes indexées, LIMIT sur bottlenecks.

---

### Dashboard 2 : 💰 FINANCE — Vue Financière
**Route** : `GET /api/dashboard/finance`
**Auth** : `authenticate` + `requireAdmin`
**Usage** : Consulté chaque semaine. Répond à "Où en est l'argent ?"

```json
{
  "period": { "start": "2026-03-07", "end": "2026-04-06", "days": 30 },
  "revenue": {
    "ca_kmf": 12500000,
    "ca_eur": 25406,
    "taux_eur_kmf": 492.17,
    "nb_commandes": 87,
    "panier_moyen_kmf": 143678,
    "vs_previous": { "ca_pct": 12.3, "nb_pct": 8.1 }
  },
  "payments": {
    "cash_relais": { "count": 52, "total_kmf": 7200000, "pct": 57.6 },
    "stripe_eur": { "count": 35, "total_kmf": 5300000, "pct": 42.4 },
    "pending": { "count": 8, "total_kmf": 1100000 },
    "confirmed": { "count": 79, "total_kmf": 11400000 }
  },
  "margins": {
    "avg_estimated_pct": 32.5,
    "avg_real_pct": 28.1,
    "gap_pct": -4.4,
    "orders_costed": 65,
    "orders_not_costed": 22,
    "total_margin_kmf": 3512000,
    "transport_kmf": 2100000,
    "douane_kmf": 1450000,
    "alerts": [
      { "reference": "KOM-...", "margin_real_pct": -5.2, "reason": "marge_negative" }
    ]
  },
  "monthly_trend": [
    { "mois": "2026-01", "ca_kmf": 9800000, "nb": 68, "marge_pct": 29.1 },
    { "mois": "2026-02", "ca_kmf": 10200000, "nb": 72, "marge_pct": 27.8 },
    { "mois": "2026-03", "ca_kmf": 11500000, "nb": 81, "marge_pct": 30.2 }
  ]
}
```

**SQL** : 3 requêtes (CA current + previous, payments, margins). Taux EUR depuis `exchange_rates`.

---

### Dashboard 3 : 🎯 PILOTAGE — Vue Stratégique
**Route** : `GET /api/dashboard/pilotage`
**Auth** : `authenticate` + `requireAdmin`
**Usage** : Consulté pour décisions stratégiques. Répond à "Comment va le business ?"

```json
{
  "kpi": {
    "clients_actifs_30j": 45,
    "clients_nouveaux_30j": 12,
    "taux_reachat_pct": 34.2,
    "taux_livraison_pct": 92.8,
    "taux_annulation_pct": 7.2,
    "delai_moyen_jours": 8.5,
    "nps_score": null
  },
  "top_products": [
    { "name": "Robe Cérémonie", "category": "ceremony", "nb_commandes": 23, "ca_kmf": 3450000 }
  ],
  "top_categories": [
    { "category": "ceremony", "nb_commandes": 45, "ca_kmf": 6750000, "pct_ca": 54.0 }
  ],
  "clients": {
    "total": 120,
    "actifs_30j": 45,
    "actifs_90j": 78,
    "top_clients": [
      { "name": "Ali Mohamed", "nb_commandes": 8, "ca_kmf": 1200000, "derniere_commande": "2026-04-03" }
    ]
  },
  "pipeline_health": {
    "score": 78,
    "issues": [
      "12 commandes en 'ordered' depuis > 3 jours",
      "Taux d'annulation en hausse (+2.1% vs mois précédent)"
    ]
  },
  "forecast_30j": {
    "ca_estime_kmf": 13500000,
    "methode": "moyenne_mobile_3m"
  }
}
```

---

### Utility 1 : 🚨 ALERTES
**Route** : `GET /api/dashboard/alerts`
**Auth** : `authenticate` + `requireAdmin`

Consolide TOUTES les alertes en un seul endpoint :
- Marges négatives
- Commandes bloquées > 3 jours
- Anomalies douane
- Sourcing bloqué
- Paiements en attente > 7 jours

---

### Utility 2 : 📤 EXPORT
**Route** : `GET /api/dashboard/export`
**Auth** : `authenticate` + `requireAdmin`
**Params** : `?type=orders|finance|clients&format=csv|json&period=30`

Un seul endpoint d'export au lieu de 2.

---

## 📊 COMPARAISON AVANT/APRÈS

| Métrique | Avant | Après |
|----------|-------|-------|
| Fichiers dashboard | **4** (dashboard, pilotage, finance, admin) | **1** (dashboard.js) |
| Endpoints | **12+** | **5** |
| Auth manquante | **29 routes** | **0** |
| Overlap de données | **6 doublons** | **0** |
| Requêtes SQL / page | **5-8** | **2-3** |
| Try/catch manquant | **1** | **0** |
| SELECT sans LIMIT | **3** | **0** |
| N+1 queries | **1** | **0** |
| Taux EUR hardcodé | **Oui (492.0)** | **Non (exchange_rates)** |

---

## 🔧 PLAN D'IMPLÉMENTATION

### Phase 1 — Sécuriser (URGENT)
- [ ] Ajouter `authenticate` + `requireAdmin` sur tous les endpoints admin/dashboard
- [ ] Ajouter `requireRole` approprié sur les endpoints ops

### Phase 2 — Refactorer les dashboards
- [ ] Créer le nouveau `routes/dashboard.js` avec les 5 endpoints
- [ ] Migrer la logique utile depuis pilotage.js et finance.js
- [ ] Supprimer les anciens endpoints redondants
- [ ] Utiliser `exchange_rates` au lieu du taux hardcodé

### Phase 3 — Séparer admin (non-dashboard) 
- [ ] Garder dans admin.js : users CRUD, partners CRUD, reset, seed-test
- [ ] Ajouter `authenticate` + `requireAdmin` partout
- [ ] Supprimer les endpoints dashboard d'admin.js

### Phase 4 — Optimisation
- [ ] Ajouter des index dédiés pour les dashboards
- [ ] LIMIT sur toutes les requêtes de liste
- [ ] Cache en mémoire (5 min) pour les KPIs lourds

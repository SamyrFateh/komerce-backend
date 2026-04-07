# 🔍 AUDIT CODE vs TRUTH — Rapport Complet
## Komerce Backend · 7 avril 2026

> **Objectif** : Partir du code réel et vérifier la cohérence avec la Cartographie 360 (v15.12), la Roadmap (v16.1), et l'Audit.
> **Résultat** : 🔴 Drift MAJEUR détecté — une refonte architecturale entière non documentée.

---

## 📊 Résumé Exécutif

| Métrique | Valeur |
|----------|--------|
| Fichiers code non tracés dans la Carto | **7** |
| Fichiers fantômes (dans Carto mais supprimés du repo) | **2** |
| SHA divergents (code modifié, Carto pas à jour) | **6 fichiers code** |
| Endpoints non documentés | **5** (routes/config.js) |
| Tables DB ajoutées non documentées | **2** (parcels, parcel_items) |
| Tables DB supprimées non documentées | **2** (sub_orders, sub_order_items) |
| Migrations non tracées | **4** (010 → 013) |
| Trigger supprimé non documenté | **1** (trg_scan_sync_status) |
| Fonction supprimée non documentée | **1** (sync_order_status_from_scan) |
| Enum ajouté non documenté | **1** (parcel_status) |
| **Sévérité globale** | **🔴 CRITIQUE** |

---

## 🔴 FINDING #1 — Refonte Parcel-Centric Non Documentée

**Impact** : CRITIQUE · 4 migrations · 2 utils · changement de source de vérité

### Ce qui s'est passé
Une refonte complète de l'architecture **order-centric → parcel-centric** a été réalisée en 4 phases (migrations 010-013) mais la Cartographie 360 n'en mentionne RIEN. C'est le plus gros écart trouvé.

### Nouvelles tables créées

| Table | Description | Clés |
|-------|------------|------|
| `parcels` | Unité logistique principale (remplace sub_orders) | order_id → orders, shipment_id → shipments, relais_id → relais |
| `parcel_items` | Mapping articles → colis | parcel_id → parcels, order_item_id → order_items, product_id → products |

### Tables supprimées

| Table | Raison |
|-------|--------|
| `sub_orders` | Données migrées vers `parcels` (migration 010) puis table droppée (migration 013) |
| `sub_order_items` | Données migrées vers `parcel_items` (migration 010) puis table droppée (migration 013) |

> ⚠️ La Carto v15.12 documente encore sub_orders (#29) et sub_order_items (#30) comme tables actives !

### Nouveau ENUM

```sql
parcel_status: draft | preparation | shipped | in_transit | arrived | available | collected | cancelled
```

> Note : le statut `arrived` (customs pending) est **nouveau** — il n'existait pas dans l'ancien modèle.

### Objets DB supprimés

| Objet | Type | Raison |
|-------|------|--------|
| `trg_scan_sync_status` | Trigger | Remplacé par `parcelSync.js` (Phase 3) |
| `sync_order_status_from_scan()` | Fonction | Idem |
| `orders.computed_status` | Colonne | Transitoire Phase 2→3, droppée Phase 4 |

### Nouveaux objets

| Objet | Type | Description |
|-------|------|-------------|
| `trg_parcels_updated` | Trigger | set_updated_at() sur parcels |
| `parcel_ref_seq` | Séquence | Auto-incrémentation refs KOM-P-YYYY-NNNNNN |
| `scans.parcel_id` | Colonne FK | Lie un scan à un colis |
| `parcels.cancel_reason` | Colonne | Raison annulation |
| `parcels.estimated_date` | Colonne | Date estimée |
| `parcels.backorder_reminder_sent` | Colonne | Flag rappel envoyé |
| 4 business_rules PARCEL_* | Données | Configuration split strategy |

### Nouveaux fichiers utils

| Fichier | Taille | Rôle |
|---------|--------|------|
| `utils/parcels.js` | 13.4 KB | Moteur parcel — `computeOrderStatus()`, `splitOrderIntoParcels()`, registre STRATEGIES |
| `utils/parcelSync.js` | 11.2 KB | Sync engine — `safeSyncScanToParcels()` (SOURCE DE VÉRITÉ pour orders.status) |

### Changement de source de vérité 🚨

| Avant (Carto v15.12) | Après (Code réel) |
|---|---|
| Trigger DB `trg_scan_sync_status` met à jour `orders.status` | `parcelSync.js` → `computeOrderStatus()` met à jour `orders.status` |
| Scans autonomes | Scans passent par `safeSyncScanToParcels()` |
| sub_orders pour expédition partielle | parcels pour expédition partielle |

### Migrations manquantes dans la Carto

| Migration | Phase | Contenu |
|-----------|-------|---------|
| `010_parcels_foundation.sql` (10.4 KB) | 1 | Tables parcels/parcel_items, enum, index, migration sub_orders → parcels |
| `011_parcels_dual_write.sql` (1.7 KB) | 2 | Index composites pour double écriture |
| `012_parcels_trigger_migration.sql` (5.2 KB) | 3 | Désactivation trigger, réconciliation statuts |
| `013_legacy_cleanup.sql` (2.4 KB) | 4 | DROP sub_orders/sub_order_items, DROP trigger/function, enrichissement parcels |

---

## 🔴 FINDING #2 — Route config.js Non Documentée (5 endpoints)

**Impact** : MODÉRÉ · 5 endpoints admin manquants de la Carto

La route `routes/config.js` est dans l'arbre de la Carto mais n'a **AUCUNE section dédiée dans la Carte des Routes** (Section 4).

### Endpoints manquants

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/config/rules` | ✅ | admin | Liste toutes les règles groupées par catégorie |
| 2 | `GET` | `/api/config/rules/:key` | ✅ | admin | Détail d'une règle + historique récent |
| 3 | `PUT` | `/api/config/rules/:key` | ✅ | admin | Modifier une règle (+ raison optionnelle) |
| 4 | `POST` | `/api/config/rules/:key/reset` | ✅ | admin | Reset à la valeur par défaut |
| 5 | `GET` | `/api/config/rules/:key/history` | ✅ | admin | Historique des modifications |

> Dépendances : `utils/rules.js` (getAllRules, getRuleByKey, updateRule, resetRule, getRuleHistory), `validators/index.js` (configSchemas)

### Frontend associé manquant

`public/Komerce_Config.html` (33.9 KB) — Page admin pour gérer les business_rules via l'API config. Absente de la Carto Section 12.

---

## 🟡 FINDING #3 — SHA Divergents Code (6 fichiers)

### Fichiers code avec SHA décalé

| Fichier | Carto SHA | Réel SHA | Taille Carto → Réelle | Analyse |
|---------|-----------|----------|----------------------|---------|
| `server.js` | 58742e77 | 654521a0 | 45.7 → 43.7 KB (-2 KB) | Probablement nettoyage imports/routes |
| `routes/dashboard.js` | cc16c326 | cd349fa3 | 43.8 → 53.3 KB (+10 KB) | 🔴 Potentiels nouveaux endpoints |
| `routes/orders.js` | 70a2272d | 5bfeaf26 | 100.9 → 99.7 KB (-1 KB) | Mineur |
| `routes/scans.js` | c667d95e | c5ba1e1e | 23.0 → 25.2 KB (+2 KB) | 🔴 Intégration parcelSync |
| `utils/reference.js` | 253751b9 | d8e0cb5e | 2.5 → 3.3 KB (+0.8 KB) | Ajout `generateParcelRef()` |
| `validators/index.js` | f04565ef | 5dd674f3 | 15.4 → 15.1 KB | Ajout configSchemas probable |

### Fichiers critiques à investiguer

1. **dashboard.js (+10 KB)** — Peut contenir de nouveaux endpoints non documentés
2. **scans.js (+2 KB)** — Intégration confirmée de `safeSyncScanToParcels()` (Phase 3)

---

## 🟠 FINDING #4 — Fichiers Fantômes (dans Carto mais supprimés du repo)

| Fichier | Taille Carto | SHA Carto | Statut |
|---------|-------------|-----------|--------|
| `AGENT_RULES.md` (racine) | 3.0 KB | 965976d8 | 👻 SUPPRIMÉ — remplacé par docs/GOVERNANCE.md |
| `docs/AGENTS_PROTOCOL.md` | 14.3 KB | 2ace95c4 | 👻 SUPPRIMÉ — probablement fusionné |

---

## 🟡 FINDING #5 — Métriques Carto Obsolètes

| Métrique | Carto dit | Réalité | Écart |
|----------|-----------|---------|-------|
| Utilitaires | 8 fichiers | **10 fichiers** | +2 (parcels.js, parcelSync.js) |
| Migrations | 6 (004-009) | **10 (004-013)** | +4 migrations parcels |
| Endpoints | ~127 | **~132** | +5 (config.js) |
| Tables | 31+ (incluant sub_orders) | **31+** (parcels remplace sub_orders) | Changement qualitatif |
| Triggers DB | 6 | **6** (mais 1 changé : trg_scan_sync_status → trg_parcels_updated) | Qualitatif |
| Fonctions DB | 2 | **1** (sync_order_status_from_scan() supprimée) | -1 |
| Enums | 6 | **7** (+parcel_status) | +1 |

---

## 🟡 FINDING #6 — Fichiers Docs Non Référencés dans la Carto

| Fichier | Taille | Description |
|---------|--------|-------------|
| `docs/AGENT_CONFIG.md` | 8.9 KB | Configuration agent IA |
| `docs/AGENT_SUBAGENTS.md` | 4.6 KB | Instructions sous-agents |
| `docs/GOVERNANCE.md` | 7.1 KB | Gouvernance v2.3 (8 règles) |
| `docs/_agent/` | dir | Dossier agent |
| `docs/_logs/` | dir | Dossier logs |
| `docs/_work/` | dir | Dossier travaux en cours |

---

## 🔴 FINDING #7 — Section Carto "Dépendances inter-routes" Obsolète

La Section 7 de la Carto documente les appels croisés mais est désormais **FAUSSE** :

| Ce que dit la Carto | Réalité |
|---------------------|---------|
| `purchasing.js → scans.js` via `triggerScan3()` | Toujours vrai |
| `scans.js` gère status via trigger DB | 🔴 **FAUX** — c'est `parcelSync.js` maintenant |
| Pas de dépendance scans → parcels | 🔴 **FAUX** — `scans.js` utilise `safeSyncScanToParcels()` |

### Nouveau graphe de dépendances réel

```
                    ┌────────────┐
                    │  orders.js │
                    └─────┬──────┘
                          │
              ┌───────────┴───────────┐
              │ getLoyaltyDiscount()   │ recalculateLoyalty()
              ▼                       ▼
        ┌────────────┐         ┌─────────────┐
        │ loyalty.js │◄────────│  scans.js   │
        └────────────┘         └──────┬──────┘
                                      │
                           ┌──────────┤ safeSyncScanToParcels()
                           ▼          │ triggerScan3()
                    ┌──────────────┐  │
                    │parcelSync.js │  │
                    └──────┬───────┘  │
                           │          │
                           ▼          ▼
                    ┌──────────────┐  ┌──────────────┐
                    │ parcels.js   │  │purchasing.js │
                    └──────────────┘  └──────▲───────┘
                                             │ triggerPurchasing()
                                      ┌──────┴───────┐
                                      │ payments.js  │
                                      └──────────────┘
```

---

## 🟡 FINDING #8 — Roadmap Restructurée

La Roadmap est passée de 22.8 KB à 7.9 KB — ce n'est **pas un bug**, c'est un nettoyage/simplification. Mais :

- La Carto référence le SHA `81d66b08` → le réel est `e2769e24`
- La Roadmap v16.1 documente correctement la refonte Parcel-Centric (3/5 phases) et la Gouvernance (4/5 phases)
- **Cohérence Roadmap ↔ Code : ✅ OK** (les phases listées comme ✅ correspondent aux migrations existantes)

---

## 📋 Plan de Correction

### Phase 1 — Delta Carto Critique (MAINTENANT)

1. Ajouter section `config.js` dans la Carte des Routes (5 endpoints)
2. Ajouter `parcels`, `parcel_items` dans le schéma DB
3. Retirer `sub_orders`, `sub_order_items` du schéma DB
4. Ajouter `parcel_status` enum
5. Corriger triggers (retirer trg_scan_sync_status, ajouter trg_parcels_updated)
6. Corriger fonctions (retirer sync_order_status_from_scan)
7. Ajouter migrations 010-013 dans l'arbre
8. Ajouter `utils/parcels.js` et `utils/parcelSync.js`
9. Ajouter `public/Komerce_Config.html`
10. Retirer `AGENT_RULES.md` et `docs/AGENTS_PROTOCOL.md` fantômes
11. Mettre à jour tous les SHA divergents
12. Mettre à jour les métriques globales
13. Corriger la Section 7 (dépendances inter-routes)
14. Ajouter docs de gouvernance dans la Section 15

### Phase 2 — Investigation Code Modifié

1. Lire `routes/dashboard.js` pour identifier les endpoints ajoutés (+10 KB)
2. Vérifier si `scans.js` a de nouveaux endpoints ou juste l'intégration parcelSync

### Phase 3 — Commit + Push

1. Committer l'analyse dans `docs/_work/`
2. Déposer delta correctif dans `docs/_pending/`
3. Ou appliquer directement les corrections Carto

---

> 📝 Rapport généré le 7 avril 2026 · Audit lancé depuis le code réel
> 🔒 Suivre la gouvernance v2.3 : ce rapport EST le delta d'analyse (Règle #2)

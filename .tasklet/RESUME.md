# KOMERCE BACKEND — RESUME POINT

## Contexte rapide
Backend Node/Express + PostgreSQL (Railway).
Philosophie **parcel-centric** : tout tourne autour des colis, pas des commandes.

## Vagues précédentes (toutes mergées)
| Vague | Statut |
|-------|--------|
| V1 — Socle Parcel-Centric | ✅ Mergé |
| V2 — Hub Terrain | ✅ Mergé (PR #119) |
| V3 — Optimisation | ✅ Mergé (PR #119) |
| Hotfix — SyntaxError L619 | ✅ Mergé (PR #120) |
| Safety — Hub Safety Fixes | ✅ PR #121 — DB appliquée (migrations 010→017) |

## Migrations appliquées
010 → 017 toutes appliquées sur Railway.

## Règles absolues
- **R1** : statut commande = agrégé via `parcelSync.js`, jamais écrit directement
- **R2** : hub = scan → pack → seal avec transactions `FOR UPDATE`

---

## CHANTIER TERMINÉ : Refonte Dashboards ✅

Tous les 7 écrans terminés et pushés sur main. Voir `REFONTE_DASHBOARDS.md` pour détails.

---

## CHANTIER EN COURS : Audit Architecture & Alignement DB

> **Date** : 7 avril 2026

### Fichiers d'audit ajoutés
- `.tasklet/CARTOGRAPHY_360.md` — Cartographie complète (tables, routes, utils, middleware)
- `.tasklet/AUDIT_FIXES.md` — Tracker des 12 fixes identifiés avec priorités

### Résultat de l'audit : 🔴 5 critiques détectés

| # | Fix ID | Sévérité | Problème |
|---|--------|----------|----------|
| 1 | FIX-001 | 🔴 P0 | `computeOrderStatus()` retourne `pending/delivered/processing/arrived` → invalides pour ENUM `order_status`. **R1 cassée.** |
| 2 | FIX-002 | 🔴 P0 | CREATE TABLE `parcels`, `parcel_items`, TYPE `parcel_status` **absents** du repo. DB non-recréable. |
| 3 | FIX-003 | 🔴 P0 | Trigger `trg_scan_sync_status` toujours actif vs parcelSync Phase 3. **Double écriture.** |
| 4 | FIX-004 | 🔴 P0 | FOR UPDATE relâché avant `safeSyncScanToParcels()`. **Race condition hub.** |
| 5 | FIX-005 | 🔴 P0 | `finance.js` référence 4 colonnes inexistantes. **Export cassé.** |
| 6 | FIX-006 | 🟡 P1 | `scans.parcel_id` absent du schéma |
| 7 | FIX-007 | 🟡 P1 | `STATUS_TO_STEP` : `preparing` ≠ `preparation` |
| 8 | FIX-008 | 🟠 P2 | `products.price_eur/badge` non définis |
| 9 | FIX-009 | 🟠 P2 | `order_items.unit_price_kmf` → devrait être `price_kmf` |
| 10 | FIX-010 | ⚪ P3 | `pilotage.js` code mort |
| 11 | FIX-011 | ⚪ P3 | `finance.js` monté 2 fois |
| 12 | FIX-012 | ⚪ P3 | Seed data dans server.js (700 lignes) |

### Stratégie de fix (3 étapes)
1. **Migration 018** → Réconcilier le schéma (FIX-002, 003, 006, 008)
2. **Fix code** → Aligner computeOrderStatus, hub.js transactions, finance.js, parcels.js (FIX-001, 004, 005, 007, 009)
3. **Clean-up** → Supprimer code mort, extraire seeds (FIX-010, 011, 012)

### Prochaine étape
→ Attaquer **Étape 1 : migration 018** + **FIX-001** (les 2 P0 les plus urgents)

---

## 3 Verrous toujours actifs
| # | Verrou | Fichier |
|---|--------|---------|
| ⛔1 | Hub = Idiot-proof (zéro contexte commande pour opérateur) | `REFONTE_DASHBOARDS.md` |
| ⛔2 | Pipeline = Zéro logique commande (100% parcels.status) | `REFONTE_DASHBOARDS.md` |
| ⛔3 | Restructurer l'existant, pas recréer de zéro | `RESTRUCTURATION.md` |

## Fichiers de spec
- `.tasklet/REFONTE_DASHBOARDS.md` — spec complète de la refonte dashboards
- `.tasklet/RESTRUCTURATION.md` — principes de restructuration
- `.tasklet/DESIGN_SYSTEM.md` — design system documenté
- `.tasklet/codegen-instructions.md` — instructions backend
- `.tasklet/CARTOGRAPHY_360.md` — **NEW** cartographie architecture 360°
- `.tasklet/AUDIT_FIXES.md` — **NEW** tracker des fixes

## Structure public/ (7 écrans)
```
public/
├── Komerce_Hub.html          ← Hub Opérateur
├── Komerce_Dashboard.html     ← Dashboard Pilotage (9 onglets)
├── Komerce_Admin.html         ← Admin complet
├── Komerce_Relais.html        ← Relais
├── Komerce_Pipeline.html      ← Pipeline
├── Komerce_Pilotage_v2.html   ← Redirect → Dashboard
├── portal.html                ← Portail d'entrée
├── komerce-ui.css             ← Design system CSS
├── komerce-api.js             ← Couche API JS
├── chart.umd.min.js           ← Chart.js
├── sw.js                      ← Service Worker
├── images/                    ← Assets images
└── archive/                   ← Anciens fichiers (référence)
```

## Pour reprendre
1. Lire ce fichier
2. Lire `.tasklet/AUDIT_FIXES.md` pour voir les fixes en cours
3. Lire `.tasklet/CARTOGRAPHY_360.md` pour la carte du projet
4. Respecter les 3 verrous
5. Prochain chantier = Étape 1 (migration 018 + FIX-001)

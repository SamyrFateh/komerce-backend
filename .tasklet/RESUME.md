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
**018 prête** — voir branche `fix/etape1-schema-reconciliation`.

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

### Étape 1 : Migration 018 + FIX-001 ✅
- `migrations/018_schema_reconciliation.sql` créée
  - FIX-002 : CREATE TYPE/TABLE IF NOT EXISTS (parcels, parcel_items, customs_history)
  - FIX-003 : DISABLE TRIGGER trg_scan_sync_status
  - FIX-006 : ADD COLUMN scans.parcel_id
  - FIX-008 : ADD COLUMNS products.price_eur, products.badge
- `utils/parcels.js` — FIX-001 : computeOrderStatus() aligné sur ENUM order_status
- **Branche** : `fix/etape1-schema-reconciliation`
- **Score** : 5/12 fixes terminés

### Prochaine étape : Étape 2 (FIX-004, 005, 007, 009)
→ Restructurer hub.js transactions, corriger finance.js, fix STATUS_TO_STEP, fix unit_price_kmf

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
- `.tasklet/CARTOGRAPHY_360.md` — cartographie architecture 360°
- `.tasklet/AUDIT_FIXES.md` — tracker des fixes (5/12 terminés)

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
5. Prochain chantier = Étape 2 (FIX-004, 005, 007, 009)

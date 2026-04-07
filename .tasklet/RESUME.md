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
**018 prête** — voir branche `fix/etape1-schema-reconciliation` (PR #124).
**019 prête** — voir branche `fix/etape2-code-fixes`.

## Règles absolues
- **R1** : statut commande = agrégé via `parcelSync.js`, jamais écrit directement
- **R2** : hub = scan → pack → seal avec transactions `FOR UPDATE`

---

## CHANTIER TERMINÉ : Refonte Dashboards ✅

Tous les 7 écrans terminés et pushés sur main.

---

## CHANTIER EN COURS : Audit Architecture & Alignement DB

> **Date** : 7 avril 2026

### Fichiers d'audit
- `.tasklet/CARTOGRAPHY_360.md` — Cartographie complète
- `.tasklet/AUDIT_FIXES.md` — Tracker des 12 fixes (9/12 ✅)

### ✅ Étape 1 : Migration 018 + FIX-001 (FAIT)
- FIX-001, 002, 003, 006, 008
- Branche : `fix/etape1-schema-reconciliation` (PR #124)

### ✅ Étape 2 : Fix code (FAIT)
- **FIX-004** : `parcelSync.js` v2.1 — paramètre `dbClient` pour mode transactionnel. `hub.js` restructuré : sync DANS la transaction.
- **FIX-005** : Migration 019 — 4 colonnes finance ajoutées à orders.
- **FIX-007** : `parcels.js` STATUS_TO_STEP `preparing` → `preparation`.
- **FIX-009** : `parcels.js` `unit_price_kmf` → `price_kmf`.
- Branche : `fix/etape2-code-fixes`

### Prochaine étape : Étape 3 (FIX-010, 011, 012)
→ Clean-up : supprimer pilotage.js, dé-dupliquer finance.js, extraire seeds

### Score : 9/12 fixes terminés (tous P0/P1/P2 ✅, reste 3 P3)

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
- `.tasklet/AUDIT_FIXES.md` — tracker des fixes (9/12 terminés)

## Structure public/ (7 écrans)
```
public/
├── Komerce_Hub.html
├── Komerce_Dashboard.html
├── Komerce_Admin.html
├── Komerce_Relais.html
├── Komerce_Pipeline.html
├── Komerce_Pilotage_v2.html
├── portal.html
├── komerce-ui.css
├── komerce-api.js
├── chart.umd.min.js
├── sw.js
├── images/
└── archive/
```

## Pour reprendre
1. Lire ce fichier
2. Lire `.tasklet/AUDIT_FIXES.md` pour voir les fixes
3. Respecter les 3 verrous
4. Prochain chantier = Étape 3 (FIX-010, 011, 012) — P3 clean-up

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

## CHANTIER : Refonte Dashboards

### 3 Verrous posés
| # | Verrou | Fichier |
|---|--------|---------|
| ⛔1 | Hub = Idiot-proof (zéro contexte commande pour opérateur) | `.tasklet/REFONTE_DASHBOARDS.md` |
| ⛔2 | Pipeline = Zéro logique commande (100% parcels.status) | `.tasklet/REFONTE_DASHBOARDS.md` |
| ⛔3 | Restructurer l'existant, pas recréer de zéro | `.tasklet/RESTRUCTURATION.md` |

### Fichiers de spec
- `.tasklet/REFONTE_DASHBOARDS.md` — spec complète de la refonte
- `.tasklet/RESTRUCTURATION.md` — principes de restructuration
- `.tasklet/DESIGN_SYSTEM.md` — design system documenté
- `.tasklet/codegen-instructions.md` — instructions backend

### Fondation (pushée sur main)
| Fichier | Statut | Description |
|---------|--------|-------------|
| `public/komerce-ui.css` | ✅ Pushé | CSS Design System partagé (DM Sans, amber/gold, cartes, badges, KPIs, kanban, etc.) |
| `public/komerce-api.js` | ✅ Pushé | Couche API unifiée JS (K.request, K.auth, K.hub, K.parcels, K.orders, K.ui) |
| `public/chart.umd.min.js` | ✅ Pushé | Chart.js UMD bundle |

### Écrans — État au 07/04/2026
| # | Écran | Fichier | Taille | Statut | Notes |
|---|-------|---------|--------|--------|-------|
| 1 | Hub Opérateur | `Komerce_Hub.html` | 29 KB | ✅ **Terminé** | Mobile-first, scan→pack→seal, ⛔V1 respecté |
| 2 | Dashboard Pilotage | `Komerce_Dashboard.html` | 86 KB | ✅ **Terminé** | 9 onglets (Vue d'ensemble, Pipeline, Hub, Relais, Finance, Clients, Catalogue, Retards, Tendances), Chart.js, auto-refresh 30s |
| 3 | Admin | `Komerce_Admin.html` | 121 KB | ✅ **Terminé** | Sidebar complète, login, commandes, logistique, litiges, finance, pricing, catalogue, relais, paramètres |
| 4 | Portal | `portal.html` | 16 KB | ✅ **Terminé** | Login, tuiles par rôle, liens vers tous les dashboards |
| 5 | Pipeline | `Komerce_Pipeline.html` | 263 B | 🔀 Redirect | → `Dashboard.html#pipeline` (onglet intégré dans le Dashboard) |
| 6 | Relais | `Komerce_Relais.html` | 257 B | 🔀 Redirect | → `Dashboard.html#relais` (onglet intégré dans le Dashboard) |
| 7 | Pilotage v2 | `Komerce_Pilotage_v2.html` | 255 B | 🔀 Redirect | → `Dashboard.html` (alias) |

### Autres fichiers dans public/
| Fichier | Taille | Note |
|---------|--------|------|
| `Komerce_Backend.html` | 512 KB | Ancien monolithe (référence, ne plus modifier) |
| `Komerce_Backoffice_Admin_v2.html` | 68 KB | Ancienne version admin |
| `Komerce_Admin_Users.html` | 32 KB | Gestion users (ancienne) |
| `Komerce_Config.html` | 34 KB | Configuration |
| `Komerce_Mobile.html` | 54 KB | Version mobile |
| `Komerce_Web.html` | 81 KB | Version web |
| `Komerce_Simulateur.html` | 106 KB | Simulateur |
| `Komerce_Tests.html` | 147 KB | Tests |
| `Komerce_QR_Print.html` | 9 KB | Impression QR |
| `index.html` | 144 KB | Page d'accueil |

### API Hub (endpoints réels)
```
POST /api/hub/scan     { parcel_ref, notes }
POST /api/hub/pack     { parcel_id, box_label, notes }
POST /api/hub/seal     { parcel_id, notes }
GET  /api/hub/pending   → { data: [...], count }
GET  /api/hub/today     → { scanned_today, packed_today, sealed_today, pending_total }
```

### API Parcels (endpoints réels)
```
GET    /api/parcels           → liste avec filtres
GET    /api/parcels/:ref      → détail avec items
POST   /api/parcels           → créer
PATCH  /api/parcels/:id       → modifier
DELETE /api/parcels/:id       → supprimer
```

### Design System — Résumé rapide
- **Fonts** : DM Sans (text), JetBrains Mono (data)
- **Accent** : amber/gold `#F5A623` / `#d97706`
- **Fond** : `#f8f9fa`, cartes `#ffffff`
- **CSS classes** : `.card`, `.btn`, `.btn-primary`, `.badge`, `.badge-success/warning/error/info`, `.table`, `.stats`, `.sc`, `.pipe`, `.ps`, `.g2/.g3`
- **Mobile-first**, breakpoint 768px

### Pour reprendre
1. Lire ce fichier
2. Lire `.tasklet/REFONTE_DASHBOARDS.md` si besoin de specs détaillées
3. Tous les écrans principaux sont ✅ terminés
4. Respecter les 3 verrous
5. Utiliser le design system partagé (komerce-ui.css + komerce-api.js)

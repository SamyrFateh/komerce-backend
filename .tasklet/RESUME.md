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

## CHANTIER EN COURS : Refonte Dashboards

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

### Fondation (pushée sur main)
| Fichier | Statut | Description |
|---------|--------|-------------|
| `public/komerce-ui.css` | ✅ Pushé | CSS Design System partagé (IBM Plex, amber/gold, cartes, badges, KPIs, kanban, etc.) |
| `public/komerce-api.js` | ✅ Pushé | Couche API unifiée JS (K.request, K.auth, K.hub, K.parcels, K.orders, K.ui) |

### Écrans à construire
| # | Écran | Fichier | Statut | Notes |
|---|-------|---------|--------|-------|
| 1 | Hub Opérateur | `public/Komerce_Hub.html` | ✅ Pushé | Autonome, mobile-first, ⛔V1 respecté |
| 2 | Pipeline Kanban | `public/Komerce_Pipeline.html` | 🔄 **EN COURS** | Kanban parcel-centric, ⛔V2 |
| 3 | Relais | `public/Komerce_Relais.html` | ⬜ À faire | Réception → dispo → remise |
| 4 | Dashboard Pilotage | `public/Komerce_Dashboard.html` | ⬜ À faire | KPIs + alertes uniquement |
| 5 | Admin | `public/Komerce_Admin.html` | ⬜ À faire | Commandes + users + config |
| 6 | Portal | `public/portal.html` | ⬜ À faire | Tuiles par rôle |

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
- **Fonts** : IBM Plex Sans (text), IBM Plex Mono (data)
- **Accent** : amber/gold `#d97706`
- **Fond** : `#faf6f0` (crème), cartes `#fff`
- **CSS classes** : `.card`, `.btn`, `.btn-outline`, `.badge`, `.badge-green/amber/red/blue/purple`, `.inp`, `.kpi-card`, `.kpi-val`, `.g2/.g3/.g4`, `.toast`, `.kanban-board`, `.kanban-col`, `.kanban-card`
- **Mobile-first**, breakpoint 768px

### Pour reprendre
1. Lire ce fichier
2. Lire `.tasklet/REFONTE_DASHBOARDS.md` pour la spec complète
3. Continuer à l'écran marqué 🔄 ou ⬜
4. Respecter les 3 verrous
5. Utiliser le design system partagé (komerce-ui.css + komerce-api.js)

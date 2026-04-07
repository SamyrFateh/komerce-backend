# 🔄 KOMERCE — Plan de reprise Vague 1/2/3

> Dernière mise à jour : 7 avril 2026 — 18h30
> Ce dossier contient les instructions de codage + fichiers générés pour reprendre après coupure.

## 📋 PLAN DE MICRO-COMMITS

### ✅ VAGUE 1 — Socle Parcel-Centric (~22h estimé)

| # | Commit | Fichiers | Statut |
|---|--------|----------|--------|
| C1 | 🔐 Fix CORS whitelist (#74) + adminLimiter (#75) + gate reset (#76) | `server.js`, `middleware/rate-limit.js`, `routes/admin.js` | ✅ PUSHÉ `a9371eb` |
| C2 | 🛠️ Fix logistics.js R1 violations | `routes/logistics.js` | ✅ PUSHÉ `a930baf` |
| C3 | 📦 Parcels CRUD API + validators + migration 014 | `routes/parcels.js`, `validators/index.js`, `migrations/014_parcels_final_cleanup.sql` | ✅ PUSHÉ `05af183` |
| C3-bis | 🔌 Wire /api/parcels in server.js | `server.js` | ✅ PUSHÉ `6e5bf0f` |

### ⬜ VAGUE 2 — Hub Terrain

| # | Commit | Fichiers | Statut |
|---|--------|----------|--------|
| C4 | 🏭 Create routes/hub.js | `routes/hub.js` (new) | ⬜ À CODER |
| C5 | 🔌 Register hub in server.js | `server.js` | ⬜ À CODER |

### ⬜ VAGUE 3 — Optimisation Avancée

| # | Commit | Fichiers | Statut |
|---|--------|----------|--------|
| C6 | 🗃️ Migration 015 customs enrichment | `migrations/015_customs_enrichment.sql` (new) | ⬜ À CODER |
| C7 | 🗃️ Migration 016 carriers table | `migrations/016_carriers.sql` (new) | ⬜ À CODER |
| C8 | 🚚 Carrier CRUD + customs endpoints | `routes/carriers.js` (new) | ⬜ À CODER |
| C9 | 📊 Dashboard logistics costs | `routes/dashboard.js` modif | ⬜ À CODER |

## 🏗️ Architecture & Règles Clés

### R1 — Parcel-Centric
- Aucun flux ne dépend de la complétude commande
- Chaque colis est autonome
- `orders.status` = agrégation via `parcelSync`, JAMAIS écrit directement

### R2 — Hub Opérateur
- Scan → Box → Seal : 3 actions seulement
- Auth: `agent_hub` ou `admin`

### Tech Stack
- Node.js + Express + PostgreSQL
- JWT auth: `middleware/auth.js` → `authenticate`, `requireRole`
- Validation: `middleware/validate.js` + `validators/index.js` (Joi)
- Parcel sync: `utils/parcelSync.js` → `safeSyncScanToParcels`
- Parcel utils: `utils/parcels.js` → `PARCEL_TYPES`, `PARCEL_STATUSES`, `computeOrderStatus`, `splitOrderIntoParcels`
- References: `utils/reference.js` → `generateParcelRef`, `generateShipmentRef`
- SMS: `utils/sms.js` → `sendSMS`
- Rate limiting: `middleware/rate-limit.js`

## 📂 Structure des fichiers générés

```
.tasklet/
├── RESUME.md                          ← ce fichier
├── codegen-instructions.md            ← instructions complètes du codegen agent
├── c1-security/
│   ├── server.js                      ✅ PUSHÉ
│   ├── middleware/rate-limit.js        ✅ PUSHÉ
│   └── routes/admin.js                ✅ PUSHÉ
├── c2-logistics-r1/                   ✅ PUSHÉ (via Tasklet)
├── c3-parcels-api/                    ✅ PUSHÉ (via Tasklet)
├── c4-hub/                            ⬜ À générer
└── c5-v3-optim/                       ⬜ À générer
```

## 🔑 Pour reprendre

1. Relire ce RESUME.md pour le contexte
2. Relire `codegen-instructions.md` pour les specs détaillées de chaque commit
3. Les fichiers source originaux sont sur la branche `main`
4. Vague 1 (C1-C3) ✅ — continuer avec Vague 2 (C4 hub.js)
5. Continuer C4 → C9 en suivant les specs du codegen

# 🔄 KOMERCE — Plan de reprise Vague 1/2/3

> Dernière mise à jour : 7 avril 2026
> Ce dossier contient les instructions de codage + fichiers générés pour reprendre après coupure.

## 📋 PLAN DE MICRO-COMMITS

### ✅ VAGUE 1 — Socle Parcel-Centric (~22h estimé)

| # | Commit | Fichiers | Statut |
|---|--------|----------|--------|
| C1 | 🔐 Fix CORS whitelist (#74) | `server.js` | ✅ GÉNÉRÉ |
| C2 | 🔐 Add admin rate limiter (#75) | `middleware/rate-limit.js` | ✅ GÉNÉRÉ |
| C3 | 🔐 Gate admin reset in prod (#76) | `routes/admin.js` | ✅ GÉNÉRÉ |
| C4 | 🛠️ Fix logistics.js R1 violations | `routes/logistics.js` | ⬜ À CODER |
| C5 | 📦 Create routes/parcels.js CRUD | `routes/parcels.js` (new) | ⬜ À CODER |
| C6 | ✅ Add parcels + hub validators | `validators/index.js` | ⬜ À CODER |
| C7 | 🗃️ Migration 014 cleanup + indexes | `migrations/014_parcels_final_cleanup.sql` (new) | ⬜ À CODER |

### ⬜ VAGUE 2 — Hub Terrain

| # | Commit | Fichiers | Statut |
|---|--------|----------|--------|
| C8 | 🏭 Create routes/hub.js | `routes/hub.js` (new) | ⬜ À CODER |
| C9 | 🔌 Register parcels + hub in server.js | `server.js` | ⬜ À CODER |

### ⬜ VAGUE 3 — Optimisation Avancée

| # | Commit | Fichiers | Statut |
|---|--------|----------|--------|
| C10 | 🗃️ Migration 015 customs enrichment | `migrations/015_customs_enrichment.sql` (new) | ⬜ À CODER |
| C11 | 🗃️ Migration 016 carriers table | `migrations/016_carriers.sql` (new) | ⬜ À CODER |
| C12 | 🚚 Carrier CRUD + customs endpoints | `routes/carriers.js` (new) | ⬜ À CODER |
| C13 | 📊 Dashboard logistics costs | `routes/dashboard.js` modif | ⬜ À CODER |

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
│   ├── server.js                      ✅ CORS whitelist strict + adminLimiter
│   ├── middleware/rate-limit.js        ✅ adminLimiter ajouté
│   └── routes/admin.js                ✅ Guard production sur /reset
├── c2-logistics-r1/                   ⬜ À générer
├── c3-parcels-api/                    ⬜ À générer
├── c4-hub/                            ⬜ À générer
└── c5-v3-optim/                       ⬜ À générer
```

## 🔑 Pour reprendre

1. Relire ce RESUME.md pour le contexte
2. Relire `codegen-instructions.md` pour les specs détaillées de chaque commit
3. Les fichiers source originaux sont sur la branche `main`
4. Les fichiers C1 sont prêts à être review/commit
5. Continuer C4 → C13 en suivant les specs du codegen

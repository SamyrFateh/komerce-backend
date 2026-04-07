# Komerce Backend — Tasklet Resume

## Projet
Komerce — Backend e-commerce **parcel-centric** (Node.js / Express / PostgreSQL).
Repo: `SamyrFateh/komerce-backend` branche `main`.

## Architecture clé
- **R1**: orders.status = agrégation via `parcelSync.js`, jamais écrit directement
- **R2**: Hub opérateur : scan → pack → seal (3 actions)
- Parcel = source de vérité, pas les commandes

## État d'avancement

| Vague | Commits | Statut |
|-------|---------|--------|
| **Vague 1** — Socle Parcel-Centric | C1 (Security), C2 (Logistics R1), C3 (Parcels API), C3-bis (validators+migration) | ✅ Mergé |
| **Vague 2** — Hub Terrain | C4 (routes/hub.js), C5 (server.js câblage) | ✅ Mergé (PR #119) |
| **Vague 3** — Optimisation | C6 (migration customs), C7 (migration carriers), C8 (routes/carriers.js) | ✅ Mergé (PR #119) |
| **Hotfix** — SyntaxError L619 | Fix string escape Samsung seed | ✅ Mergé (PR #120) |
| **Safety** — Hub Safety Fixes | A (unique item), B (FOR UPDATE), C (one draft) | 🟡 PR #121 ouverte |
| **C9** — Dashboard logistics costs | Pas encore spécifié | ⬜ À définir |

## 🟡 En cours : Hub Safety Fixes (PR #121)

### 🔴 A. Contrainte UNIQUE sur parcel_items.order_item_id
- Migration `017_hub_safety_constraints.sql` : `ADD CONSTRAINT unique_order_item_per_parcel UNIQUE (order_item_id)`
- Code : `routes/parcels.js` POST `/:id/items` catch 23505 → 409

### 🔴 B. SELECT … FOR UPDATE dans hub.js (race condition)
- `routes/hub.js` : scan/pack/seal utilisent `db.getClient()` + `BEGIN` + `FOR UPDATE` + `COMMIT/ROLLBACK` + `client.release()`
- `safeSyncScanToParcels` appelé **après** commit

### 🟠 C. Un seul draft par commande
- Migration `017_hub_safety_constraints.sql` : `CREATE UNIQUE INDEX one_draft_per_order ON parcels(order_id) WHERE status = 'draft'`
- Code : `routes/parcels.js` POST `/` catch 23505 → 409

## ⬜ Prochaine action après merge : C9 — Dashboard logistics costs

Pas encore spécifié.

## Fichiers clés du repo

| Fichier | Rôle |
|---------|------|
| `server.js` | Point d'entrée, routes, seeds, CORS |
| `routes/hub.js` | Hub terrain (scan/pack/seal) |
| `routes/parcels.js` | CRUD parcels |
| `routes/carriers.js` | CRUD transporteurs + customs |
| `routes/scans.js` | Scan logistique |
| `routes/logistics.js` | Shipments + conteneurs |
| `utils/parcelSync.js` | SOURCE DE VÉRITÉ statut parcels/orders |
| `utils/parcels.js` | PARCEL_TYPES, STATUS_WEIGHT, helpers |
| `validators/index.js` | Schémas Joi |
| `middleware/auth.js` | JWT authenticate + requireRole |
| `middleware/validate.js` | Validation middleware |

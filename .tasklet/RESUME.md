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
| **Safety** — Hub Safety Fixes | A (unique item), B (FOR UPDATE), C (one draft) | ⬜ **À FAIRE** |
| **C9** — Dashboard logistics costs | Pas encore spécifié | ⬜ À définir |

## ⬜ Prochaine action : Hub Safety Fixes (A/B/C)

Créer une **PR** avec :

### 🔴 A. Contrainte UNIQUE sur parcel_items.order_item_id
Empêcher qu'un même article soit ajouté 2 fois dans un colis.

**Migration `017_hub_safety_constraints.sql`** :
```sql
ALTER TABLE parcel_items
  ADD CONSTRAINT unique_order_item_per_parcel UNIQUE (order_item_id);
```

**Code** : dans `routes/parcels.js` POST `/:id/items`, catch l'erreur `23505` (unique violation) et retourner 409.

### 🔴 B. SELECT … FOR UPDATE dans hub.js (race condition)
Empêcher 2 opérateurs de scanner le même colis en même temps.

**Code** : dans `routes/hub.js`, les 3 endpoints (scan/pack/seal) doivent :
1. `const client = await db.getClient()`
2. `BEGIN`
3. `SELECT ... FROM parcels WHERE ... FOR UPDATE`
4. Vérifier statut
5. `COMMIT` ou `ROLLBACK`
6. Appeler `safeSyncScanToParcels` après commit

Voir le fichier `hub.js` déjà préparé dans `/agent/home/komerce-output/routes/hub.js`.

### 🟠 C. Un seul draft par commande

**Migration `017_hub_safety_constraints.sql`** (même fichier) :
```sql
CREATE UNIQUE INDEX IF NOT EXISTS one_draft_per_order
  ON parcels (order_id)
  WHERE status = 'draft';
```

**Code** : dans `routes/parcels.js` POST `/`, catch l'erreur `23505` et retourner 409 "Un colis draft existe déjà pour cette commande".

## Fichiers déjà préparés localement

- `/agent/home/komerce-output/routes/hub.js` — hub.js avec FOR UPDATE (B) ✅
- `/agent/home/komerce-output/migrations/017_hub_safety_constraints.sql` — migration A+C ✅
- `routes/parcels.js` — doit être modifié pour catch 23505 (A+C)

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

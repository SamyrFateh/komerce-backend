# Komerce Backend — Tasklet Resume

## Projet
Komerce — Backend e-commerce **parcel-centric** (Node.js / Express / PostgreSQL).
Repo: `SamyrFateh/komerce-backend` branche `main`.

## Architecture clé
- **R1**: orders.status = agrégation via `parcelSync.js`, jamais écrit directement
- **R2**: Hub opérateur : scan → pack → seal (3 actions)
- Parcel = source de vérité, pas les commandes

## ⛔ VERROUS ABSOLUS (7 avril 2026)

### 🔴 VERROU 1 — HUB = IDIOT-PROOF

L'opérateur hub ne doit **JAMAIS** voir :
- ❌ La commande complète
- ❌ Le nombre total d'articles attendus
- ❌ Une notion de "reste à scanner"
- ❌ Une progression "3/5 articles"
- ❌ Le statut de la commande

**Pourquoi :** Ça casse le modèle asynchrone/partiel. L'opérateur essaie de "compléter" → erreur terrain.

**L'opérateur voit uniquement :** article scanné ✓, liste articles déjà scannés, ref colis draft, bouton SCELLER, stats session.

### 🔴 VERROU 2 — PIPELINE = ZÉRO LOGIQUE COMMANDE

Une carte pipeline ne doit **JAMAIS** dépendre du statut de la commande.
- ❌ "Commande en attente" / "Commande incomplète"
- ❌ Toute colonne basée sur `orders.status`
- ❌ Couleur/badge/tri basé sur le statut commande

**Pipeline = 100% driven par `parcels.status` :**
`draft → preparation → shipped → in_transit → arrived → available → collected → cancelled`

La commande liée = contexte secondaire (petit, gris, `#CMD-1234`), jamais conditionnelle.

## État d'avancement

| Vague | Commits | Statut |
|-------|---------|--------|
| **Vague 1** — Socle Parcel-Centric | C1 (Security), C2 (Logistics R1), C3 (Parcels API), C3-bis (validators+migration) | ✅ Mergé |
| **Vague 2** — Hub Terrain | C4 (routes/hub.js), C5 (server.js câblage) | ✅ Mergé (PR #119) |
| **Vague 3** — Optimisation | C6 (migration customs), C7 (migration carriers), C8 (routes/carriers.js) | ✅ Mergé (PR #119) |
| **Hotfix** — SyntaxError L619 | Fix string escape Samsung seed | ✅ Mergé (PR #120) |
| **Safety** — Hub Safety Fixes | A (unique item), B (FOR UPDATE), C (one draft) | ✅ PR #121 — DB appliquée (migrations 010→017) |
| **Refonte Dashboards** — UI Parcel-Centric | Verrous posés, spec complète | ⬜ À exécuter |

## ⬜ Prochaine action : Refonte Dashboards UI

Doc complet : `.tasklet/REFONTE_DASHBOARDS.md`

### Ordre d'exécution
1. `komerce-api.js` — couche API unifiée
2. `Komerce_Hub.html` — écran terrain ⛔ VERROU 1
3. `Komerce_Pipeline.html` — kanban parcel-centric ⛔ VERROU 2
4. `Komerce_Relais.html` — écran agent relais
5. `Komerce_Dashboard.html` — refonte pilotage
6. `Komerce_Admin.html` — refonte admin + absorption Users
7. `portal.html` — adaptation tuiles et rôles
8. Suppression fichiers obsolètes

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

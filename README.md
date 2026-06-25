# Komerce — Patch Pilotage & Gestion Colis

Archive à **dézipper par-dessus la racine de votre repo** (le dash vit dans `public/`,
donc tout est dans le même repo). Les fichiers `.js` sont des **versions complètes**
patchées : copier-remplacer, pas de merge manuel.

```
public/dashboards/admin/portal-pilotage.html   ← NOUVEAU  Portail de pilotage (porte d'entrée)
utils/parcelSync.js                            ← MODIFIÉ  + 1 INSERT parcel_events par transition
routes/hub-dashboard.js                        ← MODIFIÉ  ready/ship corrigés
migrations/094_parcel_reconciliation_view.sql  ← NOUVEAU  vue de réconciliation (lecture seule)
CHANGES.diff.md                                ← revue    diff des 2 fichiers .js (à ne PAS copier)
```

> `CHANGES.diff.md` est juste pour la revue de code / le message de commit. Ne le copiez pas dans le repo (ou supprimez-le après lecture).

---

## 1. Appliquer

```bash
# depuis la racine du repo, archive extraite à côté
cp -r komerce-pilotage-patch/public      ./
cp -r komerce-pilotage-patch/utils       ./
cp -r komerce-pilotage-patch/routes      ./
cp -r komerce-pilotage-patch/migrations  ./

# jouer la migration (adapter à votre runner habituel)
psql "$DATABASE_URL" -f migrations/094_parcel_reconciliation_view.sql
```

Vérif rapide : `node --check utils/parcelSync.js && node --check routes/hub-dashboard.js`

---

## 2. Ce qui change, et pourquoi

### Gestion colis — une seule voie d'écriture
- **`parcelSync.js`** : chaque transition de statut écrit désormais **une ligne dans `parcel_events`**
  (table déjà existante, migration 078). C'est le journal unique du cycle de vie du colis.
- **`hub-dashboard.js` → `ready`** : ne fait plus d'`UPDATE parcels` brut. Il passe par
  `safeSyncScanToParcels` (la source de vérité que `ship` utilise déjà) et **vérifie que TOUS
  les articles de la commande sont emballés**, pas juste « au moins un ».
- **`hub-dashboard.js` → `ship`** : **refuse un colis resté en `draft`** (le garde-fou que
  l'ancien commentaire prétendait faire mais ne faisait pas — c'était le seul vrai bug).
- On **arrête de logger les changements d'état dans `order_comments`** : les commentaires
  redeviennent humains, l'historique machine vit dans `parcel_events`.

Résultat : 3 chemins d'écriture → 1 seul. Moins de code, plus de traçabilité.

### Réconciliation — une vue, pas un job
`migrations/094` crée `v_parcel_reconciliation`. Aucun cron. La liste de travail :

```sql
SELECT parcel_ref, order_ref, parcel_status, order_status, issues
FROM   v_parcel_reconciliation
WHERE  cardinality(issues) > 0
ORDER  BY last_event_at NULLS FIRST;
```

Codes `issues` : `projection_vs_event_drift`, `shipped_incomplete`,
`order_ahead_of_parcel`, `no_seal`, `no_event_trace`.

---

## 3. Activer le portail comme porte d'entrée (3 branchements)

Le portail se sert sous `/dashboards/admin/portal-pilotage.html`. Il garde la session,
s'adapte au rôle (admin/finance/sourcing → cockpit Direction ; hub/relais/support → cockpit
opérationnel) et tire ses KPI de `/api/dashboard/ops` et `/api/dashboard/finance`
(repli démo propre si un appel échoue).

1. **`server.js`** — ajouter à l'allowlist du guard HTML :
   ```js
   '/dashboards/admin/portal-pilotage.html',
   ```
2. **`login.html`** — atterrissage post-login des rôles admin → ce portail
   (`next = '/dashboards/admin/portal-pilotage.html'`).
3. **SPA `app.js`** (`buildSidebarNav`) — un lien « 🏠 Portail » en tête vers la même URL,
   pour remonter à la vue d'ensemble depuis n'importe quel domaine.

Test rôles sans backend : `…/portal-pilotage.html?demo=hub` (ou `finance`, `sourcing`, `admin`).

---

## 4. Décision encore ouverte (métier, pas technique)

**Le scellé colis est-il obligatoire ou indicatif ?**
Aujourd'hui il est généré dans un `try/catch` silencieux : certains colis en ont, d'autres non,
sans alerte. Par défaut le patch laisse ça **indicatif** — la vue signale juste `no_seal`.
Si vous le voulez **obligatoire**, on ajoute une contrainte à la création du colis (dites-le).

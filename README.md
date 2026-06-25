# Komerce — Patch Pilotage · Gestion Colis · Gouvernance

Archive à **dézipper par-dessus la racine de votre repo** (le dash vit dans `public/`,
tout est le même repo). Les `.js`/`.sh` sont des **versions complètes** patchées :
copier-remplacer, pas de merge manuel.

```
public/dashboards/admin/portal-pilotage.html   NOUVEAU  Portail (porte d'entrée, rôle-aware, live)
utils/parcelSync.js                            MODIFIÉ  + 1 INSERT parcel_events (header déclaré)
routes/hub-dashboard.js                        MODIFIÉ  ready/ship corrigés
migrations/094_parcel_reconciliation_view.sql  NOUVEAU  vue de réconciliation (lecture seule)
scripts/setup-hooks.sh                         MODIFIÉ  pre-commit auto-déclare les headers (ferme le trou)
bootstrap/html-routes.js                       MODIFIÉ  raccourci URL /portail (et /pilotage)
docs/chantier/GATES_AUDIT.md                   NOUVEAU  audit des gates : chaque écart a une résolution connue
CHANGES.diff.md                                revue    diffs des fichiers patchés (ne PAS committer)
```

---

## 1. Appliquer

```bash
# depuis la racine du repo
cp -r komerce-pilotage-patch/{public,utils,routes,migrations,scripts,docs,bootstrap} ./
bash scripts/setup-hooks.sh                                   # régénère .git/hooks/pre-commit (auto-déclaration)
psql "$DATABASE_URL" -f migrations/094_parcel_reconciliation_view.sql
```

Vérif : `node --check utils/parcelSync.js && node --check routes/hub-dashboard.js && bash -n scripts/setup-hooks.sh`

> `CHANGES.diff.md` est pour la relecture / le message de commit. Ne le versionnez pas.

---

## 2. Gestion colis — une seule voie d'écriture, traçage complet

- **`parcelSync.js`** : chaque transition écrit une ligne `parcel_events` (table existante,
  mig. 078) -> journal unique. Header `@db-write` mis a jour.
- **`hub-dashboard.js -> ready`** : passe par `safeSyncScanToParcels` (source de verite que
  `ship` utilise deja) et verifie que **tous** les articles sont emballes.
- **`hub-dashboard.js -> ship`** : **refuse un colis reste `draft`** (le vrai bug corrige).
- Les etats ne sont plus loggues dans `order_comments` -> historique dans `parcel_events`.

Reconciliation = une vue, pas un job (`migrations/094`) :

```sql
SELECT parcel_ref, order_ref, parcel_status, order_status, issues
FROM   v_parcel_reconciliation
WHERE  cardinality(issues) > 0
ORDER  BY last_event_at NULLS FIRST;
```

---

## 3. Gouvernance — le trou comble

En ajoutant l'`INSERT parcel_events`, la gate « sous-declaration headers<->SQL » m'a bloque,
alors qu'un outil maison (`enrich-komerce-arch-db-fields.js`) sait deriver la declaration du
vrai SQL. Il n'etait pas dans la boucle pre-commit. Ce patch :

1. Ajoute une **etape 0** au pre-commit : `enrich --write` auto-declare les tables et
   re-stage **uniquement les fichiers du commit** -> sous-declaration auto-resolue.
2. Corrige le **message** de la gate -> `npm run arch:enrich:write`.

Matrice de **toutes** les gates (chaque ecart -> sa resolution) : **`docs/chantier/GATES_AUDIT.md`**.

Optionnel, un mot-cle pour tout auto-resoudre hors hook -- ajoutez a `package.json` :

```json
"gov:fix": "node scripts/enrich-komerce-arch-db-fields.js --write && node scripts/generate-komerce-arch-graph.js && node scripts/arch-reconcile.js --write"
```

---

## 4. Verifie contre les vraies gates

`arch-header-sql-check`, `arch-schema-drift-check`, `arch-db-check`,
`arch-doctrine-sanitize-check`, `audit-backend-arch` -> **tous verts** sur les fichiers patches.

**Migration 094 (Mode B, objet intended)** : ne pas l'ajouter a `docs/SCHEMA.md` a la main —
elle y entre apres deploiement via `schema-refresh.yml`. Ordre de deploiement a porter dans
`docs/chantier/STATUS.md` (texte fourni en fin de `GATES_AUDIT.md`).

---

## 5. Portail — activer comme porte d'entree (3 branchements manuels)

Sous `/dashboards/admin/portal-pilotage.html`, role-aware, KPI live via
`/api/dashboard/ops` + `/api/dashboard/finance` (repli demo propre).

1. **`server.js`** — allowlist guard HTML : `'/dashboards/admin/portal-pilotage.html',`
2. **`login.html`** — atterrissage post-login admin -> ce portail.
3. **`app.js` (`buildSidebarNav`)** — lien « Portail » en tete.

**Raccourci URL** (déjà inclus, `bootstrap/html-routes.js`) : le portail est servi sur
`https://komerce.co/portail` (alias `/pilotage`), en plus du chemin long.

Test roles sans backend : `…/portail?demo=hub` (ou `finance`, `sourcing`, `admin`).

---

## 6. Decision encore ouverte (metier)

**Scelle colis obligatoire ou indicatif ?** Par defaut indicatif (la vue signale `no_seal`
sans bloquer). Pour l'imposer : contrainte a la creation du colis — dites-le.

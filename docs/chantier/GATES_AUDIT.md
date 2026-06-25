# Audit des gates de gouvernance — résolution sous contrôle

Version : 2026-06 · Statut : appliqué (correctif inclus dans ce patch)

But : qu'**aucun blocage de gate ne soit jamais une impasse**. Chaque écart détecté
tombe dans une catégorie de résolution connue, avec une commande précise — et tout ce
qui *peut* être résolu par la machine l'est, pour ne laisser à l'humain que les vraies
décisions.

---

## 1. Modèle de contrôle — 4 catégories de résolution

Toute gate qui bloque renvoie vers **exactement une** de ces issues :

| # | Catégorie | Qui résout | Comment |
|---|-----------|-----------|---------|
| **A** | **Auto-résolu** (la machine corrige + re-stage) | hook | rien à faire, le commit repart |
| **B** | **Auto-résoluble par commande** | 1 commande | `npm run …:write` / `…:fix` puis re-commit |
| **C** | **Acquittement baseline** (baisse légitime décidée par un humain) | 1 commande | `npm run …:save` — n'auto-masque jamais une *nouvelle* dette |
| **D** | **Vrai correctif** (code/échappement/SQL) | humain | la gate dit quoi corriger |

Principe directeur, déjà présent dans le repo : **résoudre = automatique, supprimer =
humain**. `arch-reconcile` abaisse un cliquet quand une fiction disparaît, mais ne
*relève* jamais un cliquet et n'*ajoute* jamais à l'allowlist → une nouvelle dette reste
bloquante (pas d'auto-masquage).

---

## 2. Matrice des gates

### Pre-commit (`.git/hooks/pre-commit`, généré par `scripts/setup-hooks.sh`)

| Étape | Gate | Déclencheur | Bloque ? | Catégorie | Résolution |
|------|------|-------------|:--------:|:---------:|-----------|
| 0 | **enrich headers←SQL** | toujours | non | **A** | auto-déclare `@db-read/@db-write` depuis le vrai SQL + re-stage *(ajouté par ce patch)* |
| 1 | regen graphe archi | toujours | non | **A** | régénère `komerce-arch-header-graph.{json,md}` + re-stage |
| 2 | `arch-reconcile --write` | toujours | non | **A** | élague fictions résolues, abaisse cliquets + re-stage |
| 4 | `arch-db-check` (hygiène headers) | header invalide / sans owner | oui | **D** | `npm run arch:check` |
| 5 | `arch-schema-drift-check` | SCHEMA.md ↔ DB live | oui | **B/C/D** | fiction=bug (**D**) · fantôme=retirer de SCHEMA.md (**D**) · cliquet=`arch:reconcile:write` (**B**) |
| 6 | `arch-header-sql-check` | sous-déclaration table | oui | **B** | **`npm run arch:enrich:write`** *(hint corrigé)* — ne devrait plus bloquer car l'étape 0 l'auto-résout |
| 7 | `arch-doctrine-sanitize-check` | entrée externe rendue sans échappement | oui | **D** | `npm run arch:doctrine` → `sanitize()/escapeHtml()` |
| 8 | `audit-backend-arch` | SQL non paramétré · owner `payment_status` · auth admin | oui | **D** | `npm run backend:audit` |
| 9a | deploy-css boutique | bundle CSS modifié | non | **A** | rebuild dist + `?v=` + cache-buster + re-stage |
| 9b | `check:fast` boutique | invariants CSS/HTML | oui | **D** | `(cd public/boutique && npm run check:fast)` |
| 10 | `dashboards:360 --check` | chaîne route→vue→KmcApi→endpoint | oui | **C/D** | relier la chaîne (**D**) ou `npm run dashboards:360:save` (**C**) |
| 11 | `boutique:360 --check` | bus + endpoints↔OpenAPI | oui | **C/D** | corriger (**D**) ou `npm run boutique:360:save` (**C**) |
| 12 | `meta:graph --check` | couture fantôme cross-front | oui | **C/D** | corriger l'appel (**D**) ou `npm run meta:graph:save` (**C**) |

### Pre-push (`coffre-fort`)

| Gate | Déclencheur | Bloque ? | Catégorie | Résolution |
|------|-------------|:--------:|:---------:|-----------|
| `impact-check` | score de risque du diff | SAFE→non · REVIEW→confirm · BLOCK→oui | **D** | corriger le risque · `git push --no-verify` (urgence) |

### CI / pipeline schéma (GitHub Actions)

| Gate | Déclencheur | Catégorie | Résolution |
|------|-------------|:---------:|-----------|
| `schema-refresh.yml` (`db-snapshot` + `check-schema-freshness`) | push sur `migrations/` | **A** | dump live régénéré → PR auto `chore/schema-refresh-auto` |
| `ci.yml` (load dump + `ci-migrate`) | push/PR | **D** | rejoue uniquement les migrations postérieures au dump |
| `audit:gate` (`npm-audit-gate.js`) | vulnérabilité npm | **B/D** | corriger / exception dans `npm-audit-exceptions.json` |

---

## 3. Le trou identifié (et pourquoi je l'ai heurté)

**Constat.** En ajoutant un `INSERT INTO parcel_events`, j'ai été bloqué par l'étape 6
(sous-déclaration). Or l'outil qui dérive `@db-read/@db-write` du vrai SQL —
`enrich-komerce-arch-db-fields.js` — **existe déjà** et fait exactement ce travail. Il
était simplement relégué à un workflow GitHub one-shot, **absent de la boucle pre-commit
locale**, et **non mentionné dans le message de la gate**. Résultat : un cas
auto-résoluble (catégorie B) se présentait comme un mur à éditer à la main.

**Preuve.** Sur le fichier patché, header privé de `parcel_events` :

```
$ node scripts/enrich-komerce-arch-db-fields.js --write
$ grep '@db-write' utils/parcelSync.js
 * @db-write      alerts, parcel_events, parcels, scans   ← ré-ajouté automatiquement
```

**Correctif (inclus dans ce patch — `scripts/setup-hooks.sh`)** :

1. **Étape 0 ajoutée au pre-commit** : `enrich --write` tourne *avant* la regen du graphe
   et re-stage **uniquement les fichiers déjà dans le commit** (aucun effet de bord). La
   sous-déclaration devient donc **catégorie A (auto-résolu)** : l'étape 6 ne bloquera
   plus pour ce motif.
2. **Message de la gate 6 corrigé** : il pointe désormais vers l'auto-fix
   `npm run arch:enrich:write` (au cas où l'étape 0 serait contournée, ex. `--no-verify`).

**À activer** : `bash scripts/setup-hooks.sh` (régénère `.git/hooks/pre-commit`).

> Optionnel — un seul mot-clé pour tout auto-résoudre hors hook (utile en CI ou manuel) :
> ajoutez à `package.json` →
> `"gov:fix": "node scripts/enrich-komerce-arch-db-fields.js --write && node scripts/generate-komerce-arch-graph.js && node scripts/arch-reconcile.js --write"`

---

## 4. Vérification du patch courant (gestion colis + portail)

Lancé contre les vraies gates, fichiers patchés en place :

```
arch-header-sql-check     → 0 sous-déclaration, cliquet 0           ✅
arch-schema-drift-check   → aucun drift bloquant                    ✅
arch-db-check             → hygiène headers verte                   ✅
arch-doctrine-sanitize    → aucune entrée non échappée              ✅
audit-backend-arch        → invariants backend verts                ✅
```

- `utils/parcelSync.js` : `@db-write` déclare bien `parcel_events` (le nouvel `INSERT`).
- `routes/hub-dashboard.js` : ne lit que des tables déjà déclarées ; aucun header à changer.
- `public/dashboards/admin/portal-pilotage.html` : asset statique, hors périmètre des
  headers `@komerce-arch` et de la carte 360 (non enregistré comme route SPA).

**Migration `094_parcel_reconciliation_view.sql` (nouvel objet DB — Mode B)** : la vue
n'est référencée par aucun header et n'est pas encore dans le dump live, donc invisible
aux gates locales (ni fiction, ni fantôme). Conformément à la doctrine, elle entre dans
`docs/SCHEMA.md` **après déploiement**, via le pipeline `schema-refresh.yml` (jamais à la
main). Note d'ordre de déploiement à porter dans `docs/chantier/STATUS.md` :

```
- migration 094 (vue v_parcel_reconciliation) : objet INTENDED, non vérifié live.
  Ordre : (1) apply migration → (2) deploy → (3) schema-refresh.yml régénère le dump
  → (4) SCHEMA.md reflète la vue (verified live). Pas d'ajout manuel à SCHEMA.md avant (4)
  sinon fantôme bloquant sur arch:drift.
```

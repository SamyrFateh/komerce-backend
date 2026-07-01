# Audit feature-par-feature — Doctrine unifiée (boutique · backend · dashboards)

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

> Statut : proposition exécutable (v1). Brique : `scripts/feature-audit.js`.
> Prérequis conceptuel : `docs/doctrine/FEATURE_DOCTRINE.md`, `features/*.feature.js`.

## 1. Le problème que cet audit ferme

La modal produit a cassé (le `display:grid` du product-zone supprimé par la
normalisation) **et tous les gates sont restés verts**. Raison de fond :

> Tous les gates actuels sont **globaux** et **négatifs** — ils vérifient
> l'*absence* de mauvais (pas de `var`, pas de `!important` hors baseline, pas
> de conflit de cascade, pas d'injection, ownership respecté). Une règle
> **supprimée** ne crée aucune violation, aucun conflit, aucune hausse → vert.

`css-guard` attrape les doublons (conflits), jamais les trous. Et le seul gate
qui rendait vraiment la page — l'e2e Playwright — tournait dans le vide
(`tests/` supprimé, `testDir` vide). Pire : même restauré, l'ancien e2e testait
« la modal s'ouvre / le nom est là », **jamais** « le layout est en grille ».

Il manque une seule dimension : des contrats **par feature** et **positifs**,
qui *affirment* qu'une invariante tient. Une suppression casse l'affirmation.

## 2. Une seule doctrine, trois déclinaisons

L'observation clé : **tes manifestes `*.feature.js` traversent déjà les couches.**
`catalog`, `logistics`, `payments`, `shared-cart`, `wallet` déclarent des
fichiers `boutique` ; `dashboard` déclare des fichiers `dash`. La boutique et les
dashboards ne sont pas des mondes séparés : ce sont les **couches frontend de
features backend**.

Donc on ne fait pas trois audits. On fait **un** audit, où chaque feature porte
les contrats correspondant aux couches qu'elle possède. La « spécificité » d'un
domaine n'est rien d'autre que le **type de contrat** :

| Couche possédée | Spécificité = contrats applicables |
|---|---|
| `services` / `routes` | `boundary` (périmètre métier), `interface` (endpoints câblés), `files-exist` |
| `boutique` | `render-static` (règle de rendu présente), `cascade` (0 conflit css-guard), `doctrine` (dette token, cliquet) |
| `dash` | `render-static` (écran monté) + `boundary` (lecture seule) — l'hybride |

Le manifeste **déclare** quels contrats s'appliquent ; le runner **dispatche**.
Aucun gate n'est réimplémenté : le runner les **orchestre par feature**.

## 3. Taxonomie des contrats (les checkers)

| Contrat | Affirme | Domaines | Étage |
|---|---|---|---|
| `files-exist` | tout fichier déclaré existe (manifeste pas périmé / fichier non déplacé en douce) | tous | statique |
| `render-static` | une règle de rendu requise est présente dans l'artefact livré | boutique, dash | statique |
| `cascade` | 0 conflit de cascade dans la CSS possédée (réutilise css-guard) | boutique, dash | statique |
| `doctrine` | dette de littéraux couleur scopée à la feature, sous **cliquet** (hausse = FAIL) | boutique, dash | statique |
| `boundary` | les fichiers possédés ne contiennent pas de motif interdit (ex: dashboard lecture-seule = 0 écriture SQL) | backend, dash | statique |
| `interface` | les endpoints `contract.exposes` sont réellement câblés dans les routes possédées | backend, dash | statique |
| *(contracts.spec)* | la règle **prend effet** dans un vrai navigateur (`display:grid` calculé) | boutique, dash | **dynamique** |

Statuts : `PASS` · `FAIL` (bloquant en `--strict`) · `SKIP` (cible absente du
checkout — informatif, jamais bloquant) · `WARN` (dette sous cliquet, pas une
régression).

## 4. Deux étages, branchés là où ils ont du sens

- **Statique** — `node scripts/feature-audit.js --strict`. Pur-node, rapide.
  Entre dans `check:fast` (pre-commit local **et** job CI `boutique-quality`).
  C'est lui qui aurait bloqué la suppression du grid **au commit**.
- **Dynamique** — `tests/contracts.spec.js` (Playwright). Rend la page, lit le
  `display` calculé. Tourne dans un **job CI dédié** (serveur + navigateur),
  hors `check:fast`. C'est l'e2e qui ne doit plus jamais tourner dans le vide.

## 5. Ajouter un contrat à une feature

Dans le manifeste, un bloc `contracts:` (voir `dashboard.feature.js` et
`public/boutique/features/modal-product.feature.js` pour des exemples réels) :

```js
contracts: {
  'render-static': [{
    artifact: '../css/dist/components.css',
    label:    'product-zone desktop = grid',
    mustContain: [ /#k-modal\s+\.k-modal-product-zone\s*\{[^}]*display:\s*grid/m ],
  }],
  doctrine: { scope: 'boutique', max: 21 },   // cliquet figé à la réalité
  boundary: { scope: 'services', forbid: [
    { rx: /\b(INSERT INTO|UPDATE|DELETE FROM)\b/i, why: 'écriture dans une feature lecture-seule' },
  ]},
}
```

Doctrine de cliquet (identique à css-guard / check-important) : on **fige l'état
réel** (`max`), toute **hausse** bloque, une **baisse** est acceptée et peut être
re-figée. On ne bloque pas sur la dette existante (les ~51 littéraux token, les
294 rgba cosmétiques), on **empêche qu'elle grossisse**, feature par feature.

## 6. Câblage (à appliquer dans le repo réel)

`package.json` (racine) :
```json
"audit:features":        "node scripts/feature-audit.js --strict",
"audit:features:report": "node scripts/feature-audit.js"
```
- Ajouter `audit:features` dans la chaîne `check:fast` (donc pre-commit + job CI
  `boutique-quality`).
- **Restaurer** `public/boutique/tests/boutique.spec.js` (supprimé) et ajouter
  `tests/contracts.spec.js` ; les câbler dans un **job CI e2e dédié** (le trou
  identifié : `check:fast` exclut volontairement Playwright).
- Corriger les deux angles morts notés en backlog : parseur multi-lignes de
  `css-guard.js`, et l'ancien `public/boutique/.github/workflows/ci.yml` mort.

## 7. Ce qui tourne aujourd'hui vs dans le repo complet

Vérifié et exécuté dans ce bac à sable (boutique présente) :
- `modal-product` : `render-static` **FAIL sur l'archive cassée, PASS sur le
  patch** — la brique attrape exactement la régression que les 12 autres gates
  loupaient. `doctrine` mesure 21 littéraux (cliquet figé).
- Les 16 features backend : **SKIP propre** (`services/`, `routes/`, `dash/`
  absents de ce zip) — aucune fausse alerte.
- Multipropriété transverse : 0 fichier possédé par 2 features.

Dans ton repo complet, les `SKIP` s'allument : `boundary` lira les services
dashboard, `interface` vérifiera les routes, `render-static` lira les écrans
`dashboards/admin/*.html`. La même commande, le même scorecard, les trois mondes.

# Guide de Contribution — Komerce Backend

## Protocole obligatoire avant toute modification

**Lire ces fichiers dans l'ordre. Pas de raccourci.**

| # | Fichier | Pourquoi |
|---|---|---|
| 1 | [`AGENTS.md`](./AGENTS.md) | Point d'entrée obligatoire agent/dev |
| 2 | [`docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md) | Doctrine graphe obligatoire pour tout changement fonctionnel |
| 3 | [`docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`](./docs/KOMERCE_DB_SCHEMA_DOCTRINE.md) | Doctrine DB obligatoire pour tout changement de schéma |
| 4 | [`docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`](./docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md) | Couverture, dette, règles de cartographie |
| 5 | [`docs/KOMERCE_ARCH_HEADER_GRAPH.md`](./docs/KOMERCE_ARCH_HEADER_GRAPH.md) | Graphe lisible d'intervention |
| 6 | [`docs/komerce-arch-header-graph.json`](./docs/komerce-arch-header-graph.json) | Graphe machine-readable et `interventionIndex` |
| 7 | [`docs/SCHEMA.md`](./docs/SCHEMA.md) | Schéma DB canonique |
| 8 | [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) | État du jour + prochain lot + pièges critiques |
| 9 | [`docs/CARTOGRAPHY_360.md`](./docs/CARTOGRAPHY_360.md) | Quoi existe : routes, domaines API, env vars |
| 10 | [`docs/ZONE_IMPACT.md`](./docs/ZONE_IMPACT.md) | Quoi protéger : invariants |
| 11 | [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) | Qui appelle quoi : signatures des services critiques |

**Si la PR touche `public/boutique/**`** : lire aussi [`public/boutique/README.md`](./public/boutique/README.md) et [`docs/boutique/README.md`](./docs/boutique/README.md).

---

## Workflow

### 1. Lire le socle

```txt
AGENTS.md -> ARCH_GRAPH_DOCTRINE -> DB_SCHEMA_DOCTRINE -> graph/status/schema -> STATUS.md -> docs de zone
```

### 2. Coder

- Respecter les invariants (`ZONE_IMPACT.md`).
- Toute transition de statut commande passe par `services/order-status-machine.js`.
- Toute mutation de paiement passe par les services propriétaires documentés.
- SQL paramétré uniquement.
- `authenticate` + `requireRole` sur toutes les routes sensibles.
- Pas de secret en dur.
- try/catch sur toutes les routes.

### 3. Mettre à jour la cartographie dans la même PR

| Type de modification | Cartographie obligatoire |
|---|---|
| Nouveau fichier source | Ajouter `@komerce-arch` ou `@komerce-arch-lite` |
| Modification fonctionnelle | Mettre à jour les champs du header concernés |
| Nouvel accès DB | Mettre à jour `@db-read`, `@db-write`, `@db-txn` |
| Suppression/fusion fichier | Nettoyer `@depends`, `@used-by`, `@owner` |
| Nouveau flux métier | Mettre à jour `@doctrine` et `@impact-areas` |

Puis régénérer :

```bash
node scripts/generate-komerce-arch-graph.js
```

Vérifier :

- `files without headers: 0`
- `lite headers without owner: 0`
- nouveaux edges cohérents
- aucun lien mort après suppression/fusion

### 4. Mettre à jour le schéma DB dans la même PR

| Type de modification DB | Obligatoire |
|---|---|
| Nouvelle table/colonne/enum/index/trigger/fonction/contrainte | Migration idempotente + `docs/SCHEMA.md` + headers DB |
| Changement de type/nullabilité/FK/check/trigger | Plan migration/backfill + `docs/SCHEMA.md` + headers lecteurs/écrivains |
| Suppression/renommage DB | Preuve absence références code/headers/docs + plan compatibilité |
| Nouvel accès DB depuis code | `@db-read`, `@db-write`, `@db-txn` mis à jour |

Appliquer `docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`.

### 5. Mettre à jour le socle documentaire

| Type de modification | Documents à mettre à jour |
|---|---|
| Ajout/suppression d'une route | `CARTOGRAPHY_360.md` si encore concerné + graphe architecture |
| Nouveau statut, transition, source de paiement | `ZONE_IMPACT.md`, `CONTRACTS.md`, headers et graphe |
| Fichier à haut risque modifié | `ZONE_IMPACT.md` + header du fichier |
| Migration SQL | `SCHEMA.md` + `KOMERCE_DB_SCHEMA_DOCTRINE.md` si règle nouvelle + headers DB concernés |
| Signature de service critique modifiée | `CONTRACTS.md` + `@inputs/@outputs/@used-by` |
| Nouvel invariant | `ZONE_IMPACT.md` + `@doctrine` |

### 6. Mettre à jour STATUS.md

Avant tout commit :

- cocher le lot terminé si applicable ;
- mettre à jour le prochain lot si applicable ;
- ajouter toute divergence doc/code/DB dans les pièges critiques ;
- documenter l'ordre migration/deploy si la production est impactée.

### 7. Créer la PR

- Lister les fichiers modifiés et leur impact.
- Indiquer les invariants concernés.
- Indiquer les headers/cartographies mis à jour.
- Indiquer les docs socle mises à jour.
- Indiquer les migrations et vérifications DB.

---

## Ce qui bloque une PR

| Motif | Exemple |
|---|---|
| Doctrine graphe non consultée | Changement fonctionnel sans lire `KOMERCE_ARCH_GRAPH_DOCTRINE.md` |
| Doctrine DB non consultée | Migration sans lire `KOMERCE_DB_SCHEMA_DOCTRINE.md` |
| Header absent | Nouveau fichier source sans `@komerce-arch` ou `@komerce-arch-lite` |
| Graphe non régénéré | Nouveau fichier ou lien sans `node scripts/generate-komerce-arch-graph.js` |
| SCHEMA non mis à jour | Migration SQL sans mise à jour de `docs/SCHEMA.md` |
| Headers DB non mis à jour | Nouveau `SELECT/INSERT/UPDATE/DELETE` sans `@db-read/@db-write/@db-txn` |
| Socle non mis à jour | Nouvelle route absente des docs actives ou du graphe |
| STATUS.md non mis à jour | Lot terminé non coché, prochain lot non renseigné |
| SQL non paramétré | `WHERE id = ${id}` au lieu de `WHERE id = $1` |
| Transition de statut hors machine | `orders.status` modifié hors `order-status-machine.js` |
| Route sans auth | Endpoint admin sans `requireRole(['admin'])` |
| Secret en dur | `JWT_SECRET = 'mysecret'` dans le code |
| Pas de try/catch | Route sans gestion d'erreur |
| PR Boutique sans lire les README Boutique | `public/boutique/**` modifié sans lire les points d'entrée Boutique |

---

## Structure du projet

```txt
komerce-backend/
├── AGENTS.md
├── README.md
├── CONTRIBUTING.md
├── server.js
├── db.js
├── routes/
├── services/
├── middleware/
├── utils/
├── validators/
├── db/
├── public/boutique/
│   ├── README.md
│   ├── js/
│   ├── css/
│   └── docs/
└── docs/
    ├── KOMERCE_ARCH_GRAPH_DOCTRINE.md
    ├── KOMERCE_DB_SCHEMA_DOCTRINE.md
    ├── KOMERCE_ARCH_CARTOGRAPHY_STATUS.md
    ├── KOMERCE_ARCH_HEADER_GRAPH.md
    ├── komerce-arch-header-graph.json
    ├── SCHEMA.md
    ├── CARTOGRAPHY_360.md
    ├── ZONE_IMPACT.md
    ├── CONTRACTS.md
    ├── chantier/STATUS.md
    ├── boutique/
    ├── doctrine/
    └── _archive/
```

---

## En cas de doute

- **Conflit doc/code** : appliquer `AGENTS.md` et documenter la divergence.
- **Tu ne sais pas où ajouter ton code** : lire le graphe puis `interventionIndex`.
- **Tu ne sais pas si une table existe** : lire `SCHEMA.md`, puis mettre à jour les headers DB concernés.
- **Tu modifies le schéma DB** : lire `KOMERCE_DB_SCHEMA_DOCTRINE.md` avant d'écrire la migration.
- **Tu touches Boutique** : lire `docs/boutique/README.md` et `public/boutique/README.md`.

> Une PR qui modifie le comportement ou le schéma DB sans mettre à jour la cartographie architecture et le schéma canonique est à refuser ou à marquer comme dette explicite avant merge.
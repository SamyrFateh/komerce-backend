# Guide de Contribution — Komerce Backend

## Protocole obligatoire avant toute modification

**Lire ces fichiers dans l'ordre. Pas de raccourci.**

| # | Fichier | Pourquoi |
|---|---|---|
| 1 | [`AGENTS.md`](./AGENTS.md) | Point d'entrée obligatoire agent/dev |
| 2 | [`docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md) | Doctrine graphe obligatoire pour tout changement fonctionnel |
| 3 | [`docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`](./docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md) | Couverture, dette, règles de cartographie |
| 4 | [`docs/KOMERCE_ARCH_HEADER_GRAPH.md`](./docs/KOMERCE_ARCH_HEADER_GRAPH.md) | Graphe lisible d'intervention |
| 5 | [`docs/komerce-arch-header-graph.json`](./docs/komerce-arch-header-graph.json) | Graphe machine-readable et `interventionIndex` |
| 6 | [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) | État du jour + prochain lot + pièges critiques |
| 7 | [`docs/CARTOGRAPHY_360.md`](./docs/CARTOGRAPHY_360.md) | Quoi existe : routes, domaines API, env vars |
| 8 | [`docs/ZONE_IMPACT.md`](./docs/ZONE_IMPACT.md) | Quoi protéger : invariants |
| 9 | [`docs/SCHEMA.md`](./docs/SCHEMA.md) | Quoi est vrai en base |
| 10 | [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) | Qui appelle quoi : signatures des services critiques |

**Si la PR touche `public/boutique/**`** : lire aussi [`public/boutique/README.md`](./public/boutique/README.md) et [`docs/boutique/README.md`](./docs/boutique/README.md).

---

## Workflow

### 1. Lire le socle

```txt
AGENTS.md -> KOMERCE_ARCH_GRAPH_DOCTRINE -> graph/status -> STATUS.md -> docs de zone
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

### 4. Mettre à jour le socle documentaire

| Type de modification | Documents à mettre à jour |
|---|---|
| Ajout/suppression d'une route | `CARTOGRAPHY_360.md` si encore concerné + graphe architecture |
| Nouveau statut, transition, source de paiement | `ZONE_IMPACT.md`, `CONTRACTS.md`, headers et graphe |
| Fichier à haut risque modifié | `ZONE_IMPACT.md` + header du fichier |
| Migration SQL | `SCHEMA.md` + headers DB concernés |
| Signature de service critique modifiée | `CONTRACTS.md` + `@inputs/@outputs/@used-by` |
| Nouvel invariant | `ZONE_IMPACT.md` + `@doctrine` |

### 5. Mettre à jour STATUS.md

Avant tout commit :

- cocher le lot terminé si applicable ;
- mettre à jour le prochain lot si applicable ;
- ajouter toute divergence doc/code/DB dans les pièges critiques.

### 6. Créer la PR

- Lister les fichiers modifiés et leur impact.
- Indiquer les invariants concernés.
- Indiquer les headers/cartographies mis à jour.
- Indiquer les docs socle mises à jour.

---

## Ce qui bloque une PR

| Motif | Exemple |
|---|---|
| Doctrine graphe non consultée | Changement fonctionnel sans lire `KOMERCE_ARCH_GRAPH_DOCTRINE.md` |
| Header absent | Nouveau fichier source sans `@komerce-arch` ou `@komerce-arch-lite` |
| Graphe non régénéré | Nouveau fichier ou lien sans `node scripts/generate-komerce-arch-graph.js` |
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
    ├── KOMERCE_ARCH_CARTOGRAPHY_STATUS.md
    ├── KOMERCE_ARCH_HEADER_GRAPH.md
    ├── komerce-arch-header-graph.json
    ├── CARTOGRAPHY_360.md
    ├── ZONE_IMPACT.md
    ├── SCHEMA.md
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
- **Tu touches Boutique** : lire `docs/boutique/README.md` et `public/boutique/README.md`.

> Une PR qui modifie le comportement sans mettre à jour la cartographie architecture est à refuser ou à marquer comme dette explicite avant merge.
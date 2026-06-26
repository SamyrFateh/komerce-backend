# Komerce — Documentation opératoire

> Mis à jour : **2026-06-26**
> Règle : ce fichier est l'index actif. Tout document non listé ici est historique.

---

## 0. Gouvernance complète — pipeline visible

Tout le câblage de gouvernance est documenté dans [`AGENTS.md`](../AGENTS.md) section 0.
Ce qui est vérifié automatiquement en CI et au deploy :

| Niveau | Gate | Commande | Scope |
|--------|------|----------|-------|
| N0 | Registre features | `npm run feature:registry` | 14 features métier, 240 fichiers, 0 orphelin |
| N5 | Feature slice | `npm run feature:guard` | Cohérence manifest ↔ disque |
| N4 | Architecture | `npm run arch:gate` | Headers @komerce-arch, graphe |
| N3 | Schema DB | `npm run arch:drift` | Alignement SCHEMA.md ↔ DB |
| N2 | Code quality | `npm run quality:gate` | strict, const/let, SQL, secrets |
| N1 | Dependencies | `npm run audit:gate` | npm audit high/critical |
| N1 | Tests | `npm test` | Unit + integration |
| CSS | CSS boutique | `npm run css:guard` | 0 conflit cascade (build Railway) |

Toutes les portes sont vertes. Aucune dette non documentée.

---

## 1. Lecture obligatoire minimale

Pour toute nouvelle session, lire dans cet ordre :

| # | Document | Rôle |
|---|----------|------|
| 1 | [`AGENTS.md`](../AGENTS.md) | Règles obligatoires + pyramide de gouvernance |
| 2 | [`docs/doctrine/FEATURE_DOCTRINE.md`](./doctrine/FEATURE_DOCTRINE.md) | Sommet : qu'est-ce qu'une feature métier |
| 3 | [`docs/doctrine/APP_FEATURE_REGISTRY.md`](./doctrine/APP_FEATURE_REGISTRY.md) | Registre exhaustif des 16 features |
| 4 | [`docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./KOMERCE_ARCH_GRAPH_DOCTRINE.md) | Doctrine graphe architecture |
| 5 | [`docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`](./KOMERCE_DB_SCHEMA_DOCTRINE.md) | Doctrine schéma DB |
| 6 | [`docs/SCHEMA.md`](./SCHEMA.md) | Schéma DB canonique |
| 7 | [`docs/chantier/STATUS.md`](./chantier/STATUS.md) | État courant, dettes ouvertes |

Ces documents suffisent pour reprendre le projet sans lire l'historique.

---

## 2. Doctrines actives

| Doctrine | Fichier | Gate associé |
|----------|---------|-------------|
| Feature (N0) | [`FEATURE_DOCTRINE.md`](./doctrine/FEATURE_DOCTRINE.md) | `feature:registry` |
| Feature Slice (N5) | [`FEATURE_SLICE_DOCTRINE.md`](./doctrine/FEATURE_SLICE_DOCTRINE.md) | `feature:guard` |
| Pyramide Qualité (N2) | [`QUALITY_PYRAMID_DOCTRINE.md`](./doctrine/QUALITY_PYRAMID_DOCTRINE.md) | `quality:gate` |
| Graphe Architecture (N4) | [`KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./KOMERCE_ARCH_GRAPH_DOCTRINE.md) | `arch:gate` |
| Schéma DB (N3) | [`KOMERCE_DB_SCHEMA_DOCTRINE.md`](./KOMERCE_DB_SCHEMA_DOCTRINE.md) | `arch:drift` |
| Panier partagé | [`PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) | — |
| Douane | [`DOUANE_DECLARATION_PIVOT.md`](./doctrine/DOUANE_DECLARATION_PIVOT.md) | — |
| Moteur économique | [`MOTEUR_ECONOMIQUE_ALLOCATION.md`](./doctrine/MOTEUR_ECONOMIQUE_ALLOCATION.md) | — |

Chaque doctrine avec un gate associé est **vérifiée automatiquement en CI**.
Les doctrines sans gate sont des guides de décision, pas des contraintes automatisées.

---

## 3. Décisions architecturales

| Décision | Fichier |
|----------|---------|
| Groupe C — 12 décisions archi dures | [`DECISIONS_ARCHI_GROUPE_C.md`](./doctrine/DECISIONS_ARCHI_GROUPE_C.md) |
| Certification doctrine feature | [`CERTIFICATION_DOCTRINE_FEATURE.md`](./doctrine/CERTIFICATION_DOCTRINE_FEATURE.md) |

---

## 4. Socle technique de référence

| Besoin | Document actif |
|--------|---------------|
| Graphe architecture lisible | [`KOMERCE_ARCH_HEADER_GRAPH.md`](./KOMERCE_ARCH_HEADER_GRAPH.md) |
| Graphe machine-readable | [`komerce-arch-header-graph.json`](./komerce-arch-header-graph.json) |
| Cartographie 360° | [`CARTOGRAPHY_360.md`](./CARTOGRAPHY_360.md) |
| Invariants et fichiers sensibles | [`ZONE_IMPACT.md`](./ZONE_IMPACT.md) |
| Contrats de services | [`CONTRACTS.md`](./CONTRACTS.md) |
| Sécurité backend | [`backend/SECURITY-MODEL.md`](./backend/SECURITY-MODEL.md) |
| Déploiement | [`ops/DEPLOYMENT.md`](./ops/DEPLOYMENT.md) |
| Spec douane | [`specs/SPEC_KEYSTONE_DOUANE.md`](./specs/SPEC_KEYSTONE_DOUANE.md) |

---

## 5. Boutique

| Document | Rôle |
|----------|------|
| [`public/boutique/README.md`](../public/boutique/README.md) | Index boutique |
| Ownership auto-généré | `BOUTIQUE_OWNERSHIP_LIVE.md` + `BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| CSS Guardian | `public/boutique/scripts/css-guard.js` (baseline 0, câblé Railway) |

---

## 6. Hiérarchie documentaire

En cas de conflit :
1. Code de production
2. DB live
3. `AGENTS.md`
4. Ce fichier (`docs/README.md`)
5. Documents actifs listés ici
6. Archives

# Komerce — Documentation opératoire

> Statut : vivant, mais ce fichier n'est plus la porte d'entrée agent.
> Porte d'entrée unique : [`docs/INDEX.md`](./INDEX.md).

## Règle carte-first

Tout agent ou développeur commence par :

1. `AGENTS.md`
2. `docs/INDEX.md`
3. la carte `features/<feature>.feature.js` ou le transversal concerné

Ce fichier reste un index opératoire secondaire. Il ne doit plus être utilisé comme premier document de session.

## Gates actifs

| Niveau | Gate | Commande |
|--------|------|----------|
| Feature registry | Registre features | `npm run feature:registry` |
| Feature cards | Cartes bootstrap | `npm run feature:cards` |
| Touched files | Fichiers touchés → carte | `npm run feature:touched` |
| Docs hygiene | Anti-bruit historique docs touchées | `npm run docs:history-lint` |
| Feature slice | Cohérence manifest ↔ disque | `npm run feature:check` |
| Architecture | Headers + graphe | `npm run arch:gate` |
| Schema DB | Alignement schema | `npm run arch:drift` |
| Quality | Qualité code | `npm run quality:gate` |
| Dependencies | Audit npm | `npm run audit:gate` |
| Map | Reconstruction globale | `npm run map:check` |
| CSS boutique | CSS guard | `npm run css:guard` |

## Doctrines actives

| Doctrine | Fichier | Gate associé |
|----------|---------|--------------|
| Feature | [`FEATURE_DOCTRINE.md`](./doctrine/FEATURE_DOCTRINE.md) | `feature:registry` |
| Registre features | [`APP_FEATURE_REGISTRY.md`](./doctrine/APP_FEATURE_REGISTRY.md) | `feature:registry` |
| Feature Slice | [`FEATURE_SLICE_DOCTRINE.md`](./doctrine/FEATURE_SLICE_DOCTRINE.md) | `feature:check` |
| Pyramide Qualité | [`QUALITY_PYRAMID_DOCTRINE.md`](./doctrine/QUALITY_PYRAMID_DOCTRINE.md) | `quality:gate` |
| Graphe Architecture | [`KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./KOMERCE_ARCH_GRAPH_DOCTRINE.md) | `arch:gate` |
| Schema DB | [`KOMERCE_DB_SCHEMA_DOCTRINE.md`](./KOMERCE_DB_SCHEMA_DOCTRINE.md) | `arch:drift` |

## Socle technique de référence

| Besoin | Document actif |
|--------|----------------|
| Schéma DB canonique | [`SCHEMA.md`](./SCHEMA.md) |
| Graphe architecture lisible | [`KOMERCE_ARCH_HEADER_GRAPH.md`](./KOMERCE_ARCH_HEADER_GRAPH.md) |
| Graphe machine-readable | [`komerce-arch-header-graph.json`](./komerce-arch-header-graph.json) |
| Contrats de services | [`CONTRACTS.md`](./CONTRACTS.md) |
| Déploiement | [`ops/DEPLOYMENT.md`](./ops/DEPLOYMENT.md) |

## Boutique

| Document | Rôle |
|----------|------|
| [`public/boutique/README.md`](../public/boutique/README.md) | Index boutique secondaire |
| `BOUTIQUE_OWNERSHIP_LIVE.md` | Sortie générée, jamais source d'intention manuelle |
| `public/boutique/scripts/css-guard.js` | CSS Guardian |

## Hiérarchie documentaire

En cas de conflit :

1. Code de production
2. DB live
3. `AGENTS.md`
4. `docs/INDEX.md`
5. `features/*.feature.js`
6. Doctrines actives
7. Générateurs
8. Sorties générées à jour
9. Archives

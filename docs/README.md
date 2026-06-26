# Komerce — Documentation opératoire

> Mis à jour : **2026-06-16**  
> Règle : ce fichier est l'index actif. Tout document non listé ici est **historique, contextuel ou subordonné**. Il ne doit pas servir de source de vérité pour opérer le projet.

---

## 1. Lecture obligatoire minimale

Pour toute nouvelle session, lire uniquement dans cet ordre :

| Ordre | Document | Rôle |
|---:|---|---|
| 1 | [`AGENTS.md`](../AGENTS.md) | Règles obligatoires pour agent/dev |
| 2 | [`docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./KOMERCE_ARCH_GRAPH_DOCTRINE.md) | Doctrine obligatoire du graphe avant toute intervention fonctionnelle |
| 3 | [`docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`](./KOMERCE_DB_SCHEMA_DOCTRINE.md) | Doctrine obligatoire du schéma DB |
| 4 | [`docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`](./KOMERCE_ARCH_CARTOGRAPHY_STATUS.md) | Couverture et dette active de cartographie |
| 5 | [`docs/KOMERCE_ARCH_HEADER_GRAPH.md`](./KOMERCE_ARCH_HEADER_GRAPH.md) | Graphe lisible d'intervention |
| 6 | [`docs/komerce-arch-header-graph.json`](./komerce-arch-header-graph.json) | Graphe machine-readable et `interventionIndex` |
| 7 | [`docs/SCHEMA.md`](./SCHEMA.md) | Schéma DB canonique |
| 8 | [`docs/chantier/STATUS.md`](./chantier/STATUS.md) | État opératoire actuel, dettes ouvertes, tests à faire |
| 9 | [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) | Doctrine produit active du panier partagé |
| 10 | [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md) | Mise en œuvre datée du panier partagé |
| 11 | [`docs/doctrine/DOUANE_DECLARATION_PIVOT.md`](./doctrine/DOUANE_DECLARATION_PIVOT.md) | **Doctrine douane** — la déclaration est le pivot ; on instrumente, on n'optimise pas |
| 12 | [`docs/specs/SPEC_KEYSTONE_DOUANE.md`](./specs/SPEC_KEYSTONE_DOUANE.md) | Spec fonctionnelle Keystone douane (Gap A clôturé, B et C ouverts) |
| 13 | [`docs/doctrine/FEATURE_SLICE_DOCTRINE.md`](./doctrine/FEATURE_SLICE_DOCTRINE.md) | Doctrine Feature Slice — périmètre, guard, workflow montage/démontage |
| 14 | [`docs/doctrine/FEATURE_DOCTRINE.md`](./doctrine/FEATURE_DOCTRINE.md) | **Doctrine Feature — sommet de la pyramide.** Ce qu'est une feature métier, gouverne toutes les autres doctrines |
| 15 | [`docs/doctrine/APP_FEATURE_REGISTRY.md`](./doctrine/APP_FEATURE_REGISTRY.md) | Registre canonique exhaustif des features backend réelles |

Ces documents suffisent pour reprendre le projet sans lire l'historique.

---

## 2. Doctrine graphe obligatoire

La cartographie `@komerce-arch` est un contrat d'intervention, pas une documentation facultative.

Toute création, modification, suppression, fusion ou déplacement de feature fonctionnelle doit respecter :

```txt
docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
```

Une intervention est incomplète si elle change le comportement sans mettre à jour les headers concernés et régénérer le graphe.

---

## 3. Doctrine DB obligatoire

Le schéma DB est un contrat vivant.

Toute migration ou modification de table, colonne, enum, index, trigger, fonction ou contrainte doit respecter :

```txt
docs/KOMERCE_DB_SCHEMA_DOCTRINE.md
```

Une intervention DB est incomplète si `docs/SCHEMA.md`, les headers `@db-read/@db-write/@db-txn` et le graphe ne sont pas alignés.

---

## 4. Socle technique de référence

À lire seulement si la modification touche la zone concernée :

| Besoin | Document actif |
|---|---|
| Doctrine graphe obligatoire | [`docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./KOMERCE_ARCH_GRAPH_DOCTRINE.md) |
| Doctrine schéma DB obligatoire | [`docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`](./KOMERCE_DB_SCHEMA_DOCTRINE.md) |
| Statut cartographie architecture | [`docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`](./KOMERCE_ARCH_CARTOGRAPHY_STATUS.md) |
| Graphe architecture lisible | [`docs/KOMERCE_ARCH_HEADER_GRAPH.md`](./KOMERCE_ARCH_HEADER_GRAPH.md) |
| Graphe architecture machine-readable | [`docs/komerce-arch-header-graph.json`](./komerce-arch-header-graph.json) |
| Schéma DB réel | [`docs/SCHEMA.md`](./SCHEMA.md) |
| Cartographie générale backend/frontend | [`docs/CARTOGRAPHY_360.md`](./CARTOGRAPHY_360.md) |
| Invariants métier et fichiers sensibles | [`docs/ZONE_IMPACT.md`](./ZONE_IMPACT.md) |
| Contrats de services critiques | [`docs/CONTRACTS.md`](./CONTRACTS.md) |
| Pricing, CDR, allocations de coûts, N1/N2/N3, dashboard économique | [`docs/doctrine/MOTEUR_ECONOMIQUE_ALLOCATION.md`](./doctrine/MOTEUR_ECONOMIQUE_ALLOCATION.md) |
| Personnalisation boutique, suggestions, re-ranking accueil, habitudes de navigation | [`docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md`](./doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md) |
| Déploiement / production | [`docs/ops/DEPLOYMENT.md`](./ops/DEPLOYMENT.md) |
| Sécurité backend | [`docs/backend/SECURITY-MODEL.md`](./backend/SECURITY-MODEL.md) |
| Backlog de remédiation pré-golive (lots A-H, scoring, ordre d'exécution) | [`docs/backend/BACKEND_GOLIVE_ROADMAP.md`](./backend/BACKEND_GOLIVE_ROADMAP.md) |
| Architecture backend normative (invariants I-BACK-1..10, ownership) | [`docs/backend/BACKEND_ARCHITECTURE.md`](./backend/BACKEND_ARCHITECTURE.md) |
| Pyramide qualité (N1→N5) — gates code, architecture, feature slice | [`docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md`](./doctrine/QUALITY_PYRAMID_DOCTRINE.md) |
| Feature Slice — périmètre par feature, guard CI | [`docs/doctrine/FEATURE_SLICE_DOCTRINE.md`](./doctrine/FEATURE_SLICE_DOCTRINE.md) |
| Connecteurs fournisseurs (état, interface, activation Noon) | [`docs/SUPPLIERS_CONNECTORS.md`](./SUPPLIERS_CONNECTORS.md) |
| Moteur sourcing (philosophie, rails, seuils, invariants, évolutions) | [`docs/SOURCING_ENGINE.md`](./SOURCING_ENGINE.md) |
| Audit schéma DB sourcing (doublons coût/poids, FK, indexes) | [`docs/_work/SOURCING_DB_AUDIT.md`](./_work/SOURCING_DB_AUDIT.md) |

---

## 5. Boutique

Le frontend Boutique vit dans `public/boutique/**`.

Toute modification Boutique reste soumise à la doctrine graphe.

| Besoin | Document actif |
|---|---|
| Doctrine graphe obligatoire | [`docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./KOMERCE_ARCH_GRAPH_DOCTRINE.md) |
| Comprendre quoi chercher, où modifier, comment tester | [`docs/boutique/README.md`](./boutique/README.md) |
| Commandes locales rapides | [`public/boutique/README.md`](../public/boutique/README.md) |
| Pipeline CSS | [`docs/boutique/BOUTIQUE_CSS_PIPELINE.md`](./boutique/BOUTIQUE_CSS_PIPELINE.md) |
| Ownership composants | [`docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md`](./boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md) |
| Architecture modal produit | [`docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`](./boutique/BOUTIQUE_MODAL_ARCHITECTURE.md) |
| Personnalisation / ranking / suggestions | [`docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md`](./doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md) |

Les documents sous `public/boutique/docs/**` sont historiques ou générés. Ils sont toujours subordonnés aux documents ci-dessus.

---

## 6. Doctrine produit active

La doctrine active du panier partagé est **Boutique First** :

```txt
La négociation appartient aux humains.
La matérialisation de l'achat appartient à Komerce.
Le lien partagé ouvre une boutique, jamais un guichet.
```

Conséquence : toute documentation V4.1, collective workspace, cagnotte, engagement ou financement collectif est historique sauf si elle a été explicitement réintégrée dans :

- [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md)
- [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md)

---

## 7. Archive

Les dossiers suivants sont **non opératoires par défaut** :

```txt
docs/_archive/**
docs/audit/**
docs/chantier/*_AUDIT_*.md
docs/chantier/I_SWEEP_PLAN.md
public/CHANGELOG-*.md
routes/ORPHELINS_*.md
public/boutique/docs/**
```

Ils peuvent servir à comprendre l'histoire, jamais à décider une implémentation actuelle.

Si une information utile d'un ancien document est encore nécessaire, elle doit être copiée dans un document actif ci-dessus, puis l'ancien document reste archivé.

---

## 8. Règle de conflit

En cas de conflit :

```txt
Code de production > DB live pour le schéma > docs actives listées ici > docs historiques.
```

Pour le panier partagé, la doctrine Boutique First gagne sur tous les anciens documents V4.1 ou financement collectif.

---

## 9. Definition of Done documentaire

Une PR est documentairement propre si :

- elle respecte `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md` ;
- elle respecte `docs/KOMERCE_DB_SCHEMA_DOCTRINE.md` si la DB est touchée ;
- elle ne crée pas de nouvelle source de vérité inutile ;
- elle met à jour le document actif concerné ;
- elle met à jour `docs/SCHEMA.md` si le schéma DB change ;
- elle met à jour les headers et le graphe si le contrat fonctionnel change ;
- elle n'oblige pas un futur agent à relire des audits historiques ;
- elle laisse `docs/README.md` comme point d'entrée unique.
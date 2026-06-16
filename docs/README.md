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
| 3 | [`docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`](./KOMERCE_ARCH_CARTOGRAPHY_STATUS.md) | Couverture et dette active de cartographie |
| 4 | [`docs/KOMERCE_ARCH_HEADER_GRAPH.md`](./KOMERCE_ARCH_HEADER_GRAPH.md) | Graphe lisible d'intervention |
| 5 | [`docs/komerce-arch-header-graph.json`](./komerce-arch-header-graph.json) | Graphe machine-readable et `interventionIndex` |
| 6 | [`docs/chantier/STATUS.md`](./chantier/STATUS.md) | État opératoire actuel, dettes ouvertes, tests à faire |
| 7 | [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) | Doctrine produit active du panier partagé |
| 8 | [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md) | Mise en œuvre datée du panier partagé |

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

## 3. Socle technique de référence

À lire seulement si la modification touche la zone concernée :

| Besoin | Document actif |
|---|---|
| Doctrine graphe obligatoire | [`docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./KOMERCE_ARCH_GRAPH_DOCTRINE.md) |
| Statut cartographie architecture | [`docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`](./KOMERCE_ARCH_CARTOGRAPHY_STATUS.md) |
| Graphe architecture lisible | [`docs/KOMERCE_ARCH_HEADER_GRAPH.md`](./KOMERCE_ARCH_HEADER_GRAPH.md) |
| Graphe architecture machine-readable | [`docs/komerce-arch-header-graph.json`](./komerce-arch-header-graph.json) |
| Cartographie générale backend/frontend | [`docs/CARTOGRAPHY_360.md`](./CARTOGRAPHY_360.md) |
| Invariants métier et fichiers sensibles | [`docs/ZONE_IMPACT.md`](./ZONE_IMPACT.md) |
| Schéma DB réel | [`docs/SCHEMA.md`](./SCHEMA.md) |
| Contrats de services critiques | [`docs/CONTRACTS.md`](./CONTRACTS.md) |
| Pricing, CDR, allocations de coûts, N1/N2/N3, dashboard économique | [`docs/doctrine/MOTEUR_ECONOMIQUE_ALLOCATION.md`](./doctrine/MOTEUR_ECONOMIQUE_ALLOCATION.md) |
| Personnalisation boutique, suggestions, re-ranking accueil, habitudes de navigation | [`docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md`](./doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md) |
| Déploiement / production | [`docs/ops/DEPLOYMENT.md`](./ops/DEPLOYMENT.md) |
| Sécurité backend | [`docs/backend/SECURITY-MODEL.md`](./backend/SECURITY-MODEL.md) |

---

## 4. Boutique

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

## 5. Doctrine produit active

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

## 6. Archive

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

## 7. Règle de conflit

En cas de conflit :

```txt
Code de production > DB live pour le schéma > docs actives listées ici > docs historiques.
```

Pour le panier partagé, la doctrine Boutique First gagne sur tous les anciens documents V4.1 ou financement collectif.

---

## 8. Definition of Done documentaire

Une PR est documentairement propre si :

- elle respecte `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md` ;
- elle ne crée pas de nouvelle source de vérité inutile ;
- elle met à jour le document actif concerné ;
- elle met à jour les headers et le graphe si le contrat fonctionnel change ;
- elle n'oblige pas un futur agent à relire des audits historiques ;
- elle laisse `docs/README.md` comme point d'entrée unique.
# Komerce — Documentation opératoire

> Mis à jour : **2026-06-15**  
> Règle : ce fichier est l'index actif. Tout document non listé ici est **historique, contextuel ou subordonné**. Il ne doit pas servir de source de vérité pour opérer le projet.

---

## 1. Lecture obligatoire minimale

Pour toute nouvelle session, lire uniquement dans cet ordre :

| Ordre | Document | Rôle |
|---:|---|---|
| 1 | [`AGENTS.md`](../AGENTS.md) | Règles obligatoires pour agent/dev |
| 2 | [`docs/chantier/STATUS.md`](./chantier/STATUS.md) | État opératoire actuel, dettes ouvertes, tests à faire |
| 3 | [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) | Doctrine produit active du panier partagé |
| 4 | [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md) | Mise en œuvre datée du panier partagé |

Ces quatre documents suffisent pour reprendre le projet sans lire l'historique.

---

## 2. Socle technique de référence

À lire seulement si la modification touche la zone concernée :

| Besoin | Document actif |
|---|---|
| Cartographie générale backend/frontend | [`docs/CARTOGRAPHY_360.md`](./CARTOGRAPHY_360.md) |
| Invariants métier et fichiers sensibles | [`docs/ZONE_IMPACT.md`](./ZONE_IMPACT.md) |
| Schéma DB réel | [`docs/SCHEMA.md`](./SCHEMA.md) |
| Contrats de services critiques | [`docs/CONTRACTS.md`](./CONTRACTS.md) |
| Pricing, CDR, allocations de coûts, N1/N2/N3, dashboard économique | [`docs/doctrine/MOTEUR_ECONOMIQUE_ALLOCATION.md`](./doctrine/MOTEUR_ECONOMIQUE_ALLOCATION.md) |
| Déploiement / production | [`docs/ops/DEPLOYMENT.md`](./ops/DEPLOYMENT.md) |
| Sécurité backend | [`docs/backend/SECURITY-MODEL.md`](./backend/SECURITY-MODEL.md) |

---

## 3. Boutique

Le frontend Boutique vit dans `public/boutique/**`.

| Besoin | Document actif |
|---|---|
| Comprendre quoi chercher, où modifier, comment tester | [`docs/boutique/README.md`](./boutique/README.md) |
| Commandes locales rapides | [`public/boutique/README.md`](../public/boutique/README.md) |
| Pipeline CSS | [`docs/boutique/BOUTIQUE_CSS_PIPELINE.md`](./boutique/BOUTIQUE_CSS_PIPELINE.md) |
| Ownership composants | [`docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md`](./boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md) |
| Architecture modal produit | [`docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`](./boutique/BOUTIQUE_MODAL_ARCHITECTURE.md) |
| Personnalisation / ranking / suggestions | [`docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md`](./doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md) |

Les documents sous `public/boutique/docs/**` sont historiques ou générés. Ils sont toujours subordonnés aux documents ci-dessus.

---

## 4. Doctrine produit active

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

## 5. Archive

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

## 6. Règle de conflit

En cas de conflit :

```txt
Code de production > DB live pour le schéma > docs actives listées ici > docs historiques.
```

Pour le panier partagé, la doctrine Boutique First gagne sur tous les anciens documents V4.1 ou financement collectif.

---

## 7. Definition of Done documentaire

Une PR est documentairement propre si :

- elle ne crée pas de nouvelle source de vérité inutile ;
- elle met à jour le document actif concerné ;
- elle n'oblige pas un futur agent à relire des audits historiques ;
- elle laisse `docs/README.md` comme point d'entrée unique.
# Komerce Backend

> E-commerce Comores — Node.js / Express / PostgreSQL — Railway

---

## Point d'entrée unique

La documentation opératoire active vit ici :

```txt
docs/README.md
```

Lire dans cet ordre :

1. [`AGENTS.md`](./AGENTS.md) — règles obligatoires agent/dev ;
2. [`docs/README.md`](./docs/README.md) — index actif, docs à lire, archive ;
3. [`docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`](./docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md) — état de la cartographie architecture ;
4. [`docs/KOMERCE_ARCH_HEADER_GRAPH.md`](./docs/KOMERCE_ARCH_HEADER_GRAPH.md) — graphe d'intervention généré ;
5. [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) — état courant ;
6. [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) — doctrine produit active du panier partagé ;
7. [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md) — mise en œuvre datée.

Tout autre document non listé par `docs/README.md` est historique, contextuel ou subordonné.

---

## Gouvernance architecture obligatoire

Toute création, modification ou suppression de feature fonctionnelle est incomplète tant que la cartographie architecture n'est pas à jour.

Règle obligatoire :

- lire le header `@komerce-arch` ou `@komerce-arch-lite` de chaque fichier touché avant modification ;
- créer un header pour tout nouveau fichier source ;
- mettre à jour les champs `@inputs`, `@outputs`, `@depends`, `@used-by`, `@db-read`, `@db-write`, `@db-txn`, `@doctrine`, `@impact-areas` quand le contrat fonctionnel change ;
- pour une suppression ou fusion, nettoyer les références `@depends`, `@used-by`, `@owner` ;
- régénérer le graphe avec `node scripts/generate-komerce-arch-graph.js` ;
- vérifier `files without headers: 0` et `lite headers without owner: 0`.

Un champ incertain doit rester explicitement en `@unknown` ou `resolve_before_behavior_change`; il ne faut pas inventer une cartographie faussement précise.

---

## Doctrine produit active

Le panier partagé est désormais **Boutique First**.

```txt
La négociation appartient aux humains.
La matérialisation de l'achat appartient à Komerce.
Le lien partagé ouvre une boutique, jamais un guichet.
```

Conséquence : les anciennes documentations V4.1, workspace collectif, cagnotte, engagement ou financement collectif ne font plus foi sauf si elles sont explicitement reprises dans les deux documents Boutique First.

---

## Quick Start dev

```bash
npm install
cp .env.example .env
# Renseigner DATABASE_URL, JWT_SECRET, STRIPE_*, QR_SECRET, etc.
npm start
```

---

## Commandes utiles

```bash
# Backend
npm start
npm test

# Frontend Boutique
cd public/boutique
npm run deploy:css
npm run check:all
```

---

## Règle PR

Une PR doit :

- respecter les invariants listés dans `docs/README.md` et `AGENTS.md` ;
- mettre à jour le document actif concerné ;
- mettre à jour la cartographie `@komerce-arch` si le contrat fonctionnel change ;
- régénérer le graphe architecture après tout ajout, suppression ou changement structurel ;
- ne pas créer une nouvelle source de vérité sans raison explicite ;
- laisser les anciens documents en archive ou subordonnés.

---

## En cas de doute

```txt
Code de production > DB live pour le schéma > docs actives listées dans docs/README.md > docs historiques.
```

Pour le panier partagé, la doctrine Boutique First gagne sur tout ancien document collectif ou V4.1.
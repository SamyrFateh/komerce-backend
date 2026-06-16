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
3. [`docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md) — doctrine obligatoire du graphe ;
4. [`docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`](./docs/KOMERCE_DB_SCHEMA_DOCTRINE.md) — doctrine obligatoire du schéma DB ;
5. [`docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`](./docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md) — état de la cartographie architecture ;
6. [`docs/KOMERCE_ARCH_HEADER_GRAPH.md`](./docs/KOMERCE_ARCH_HEADER_GRAPH.md) — graphe d'intervention généré ;
7. [`docs/SCHEMA.md`](./docs/SCHEMA.md) — schéma DB canonique ;
8. [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) — état courant ;
9. [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) — doctrine produit active du panier partagé ;
10. [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md) — mise en œuvre datée.

Tout autre document non listé par `docs/README.md` est historique, contextuel ou subordonné.

---

## Doctrine graphe obligatoire

Peu importe où un agent arrive dans le dépôt, toute création, modification ou suppression de feature fonctionnelle doit suivre :

```txt
docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
```

Cette doctrine rend obligatoire la mise à jour des headers `@komerce-arch` / `@komerce-arch-lite` et la régénération du graphe quand le contrat fonctionnel change.

Un changement fonctionnel sans cartographie à jour est incomplet.

---

## Doctrine DB obligatoire

Tout changement de schéma DB doit suivre :

```txt
docs/KOMERCE_DB_SCHEMA_DOCTRINE.md
```

Une migration ou modification DB est incomplète tant que `docs/SCHEMA.md`, les headers DB concernés et le graphe ne racontent pas la même chose.

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
- respecter `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md` ;
- respecter `docs/KOMERCE_DB_SCHEMA_DOCTRINE.md` si la DB est touchée ;
- mettre à jour le document actif concerné ;
- mettre à jour `docs/SCHEMA.md` si le schéma DB change ;
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
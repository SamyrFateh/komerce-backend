# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

---

## 1. Lecture obligatoire avant modification

Lire uniquement dans cet ordre :

1. [`docs/README.md`](./docs/README.md) — index documentaire actif ;
2. [`docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`](./docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md) — doctrine obligatoire du graphe ;
3. [`docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`](./docs/KOMERCE_DB_SCHEMA_DOCTRINE.md) — doctrine obligatoire du schéma DB ;
4. [`docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`](./docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md) — statut de la cartographie architecture ;
5. [`docs/KOMERCE_ARCH_HEADER_GRAPH.md`](./docs/KOMERCE_ARCH_HEADER_GRAPH.md) — graphe d'intervention généré ;
6. [`docs/komerce-arch-header-graph.json`](./docs/komerce-arch-header-graph.json) — graphe machine-readable ;
7. [`docs/SCHEMA.md`](./docs/SCHEMA.md) — schéma DB canonique ;
8. [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) — état courant ;
9. Les documents actifs listés par `docs/README.md` selon la zone touchée.

Ne pas démarrer une modification depuis un audit, un ancien prompt, un changelog ou un fichier non listé par `docs/README.md`.

---

## 2. Gouvernance architecture obligatoire

Toute création, modification ou suppression de feature fonctionnelle doit maintenir la cartographie `@komerce-arch`.

La règle détaillée vit dans :

```txt
docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
```

Avant modification :

1. lire le header `@komerce-arch` ou `@komerce-arch-lite` de chaque fichier touché ;
2. lire `interventionIndex["<file>"]` dans `docs/komerce-arch-header-graph.json` pour identifier les fichiers, tables, doctrines et zones d'impact à vérifier ;
3. si un fichier touché contient `@unknown` ou `resolve_before_behavior_change` sur le champ concerné, résoudre ce point avant de changer le comportement.

Pendant modification :

- tout nouveau fichier source doit naître avec un header ;
- utiliser `@komerce-arch` si le fichier porte une responsabilité autonome ;
- utiliser `@komerce-arch-lite` si le fichier est un support possédé par un owner explicite ;
- mettre à jour `@inputs`, `@outputs`, `@depends`, `@used-by`, `@db-read`, `@db-write`, `@db-txn`, `@doctrine`, `@impact-areas` dès que le contrat fonctionnel change ;
- en cas de suppression ou fusion, supprimer ou transférer les références `@depends`, `@used-by`, `@owner`.

Après modification :

```bash
node scripts/generate-komerce-arch-graph.js
```

Vérifier obligatoirement :

- `files without headers: 0` ;
- `lite headers without owner: 0` ;
- les nouveaux edges du graphe sont cohérents ;
- les accès DB nouveaux ou modifiés sont déclarés ;
- les champs incertains restent explicitement en `@unknown` ou `resolve_before_behavior_change`, jamais inventés.

Une intervention fonctionnelle sans mise à jour du header et du graphe est incomplète.

---

## 3. Gouvernance DB obligatoire

Tout changement de schéma DB doit suivre :

```txt
docs/KOMERCE_DB_SCHEMA_DOCTRINE.md
```

Règle : une migration, un changement de table, colonne, enum, index, trigger, fonction ou contrainte est incomplet tant que :

- la migration ou le chemin startup est explicite ;
- `docs/SCHEMA.md` est mis à jour ;
- les headers des fichiers lecteurs/écrivains sont mis à jour ;
- le graphe est régénéré si les headers changent ;
- l'ordre migration/deploy/rollback est documenté si la production est impactée.

---

## 4. Doctrine produit active — panier partagé

Le modèle actif est **Boutique First**.

Lire :

- [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md)
- [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](./docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md)

Règle :

```txt
Le lien partagé ouvre une boutique, jamais un guichet.
Le participant consulte le panier en lecture seule.
Il règle sa part seulement si le panier est payable.
```

Toute documentation V4.1, collective workspace, cagnotte, engagement ou financement collectif est historique sauf si elle est explicitement reprise dans ces deux documents.

---

## 5. Hiérarchie documentaire

En cas de conflit :

```txt
1. Code de production
2. DB live pour le schéma
3. docs/README.md
4. Documents actifs listés dans docs/README.md
5. Docs historiques / archives / audits
```

Une doc ancienne qui contredit `docs/README.md` ou la doctrine Boutique First est subordonnée, même si elle est plus détaillée.

---

## 6. Règle de divergence

Si code, DB et docs ne racontent pas la même chose :

1. ne pas corriger silencieusement ;
2. noter la divergence dans `docs/chantier/STATUS.md` ;
3. corriger le document actif concerné dans la même PR que le code, ou créer une dette explicite.

---

## 7. Règles techniques non négociables

- Statuts commande : passer par `services/order-status-machine.js`.
- Paiements Stripe/cash/wallet/shared-cart : passer par les services propriétaires documentés.
- Webhooks Stripe : conserver le body brut avant `express.json`.
- Wallet : jamais de suppression destructive ; créditer, débiter, contre-passer.
- Pricing : lire les composantes DB, jamais de coefficient dur.
- Toute transition effective doit laisser une trace.

---

## 8. Règle Boutique

Si une modification touche :

- `public/boutique/**` ;
- `docs/boutique/**` ;
- un script racine qui affecte la Boutique ;

alors lire les documents Boutique actifs listés dans `docs/README.md` et [`public/boutique/README.md`](./public/boutique/README.md).

Interdits Boutique :

- ne pas créer une deuxième source de vérité ;
- ne pas éditer `public/boutique/css/dist/*.css` directement ;
- ne pas casser le moteur mobile hero fixed + `#k-page-scroll` ;
- ne pas corriger le desktop avec un hack mobile ;
- ne pas mélanger panier personnel et panier partagé.

---

## 9. Règle de fin de session

Avant commit ou PR :

- mettre à jour `docs/chantier/STATUS.md` si l'état courant change ;
- mettre à jour le document actif concerné ;
- mettre à jour `docs/SCHEMA.md` si le schéma DB change ;
- mettre à jour les headers `@komerce-arch` / `@komerce-arch-lite` concernés ;
- régénérer `docs/KOMERCE_ARCH_HEADER_GRAPH.md` et `docs/komerce-arch-header-graph.json` si la cartographie change ;
- ne pas ajouter de nouveau document hors index sans l'ajouter à `docs/README.md` ;
- laisser les anciens documents en archive/subordination plutôt que les réactiver implicitement.
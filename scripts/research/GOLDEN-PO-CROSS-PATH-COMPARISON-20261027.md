# R&D — Comparaison différentielle de deux parcours Golden (27 octobre 2026)

**Résultat :** `NO_ASYMMETRY_OBSERVED` sur les deux variantes du **même Golden customer-to-customer**, avec PostgreSQL 16 jetable et quatre checkpoints progressifs. **Zéro nouveau bug confirmé** sur ce périmètre. Aucun appel fournisseur externe, aucune certification staging ou navigateur, aucune fusion.

## Expérience

Le golden canonique `tests/e2e-api/customer-to-customer.golden.e2e.test.js` a été exécuté **deux fois**, dans deux processus Jest séparés avec nettoyage des données du run. Le seul paramètre de forme d'achat est `FP_GOLDEN_PO_SHAPE` :

- **Parcours 1 — PO regroupée** : l'en-tête `purchase_orders.order_id` est `NULL`; ligne ouverte puis rattachée à la PO `draft`; commande portée par `purchase_lines.order_item_id`.
- **Parcours 2 — PO historique** : l'en-tête possède `order_id` et `order_item_id` ; la ligne d'achat unique est rattachée directement par son `INSERT` ; statut initial `pending`.

**Contrôle de non-simulation** : les assertions relisent `purchase_orders` et `purchase_lines` après confirmation pour vérifier le type **effectivement persisté**, `order_id` et `order_item_id`. Le comparateur refuse des libellés `grouped`/`historical` qui ne correspondent pas aux preuves SQL.

Dans chaque exécution, l'ensemble des étapes existantes est préservé : commande payée (fixture), PO, exécution et débit fournisseur (faits canoniques de test), suivi d'expédition, allocation et unité physique au Hub, colis, douane, scan de retrait, puis `reconcileOrderFinancialClose`. Les identités sont relues depuis les tables par `collectGoldenTrail`, au **même `order_id`** à l'intérieur de chaque exécution.

## Résultats observés

[**Run GitHub Actions #40480564524 — vert**](https://github.com/SamyrFateh/komerce-backend/actions/runs/40480564524)  
[**Artefact des deux traces et du différentiel JSON**](https://github.com/SamyrFateh/komerce-backend/actions/runs/40480564524/artifacts/12722462893) — conservation 5 jours.

- **14/14** tests purs de l'empreinte et du comparateur.
- **1/1 Golden PostgreSQL** avec la PO regroupée, **1/1** avec la PO historique.
- **5 étapes workflow vertes** (oracle pur, 2 Goldens, comparaison, preuve).
- `FINANCIAL_CLOSE_MATCHED` dans chaque parcours, avec les identités requises : `order_item`, `purchase_line`, `execution_line`, `supplier_payment`, `fulfillment`, `hub_allocation`, `physical_unit`, `parcel`, `scan`.
- **4 checkpoints identiques** : avant Hub il manque Hub/colis/scan ; après Hub il manque colis/scan ; au relais avant retrait il manque le scan ; après retrait les liens d'identité sont complets.
- Sur chaque PO, la tentative SQL de remplacer le SKU d'achat **après gel** est refusée par `purchase_line_frozen` / `SQLSTATE 23514`, et une substitution fictive dans une copie de la trace est détectée.
- Comparateur final : `verdict=NO_ASYMMETRY_OBSERVED`, `mismatches=[]`, empreinte normalisée `e276f171405202144f642d22306cd0ee08cae4e78ccc31c20d8aa0cb72cea623`.

### Comparaison fondée sur le sens

Le comparateur `scripts/research/compare-golden-po-paths.js` travaille sur les **catégories de preuve**, les comptes d'identifiants par catégorie, les motifs de preuves manquantes, les verdicts canoniques et la garde SQL. Il n'exige **jamais** que les UUID de deux commandes créées indépendamment soient identiques. Le module inclut ses propres contre-épreuves : différence sur une frontière Hub, rupture de cardinalité, clôture non MATCHED, forme PO déclarée incorrecte et revendication de forme non prouvée en base.

Une égalité de sorties normalisées n'atteste **pas** que deux parcours soient tous deux corrects : c'est une vérification différentielle dont l'oracle métier reste externe.

## Ce que ce jalon prouve réellement

Le laboratoire sait maintenant :
1. Observer **un fil de clés étrangères continu** dans une commande avec de vrais services canoniques.
2. Rejouer **deux implémentations métier distinctes** sous la même intention.
3. Comparer sans bruit lié aux UUID, aux horodatages et à la forme technique des PO.
4. Ne pas promouvoir une absence de preuve attendue au rang de bug.
5. Détecter volontairement des contre-exemples dans les traces, tout en vérifiant une garde SQL réelle.

**Aucun nouveau correctif métier requis par ce test.** Les travaux restent uniquement dans `research/golden-continuity-checkpoints-20261026`, sans changement de `main` ou de Railway.

## Prochaine frontière

Comparer des parcours **à résultat attendu différent** sous une même perturbation d'intention, en particulier `pending` historique contre `draft` regroupé (commande fournisseur non soumise), puis un colis partagé entre commandes. Les expériences précédentes ont déjà montré que comparer uniquement `parcels.order_id` donnait un faux rapprochement pour un colis partagé ; il faut garder le lien via `parcel_items.order_item_id`.

Ne lancer qu'un scénario perturbé supplémentaire à la fois, avec preuve nominale et effet SQL indépendant, pas une suite exhaustive supplémentaire.

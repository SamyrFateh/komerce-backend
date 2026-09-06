# Pricing — maturité & watermark

> Statut : chantier technique empilé sur #1209, avant gate de couverture.
> Doctrine de référence : #1206, `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`.

## Invariant

Une commande n'est `MATURE` que si les coûts variables qui conditionnent sa contribution disposent d'une preuve de réconciliation suffisante. Une estimation, une valeur configurée ou une absence de donnée ne devient jamais une preuve réelle ni un zéro économique.

Le watermark avance uniquement sur un préfixe temporel entièrement mûr. Si une commande d'un timestamp est immature, le groupe temporel entier bloque la frontière ; une commande plus récente déjà mûre ne peut pas être sélectionnée pour contourner ce blocage.

## Vérités et gaps constatés dans le code actuel

- `allocateProductPurchaseCosts()` utilise encore `products.cost_kmf` comme approximation et l'enregistre avec `is_actual=TRUE`. Pour le watermark, cette source est explicitement refusée comme preuve d'achat fournisseur réellement réconcilié.
- `allocateParcelRealCosts()` produit aujourd'hui la commission relais depuis `cost_components`, puis `finance_config`, puis un fallback littéral. Ces sources décrivent une commission attendue ; elles ne prouvent pas son règlement effectif. Elles ne rendent donc pas une commande mûre.
- aucun writer canonique de frais de paiement réels dans `order_item_real_cost_allocations` n'est prouvé aujourd'hui. Si le snapshot attend un coût `payment`, la commande reste immature jusqu'à capture réelle explicite.
- `local_distribution` est volontairement laissé `missing` par l'allocateur actuel faute de saisie réelle fine. Une commande qui attend ce poste reste donc immature.
- `hub` provenant de `monthly_recalc` correspond à l'ancien traitement de structure et n'est jamais accepté comme preuve du Hub variable N1.
- pour un item `IMPORT`, `fulfillment_source` doit être connu, l'item doit être rattaché à un shipment, le shipment doit être `confirmed`, la douane doit être liquidée et le fret connu. Les montants positifs douane/fret doivent également avoir une allocation réelle.

Ces blocages sont volontaires : le premier résultat utile du watermark est de montrer **quelle preuve économique manque réellement**.

## Ce lot ne décide pas encore

- la largeur fixe de la fenêtre canonique ;
- le seuil de maturité ;
- le seuil de couverture ;
- la charge économique N3 de période par marché ;
- `COVERED / UNCOVERED / NOT_DECISIONAL` ;
- la politique d'ancrage prix marché.

Les bornes `from/to` du service marché sont donc obligatoires et doivent être fournies plus tard par une politique canonique gouvernée. Aucun défaut caché n'est introduit dans le moteur.

# Komerce — prix plancher prévisionnel en shadow (issue #3830)

**Statut : simulation en lecture seule accessible depuis l'Atelier, séparée des prix actifs.** Ce lot implémente une partie démontrable de la doctrine `DOCTRINE_PLANCHER_PREVISIONNEL.md`, en complément des PR P0-1 #3832 et P0-2 #3833. Il ne les remplace pas, ne modifie pas `pricing-cdr.js` et ne choisit/publie aucun prix. La route effectue uniquement un SELECT sur le produit et le marché est déjà résolu par le middleware d'autorisation.

## Entrée et autorité

`services/pricing-floor-forecast-shadow.js` exporte `calculateCase(forecast, scenario, unitsPerOrder = 1)` et `comparePrices(forecast)`.

Le service **ne va pas chercher un taux, un prix fournisseur, un devis, une commission ou un tarif douanier** : son appelant doit fournir les valeurs converties en KMF par l'autorité FX et les preuves correspondantes. Il n'y a aucune valeur de repli silencieuse. L'entrée est nommée par `market_code`, `product.circuit` (`import` ou `local`) et `valuation_date`.

**Chaque composante doit explicitement porter `market_code` et `circuit`** (ou `circuit: 'both'` pour un poste réellement commun). Un coût sans périmètre ou affecté au mauvais marché/circuit rend le scénario `NON_DECISIONNEL` ; le calcul ne récupère jamais un coût KM pour un marché CM/CG par défaut.

Le coût d'achat est `product.purchase_kmf` + `purchase_evidence`. Chaque scénario contient une liste de composants :

```js
{
  code: 'freight',
  stage: 'N1',
  basis: 'fret_m3_minimum',
  value: 180 * 491.96, // taux KMF/m³, à alimenter avec un vrai devis
  lot_volume_m3: 3, minimum_billable_m3: 1,
  cif_included: true,
  market_code: 'KM', circuit: 'import',
  evidence: {
    status: 'ASSUMED', reference: 'hypothèse sans devis',
    as_of: '2026-11-11', expires_on: '2026-12-11'
  }
}
```

`evidence.status` est `CONTRACT`, `QUOTED`, `TARIFF`, `ESTIMATED_TECH`, `ASSUMED` ou `UNKNOWN`. Tout coût sans provenance ou montant exploitable devient **NON_DECISIONNEL**. Les hypothèses documentées, les mesures techniques et les sources expirées donnent **PROVISOIRE** ; des tarifs/contrats datés et complets permettent **EXPLOITABLE**. Cela ne certifie pas le caractère économiquement réaliste des bornes : un verdict `ROBUSTE_DANS_LES_SCENARIOS` est toujours conditionnel à leurs preuves.

## Bases prises en charge

| `basis` | Coût par unité de produit |
|---|---|
| `fixed_unit` | montant direct |
| `fixed_order` | forfait / nombre d'unités **explicitement** simulé ; référence mono-article |
| `fixed_po` | forfait / unités de PO **explicitement** renseignées |
| `per_m3`, `per_kg` | taux × volume ou poids du produit |
| `fret_m3_minimum` | taux × volume produit × max(1, minimum facturable / volume de lot prévu) |
| `lot_fixed_m3` | forfait lot × volume produit / volume de lot prévu |
| `pct_purchase` | % du prix d'achat fournisseur |
| `pct_cif` | % de (achat + composantes N1 marquées `cif_included`) |
| `pct_n1` | % de N1 pour une provision explicite |
| `pct_exposure` | % des composantes explicites listées dans `base_codes` |
| `pct_sale` | % du prix encaissé, résolu **dans** le prix plancher |

Une liste de postes indispensables est imposée au circuit import (livraison fournisseur, fret, douane, dernier km, commission relais, paiement) et au circuit local (livraison locale, relais, paiement). Une gratuité réelle se représente par **0 documenté**, jamais par absence de composant.

**Formule :** `P0 = (N1 + N2_hors_pourcentage_sur_prix) / (1 - somme_des_%_du_prix)`. Les scénarios favorable, central, défavorable doivent comporter **exactement les mêmes composants** et donner des planchers ordonnés. La marge de sécurité forfaitaire de 10 % n'est pas ajoutée. Les charges N3 ne sont pas incluses dans P0 ; on fournit seulement, en information, des ventes équivalentes nécessaires pour couvrir une N3 mensuelle fournie.

## Entrée dans l'Atelier (simulation uniquement)

L'Atelier affiche un panneau repliable dans le dossier du produit. Pour calculer, l'utilisateur renseigne manuellement chacun des trois scénarios ; **aucun champ n'est prérempli**. Le circuit import/local est une hypothèse de simulation, jamais la déclaration opérationnelle de stock. L'unité de commission relais (commande ou unité) doit être explicitement choisie et confirmée par contrat avant toute référence de tarification.

Le serveur utilise `req.workspaceMarket` et `products.cost_kmf`, `weight_kg`, `volume_cm3` lus par requête `SELECT` sous `pricing.simulate`. Le navigateur ne fournit ni marché autoritaire, ni coût d'achat, ni marqueur de preuve contractuelle. Les montants monétaires du formulaire sont saisis **dans la devise du marché résolue par le serveur** (KMF pour KM, XAF pour CM/CG). Les quantités physiques (kg, m³) et les taux en % ne sont jamais convertis. Le serveur normalise les montants de simulation via `utils/currency.projectAmount` → `fx-authority` et son pivot EUR, calcule en KMF puis restitue les planchers, N1/N2 et les prix candidats dans la devise locale. Le détail technique est explicitement libellé KMF. Aucun taux navigateur ni conversion implicite sans parité gouvernée. Les montants facturés en EUR/AED doivent être convertis en devise du marché avant saisie : cette interface ne prétend pas avoir récupéré un devis. Cela reste une simulation et non une procédure de certification des données.

**Aucun résultat ne modifie le prix actif, les paramètres, les devis ou la base.** Aucun tarif douanier ni prix de transport n'est automatiquement deviné.

## Contrôles / limites

- Les ratios 200 / 4 / 2,5 ne sont **jamais** utilisés.
- La période, les preuves et la devise KMF normalisée doivent venir d'une source explicitement identifiée.
- Le `minimum_billable_m3` et `lot_volume_m3` sont des hypothèses de groupage à valider par devis et planification ; **3 m³ n'est pas une vérité métier**.
- La commission relais dépend d'un contrat, pas du code. La démonstration utilise une hypothèse explicitement identifiée, pas une décision.
- Les droits de douane au taux provisoire ne sont pas des droits réellement dus ; classification SH et fiscalité locale restent à valider.
- Le `packaging` est un coût par unité explicitement fourni : **un ventilateur de 0,06 m³ ne peut pas être tarifé avec un carton de 0,04 m³ en faisant une division fractionnaire**.
- Pour un panier multi-produits, la ventilation des forfaits peut nécessiter une méthode causale spécifique ; le modèle `unitsPerOrder = 1` est le plancher de référence prudent, et `unitsPerOrder = 3` n'est qu'une simulation **explicite**, jamais un panier médian inventé.
- Cette première implémentation comprend une **prévisualisation dans l'Atelier**, avec choix explicite du circuit et de l'unité de commission ; toutes les valeurs du navigateur sont rétrogradées à `ASSUMED`, même si un utilisateur fournit un libellé de facture ou de devis. Elle n'intègre ni la persistance de devis, ni le snapshot de décision, ni la comparaison SQL au réel. Ces travaux nécessitent validation des P0 et arbitrages de contrat / corridor / douane.
- Pas de déploiement automatique, pas de mutation des prix sur staging ou production.

## Reproduction

```bash
node scripts/recette/pricing-floor-forecast-demo.js
npx jest tests/unit/pricing-floor-forecast-shadow.test.js tests/unit/pricing-floor-forecast-preview.test.js tests/unit/admin-pricing-workspace-market-route.test.js --config jest.unit.config.js --runInBand
npx playwright test -c playwright.catalog-pricing-integration.config.js --grep 'Prévision avant vente'
```

Les quatre exemples ne sont que des simulations, **pas des produits sourcés, des coûts payés, des devis réels ni des prix validés**. La doctrine d'Opus et les scénarios initiaux sont disponibles dans le document reçu pour l'issue #3830.
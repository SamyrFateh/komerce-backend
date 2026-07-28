# Catalogue de fixtures — Product Modal v3

> **Statut** : oracle local déterministe  
> **Base de données** : aucune  
> **Réseau externe** : aucun  
> **Parcours couvert** : catalogue → recherche → modale → configuration → panier

## Pourquoi ce catalogue existe

Golden Elite couvre une topologie importante, mais ne suffit pas à certifier la composition V3. Le catalogue ajoute cinq contrats complémentaires afin de distinguer clairement :

- richesse éditoriale et présence de variantes ;
- deux, trois ou quatre axes de configuration ;
- rupture réelle et combinaison inexistante ;
- prix et médias dépendant du SKU ;
- produit simple très documenté ;
- produit SKU presque dépourvu de contenu ;
- résistance du layout à un titre, des options et des détails longs.

Les tests utilisent la vraie recherche de la boutique. Seules les réponses API sont interceptées par Playwright.

## Matrice

| Clé | Référence | Modèle | Axes | Cas principal |
|---|---|---:|---:|---|
| `elite` | `GOLDEN-ELITE-PRO` | SKU | 2 | rupture, combinaison absente, prix et médias variables |
| `garment` | `FIX-VETEMENT-PREMIUM` | SKU | 2 | nombreuses tailles/couleurs et wrap des contrôles |
| `furniture` | `FIX-MEUBLE-CONFIGURABLE` | SKU | 3 | libellés longs, incompatibilités, livraison spécialisée |
| `editorial` | `FIX-EDITORIAL-SIMPLE` | SIMPLE | 0 | contenu riche sans aucune variante |
| `sku-minimal` | `FIX-SKU-MINIMAL` | SKU | 2 | variantes sans dépendance à `hasEnrichedContent` |
| `stress` | `FIX-STRESS-LAYOUT-ULTRA-LONG-REFERENCE-2026` | SKU | 4 | huit médias, contenu long et scroll réel |

## Fichiers

```text
public/boutique/tests/fixtures/modal-v3-enriched-catalogue.js
public/boutique/tests/unit/modal-v3-enriched-catalogue.test.js
public/boutique/tests/e2e/helpers/modal-v3-fixture-catalogue.js
public/boutique/tests/e2e/modal-v3-enriched-catalogue.spec.js
```

## Exécution

Depuis `public/boutique` :

```powershell
npx jest tests/unit/modal-v3-enriched-catalogue.test.js --runInBand
npx playwright test tests/e2e/modal-v3-enriched-catalogue.spec.js --project="Desktop Chrome"
```

Le spec réalise lui-même la matrice :

```text
6 fixtures × desktop 1440×900
6 fixtures × mobile 390×844
+ 2 scénarios spécialisés
```

Les autres projets Playwright ignorent ce spec : la matrice interne est exécutée une seule fois sous Chromium.

## Génération des captures

```powershell
$env:MODAL_V3_CATALOGUE_SHOTS = "1"
npx playwright test tests/e2e/modal-v3-enriched-catalogue.spec.js --project="Desktop Chrome"
Remove-Item Env:MODAL_V3_CATALOGUE_SHOTS
```

Les captures sont écrites sous :

```text
public/boutique/docs/_work/modal-v3-catalogue/
```

Pour chaque fixture :

```text
desktop-<clé>-initial.png
desktop-<clé>-added.png
mobile-<clé>-initial.png
mobile-<clé>-added.png
```

## Invariants exercés

- la recherche retourne chaque fixture par son nom ;
- la modale affiche le contrat détail correspondant ;
- le nombre d’axes attendu est visible ;
- une sélection en rupture verrouille l’ajout ;
- une sélection valide résout une unité vendable ;
- le configurateur suit le hero et reste dans le scroll produit ;
- l’image n’est ni `sticky` ni `fixed` ;
- le side cart desktop est indépendant ;
- les actions mobiles sont hors du scroll ;
- le produit de stress n’introduit aucun scroll imbriqué ;
- le stepper desktop SIMPLE reste compris entre 120 et 145 px ;
- les produits SKU conservent leur garde transactionnelle et se vérifient dans le side cart.

## Limite volontaire

Ce catalogue ne prouve pas le déploiement des données dans Railway. La preuve de livraison réelle reste portée séparément par Golden Elite, son seed transactionnel et les specs live. Le catalogue V3 garantit le rendu, la recherche et les interactions de plusieurs topologies sans dépendre de l’état d’une base.

# Boutique Komerce — Product Display Contract

## Objectif

Ce document définit le contrat entre les produits réels, le catalogue Komerce, le rendu HTML et les CSS de la boutique.

Il répond à une inquiétude centrale : comment absorber des sources produit hétérogènes — Dubai, stock local, confection, CSV, manuel, fournisseur, marketplace — sans casser le design ni multiplier les CSS spécifiques.

## Principe fondamental

```txt
La boutique ne consomme pas un produit source brut.
Le CSS ne dépend jamais d'un fournisseur.
Le renderer ne décide pas la stratégie produit.
Le ViewModel traduit le produit Komerce en contrat d'affichage.
```

Chaîne cible :

```txt
Raw source product
→ Catalog product Komerce
→ ProductCardViewModel
→ renderProductCard()
→ CSS contract
```

## Trois vérités à séparer

### 1. Vérité fournisseur

C'est la donnée reçue telle quelle : Excel fournisseur, API marketplace, fiche Dubai, produit manuel, produit confection, stock local, capture WhatsApp transformée, CSV importé.

Elle peut être incomplète, sale, variable, ou contradictoire.

Elle ne doit pas piloter directement la boutique.

### 2. Vérité Komerce interne

C'est le produit compris, nettoyé et enrichi par Komerce : nom public, prix KMF, catégorie Komerce, fulfillment type, disponibilité, score de qualité, marge, délai estimé, statut publiable.

### 3. Vérité UI

C'est ce que la carte produit a besoin de savoir pour s'afficher.

Cette vérité est le `ProductCardViewModel`.

Elle contient : labels prêts à afficher, classes CSS normalisées, badges, prix formatés, image optimisée, état favori/panier, type visuel de carte, niveau de densité visuelle.

## Rôle du ProductCardViewModel

Le ViewModel transforme un produit Komerce en objet prêt pour le rendu.

Il répond à des questions comme :

```txt
- quelles classes CSS appliquer ?
- quel prix afficher ?
- y a-t-il un ancien prix ?
- faut-il un badge promo ?
- faut-il un badge stock local ?
- faut-il indiquer sur commande ?
- faut-il afficher un signal de qualité faible ?
- quel texte court utiliser si le nom est trop long ?
```

Le renderer ne doit plus refaire ces décisions.

## Contrat CSS standard

Les classes CSS produites par le ViewModel doivent être stables et indépendantes des fournisseurs.

Classes de base possibles :

```txt
k-card--standard
k-card--promo
k-card--flash
k-card--premium
k-card--local-stock
k-card--dubai-sourcing
k-card--custom-made
k-card--preorder
k-card--backorder
k-card--low-stock
k-card--has-variants
k-card--low-confidence
k-card--new-arrival
```

À ne pas faire :

```txt
k-card--supplier-dubai-a
k-card--excel-import-2026
k-card--whatsapp-product
```

Le fournisseur appartient à la couche sourcing, pas au CSS.

## Champs minimaux du ProductCardViewModel

Contrat initial :

```js
{
  id,
  raw,
  name,
  shortName,
  description,
  imageUrl,
  imageAlt,
  priceKmf,
  priceLabel,
  priceEurLabel,
  oldPriceKmf,
  oldPriceLabel,
  promoPct,
  promoLabel,
  badges,
  cssClasses,
  cardVariant,
  fulfillmentType,
  availabilityStatus,
  hasVariants,
  dataQualityScore
}
```

## Responsabilités par fichier

### `product-card-view-model.js`

Possède la traduction produit → display model, les classes CSS normalisées, les labels, les badges, les variantes visuelles, les fallbacks de données manquantes.

Ne possède pas le HTML final, les listeners, les mutations panier, les requêtes API, le calcul complet de pricing métier ou la logique fournisseur brute.

### `render-product-card.js`

Possède le HTML des cartes produit, la structure DOM, le choix grid/suggestion et les points d'accroche `data-*`.

Ne possède pas les règles de sourcing, la traduction fournisseur, la logique de promotion complexe ou les classes CSS métier inventées au cas par cas.

### `products.css`

Possède le rendu visuel des cartes, les styles des classes CSS contractuelles, la densité, les badges, les prix et les images.

Ne possède pas la logique fournisseur, les règles de prix, les corrections JS ou les hacks liés à une source donnée.

## Règle pour les produits incomplets

Un produit incomplet ne doit pas casser la carte.

Le ViewModel doit toujours fournir des fallbacks :

```txt
name absent        → Produit Komerce
price absent       → Prix à confirmer
image absente      → image placeholder
description absente→ pas de bloc description
promo invalide     → pas de badge promo
score faible       → classe k-card--low-confidence
```

## Règle sourcing → affichage

Le sourcing peut enrichir le produit avec :

```txt
source_type
fulfillment_type
availability_status
data_quality_score
supplier_reliability_score
lead_time_days
has_variants
```

Mais il ne doit pas choisir directement la classe CSS finale.

Le ViewModel est le point de traduction.

## Stratégie d'intégration progressive

```txt
Étape 1 : créer le ViewModel sans changer le rendu visuel.
Étape 2 : brancher render-product-card.js sur le ViewModel pour les champs déjà existants.
Étape 3 : ajouter progressivement les classes CSS contractuelles.
Étape 4 : migrer les styles validés de boutique-wow.css vers les fichiers propriétaires.
Étape 5 : utiliser les nouveaux champs sourcing quand le backend les expose.
```

## Checklist avant ajout d'un nouveau type produit

```txt
[ ] Le produit source est conservé en brut.
[ ] Il est normalisé en produit Komerce.
[ ] Le ViewModel sait produire un affichage stable.
[ ] Les classes CSS existent ou sont ajoutées au contrat.
[ ] Le renderer ne reçoit pas de logique fournisseur spécifique.
[ ] Le CSS ne dépend pas du fournisseur.
[ ] Les données manquantes ont un fallback.
```

## Position actuelle

Ce contrat est une fondation.

Il ne doit pas tout refactorer d'un coup.

La priorité est de créer un point de passage clair :

```txt
product → ProductCardViewModel → renderer → CSS
```

C'est ce qui permettra à Komerce d'absorber le sourcing réel sans casser la boutique.

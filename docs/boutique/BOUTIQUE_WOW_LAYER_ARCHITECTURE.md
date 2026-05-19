# Boutique Komerce — Wow Layer Architecture & FOUC Strategy

## Objectif

Ce document décrit le statut architectural de la couche `boutique-wow.css`, les décisions prises pendant les tests mobile/desktop, les risques de FOUC, et le chemin de stabilisation recommandé.

Il complète :

```txt
docs/BOUTIQUE_COMPONENT_OWNERSHIP.md
```

## Statut actuel de `boutique-wow.css`

`public/boutique/css/boutique-wow.css` est une couche de polish visuel réversible.

Elle a été créée pour tester rapidement une direction premium sans modifier brutalement les fichiers historiques :

```txt
categories.css
hero.css
products.css
boutique-desktop.css
b-pager.js
```

Elle ne doit pas être considérée comme une nouvelle source métier ou structurelle.

## Ce que la couche wow possède aujourd'hui

La couche wow possède uniquement des améliorations visuelles :

```txt
- micro-polish des chips catégories mobile ;
- passage du rail catégories mobile vers une version visibility-first ;
- style du proverbe mobile déplacé dans .k-cats-shell ;
- petit voile de lisibilité sur le slogan hero mobile ;
- polish carte produit / modal / desktop ;
- glass/premium effect desktop sur header, hero, sidebar, side-cart.
```

Elle ne doit pas posséder :

```txt
- la structure HTML ;
- le rendu des chips ;
- le calcul du pager ;
- le panier ;
- le catalogue ;
- la logique produit ;
- les transitions de statut ;
- les règles métier.
```

## Pourquoi une couche wow séparée ?

### Avantages

```txt
1. Réversibilité
   On peut désactiver le polish rapidement sans démolir les fichiers sources.

2. Vitesse d'expérimentation
   Les tests mobile/desktop peuvent être itérés vite.

3. Isolation du risque
   Le moteur mobile b-pager.js reste protégé.

4. Comparaison visuelle simple
   On peut voir clairement ce qui relève de la couche premium.

5. Pas de refactor massif
   On évite de mélanger redesign et nettoyage architectural.
```

### Inconvénients

```txt
1. Double couche CSS
   Une règle peut compenser une autre règle historique.

2. Risque de dette technique
   Si elle reste trop longtemps, on ne sait plus quelle feuille est la vérité.

3. FOUC possible
   Si la couche est chargée dynamiquement après le HTML/CSS initial, certains éléments peuvent flasher.

4. Spécificité implicite
   Des sélecteurs dans boutique-wow.css peuvent devenir des overrides permanents sans être assumés.

5. Difficulté de debug
   Le rendu final dépend de l'ordre de chargement des CSS et du JS loader.
```

## Statut recommandé : temporaire ou définitif ?

### Court terme

`boutique-wow.css` doit rester temporaire pendant la phase de test.

Objectif : valider la direction visuelle.

### Moyen terme

Quand la direction mobile/desktop est validée, la couche wow doit être découpée et migrée vers les fichiers propriétaires :

```txt
- catégories mobile/base      → categories.css
- hero mobile/base            → hero.css
- cartes produit              → products.css
- modal produit               → modal.css
- desktop premium             → boutique-desktop.css
- mini règles JS du proverbe  → module dédié ou home-controller selon propriété
```

### Long terme

`boutique-wow.css` doit soit :

```txt
A. disparaître complètement après migration ;
```

soit rester comme :

```txt
B. feature layer assumée pour A/B test, nommée et contrôlée par flag.
```

La recommandation actuelle est **A : migrer puis supprimer**.

## FOUC — ce qui se passe aujourd'hui

FOUC signifie : flash of unstyled content.

Dans notre cas, le FOUC peut apparaître quand :

```txt
1. index.html rend un état initial ;
2. CSS historiques s'appliquent ;
3. main.js charge la couche wow ;
4. JS déplace le proverbe ;
5. b-pager.js recalcule la cage ;
6. le rendu final se stabilise.
```

Exemples observés :

```txt
- emoji 👀 visible au premier rendu puis masqué ;
- petite bulle hero visible puis disparue ;
- proverbe injecté mais invisible car son parent était masqué ;
- anciens textes hero réapparus quand .k-hero-overlay a été réactivé ;
- décalage entre --pager-top et top inline #k-page-scroll.
```

## Peut-on éviter le FOUC ?

Oui, mais il faut distinguer deux niveaux.

### Niveau 1 — réduire fortement le FOUC

Actions simples :

```txt
- charger boutique-wow.css directement dans index.html au lieu de le charger via JS ;
- enlever les fallbacks visuels parasites du HTML source, par exemple l'emoji 👀 ;
- éviter que le HTML initial affiche des éléments que JS va ensuite masquer ;
- garder les dimensions stables dès le CSS initial ;
- précharger les assets hero / avatar / catégories ;
- bump de version CSS quand nécessaire.
```

### Niveau 2 — supprimer presque totalement le FOUC

Actions plus structurelles :

```txt
- migrer les règles validées de boutique-wow.css vers leurs fichiers propriétaires ;
- éviter les mutations DOM tardives visibles ;
- placer le proverbe directement au bon endroit dans le HTML ou le renderer propriétaire ;
- remplacer les contenus fallback par de vrais assets dès le HTML ;
- ne plus dépendre d'un loader JS pour la couche visuelle stable.
```

## Recommandation FOUC pour Komerce

### Maintenant

Pour continuer les tests, la couche wow peut rester dynamique.

Mais les parasites visibles doivent être corrigés à la source :

```txt
- supprimer l'emoji 👀 du HTML ;
- restaurer la petite dame avec un asset stable ;
- ne jamais réactiver .k-hero-overlay mobile ;
- garder #k-proverb-text déplacé dans .k-cats-shell tant que le HTML n'est pas remanié ;
- garder b-pager.js responsable du top réel de #k-page-scroll.
```

### Après validation visuelle

Quand Sam valide le rendu mobile, il faut faire une PR de stabilisation :

```txt
PR: stabilize boutique wow layer into owned files
```

Objectifs :

```txt
- déplacer les règles catégories vers categories.css ;
- déplacer les règles hero vers hero.css ;
- déplacer les règles cards vers products.css ;
- déplacer les règles desktop vers boutique-desktop.css ;
- supprimer b-boutique-wow-style.js si plus nécessaire ;
- supprimer boutique-wow.css si tout est migré ;
- mettre à jour les versions CSS dans index.html.
```

## Règles spécifiques au hero mobile

Le hero mobile a deux responsabilités distinctes :

```txt
1. Image de marque : illustration, slogan, ambiance Komerce.
2. Navigation : rail catégories + proverbe + accès catalogue.
```

À ne pas faire :

```txt
- ne pas réactiver .k-hero-overlay en mobile ;
- ne pas remettre les anciens pills hero au-dessus du rail ;
- ne pas utiliser un emoji comme élément brand définitif ;
- ne pas masquer le slogan par excès de transparence ;
- ne pas faire du rail catégories un second hero.
```

À faire :

```txt
- garder le slogan "Qui cherche ! Trouve !" lisible ;
- garder le rail catégories compact et lisible ;
- utiliser un vrai asset pour la petite dame/avatar ;
- garder le proverbe comme micro-signal émotionnel, pas comme bloc commercial lourd ;
- garder le catalogue proche mais respirant.
```

## Règles spécifiques au rail catégories mobile

Direction validée actuellement :

```txt
visibility-first compact strip
```

Cela veut dire :

```txt
- image = repère visuel ;
- texte = priorité ;
- chips en mini-pilules ;
- grille 2×4 conservée ;
- catégorie active claire ;
- bloc léger, pas une grosse carte ;
- proverbe discret sous les chips.
```

Ce rail ne doit pas :

```txt
- manger le hero ;
- masquer le slogan ;
- devenir un carrousel lourd ;
- créer une hauteur excessive ;
- casser le calcul de --pager-top.
```

## Règles spécifiques au pager mobile

`b-pager.js` reste propriétaire de :

```txt
- --pager-top ;
- --pager-h ;
- top inline de #k-page-scroll ;
- scroll horizontal des catégories ;
- scroll vertical intra-page ;
- ghost loop ;
- bounce next category.
```

La couche wow ne doit pas modifier ces mécaniques.

La règle actuelle :

```txt
_recalcPagerVars() prend le bas réel de .k-cats-shell comme ancrage visuel principal.
```

## Décision sur le proverbe

Le proverbe est un signal de marque Komerce.

Statut : validé en principe.

Implémentation actuelle :

```txt
#k-proverb-text existe dans le HTML initial ;
b-boutique-wow-style.js le déplace dans .k-cats-shell ;
un proverbe aléatoire est choisi à chaque rechargement.
```

Limite : cette mutation DOM peut participer au FOUC.

Stabilisation future recommandée :

```txt
mettre le slot proverbe directement au bon endroit dans le HTML ou dans le composant propriétaire du rail.
```

## Checklist avant de supprimer la couche wow

```txt
[ ] Rail catégories mobile validé visuellement.
[ ] Slogan hero lisible.
[ ] Petite dame/avatar restaurée avec un asset stable.
[ ] Emoji fallback supprimé du HTML.
[ ] Proverbe visible et non intrusif.
[ ] Catalogue proche du rail sans chevauchement.
[ ] #k-page-scroll top cohérent avec --pager-top.
[ ] Aucun ancien overlay/pill hero ne réapparaît.
[ ] Desktop inchangé ou validé.
[ ] Règles wow migrées dans fichiers propriétaires.
[ ] b-boutique-wow-style.js supprimé ou renommé comme feature flag assumé.
[ ] boutique-wow.css supprimé ou documenté comme layer officiel.
```

## Position recommandée aujourd'hui

La couche wow est une **couche d'expérimentation maîtrisée**.

Elle ne doit pas devenir définitive telle quelle.

La bonne trajectoire :

```txt
Tester vite avec boutique-wow.css
→ valider visuellement
→ corriger les FOUC visibles à la source
→ migrer dans les fichiers propriétaires
→ supprimer ou flagger la couche wow
```

Cela garde l'architecture saine tout en permettant d'innover rapidement.

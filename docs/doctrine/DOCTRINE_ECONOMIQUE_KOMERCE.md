# Doctrine économique Komerce

> **Version** : 3.0 — 2026-09-08  
> **Statut** : document fondamental canonique  
> **Classification des charges** : `DOCTRINE_CLASSIFICATION_CHARGES.md`  
> **Flux / équilibre** : `DOCTRINE_FLUX_CONTRIBUTION_POINT_EQUILIBRE.md`  
> **Pricing / marché** : `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`

---

## 1. Phrase de vérité

> **Le prix est d'abord contraint par ce que le client est réellement prêt à payer sur son marché. Le moteur mesure ensuite la contribution possible et vérifie si le portefeuille peut couvrir durablement les charges de structure.**

Komerce ne fabrique donc pas un prix en additionnant artificiellement une quote-part de charges fixes à chaque SKU.

La chaîne canonique est :

```text
coût d'achat
→ charges variables réelles
→ coût variable complet
→ borne de marché
→ prix décidé
→ contribution unitaire
→ volumes et mix réels
→ contribution totale du portefeuille
→ couverture des charges fixes directes + mutualisées
→ résultat
```

> **Le marché borne le prix. Le coût détermine l'espace disponible. La contribution mesure ce que le produit peut réellement apporter. Le portefeuille absorbe collectivement les charges de structure.**

---

## 2. Classification canonique des charges

Les labels N1 / N2 / N3 disparaissent du vocabulaire métier et UI.

Chaque charge possède trois dimensions indépendantes :

| Dimension | Question | Valeurs typiques |
|---|---|---|
| **Nature** | Comment évolue le coût ? | Variable / Fixe |
| **Périmètre** | Qui porte initialement le coût ? | Direct / Mutualisé |
| **Allocation** | Comment l'attribue-t-on ? | article / commande / colis / shipment / marché / usage / GMV / période… |

### Variable

Une charge est variable lorsque l'activité supplémentaire la fait augmenter.

Exemples : achat fournisseur, fret variable, douane liée au flux, paiement, emballage par colis, commission par retrait, usage réellement mesuré.

### Fixe

Une charge est fixe lorsqu'elle existe sur une période indépendamment d'une vente particulière.

Exemples : salaires fixes, loyer, abonnement SaaS, minimum plateforme, équipe support, marketing structurel.

### Directe

Une charge directe appartient sans partage à un périmètre métier identifié.

### Mutualisée

Une charge mutualisée est portée par un périmètre commun puis répartie entre plusieurs marchés ou activités selon une clé explicite, versionnée et traçable.

Exemples : Hub régional, Railway, équipe centrale, outils SaaS communs, infrastructure groupe.

> **Mutualisé n'est pas une nature économique : une charge mutualisée peut être fixe ou variable.**

---

## 3. Allocation et causalité

Le niveau d'engagement d'une charge ne change pas sa nature.

```text
frais paiement commande
→ VARIABLE + DIRECT à la commande
→ réparti une seule fois sur les articles concernés

fret shipment
→ VARIABLE + DIRECT au shipment
→ réparti une seule fois selon la règle logistique canonique

Railway abonnement
→ FIXED + MUTUALIZED
→ quote-part marché selon politique gouvernée

Railway usage
→ VARIABLE + MUTUALIZED
→ quote-part marché selon consommation réelle
```

Un coût commande/colis n'est donc pas « mutualisé » simplement parce qu'il est réparti entre plusieurs articles.

---

## 4. Coût variable complet

Le coût variable complet représente tout ce que la vente doit réellement couvrir avant de créer de la contribution.

```text
coût_variable_complet
  = somme de toutes les charges VARIABLES attribuées une seule fois à la vente
```

Il peut inclure des charges variables directes et des quotes-parts variables mutualisées si elles sont causalement mesurables et allouées selon une règle canonique.

Une vente sous le coût variable complet détruit directement de la valeur.

---

## 5. La contribution

```text
contribution_unitaire
  = prix_encaissé
    - coût_variable_complet
```

L'article vendu est l'origine économique de la contribution.

Commande et colis sont des vues d'agrégation de cette même contribution ; ils ne créent jamais une contribution supplémentaire.

```text
contribution_commande = Σ contributions des articles de la commande
contribution_colis    = Σ contributions des articles du colis
contribution_période  = Σ contributions des articles vendus de la période
```

> **Une contribution, plusieurs vues. Jamais plusieurs contributions additionnées.**

---

## 6. Charges de période à couvrir

Les charges de structure du marché sont :

```text
charges_à_couvrir_période
  = charges FIXED directes du marché
    + quotes-parts FIXED mutualisées attribuées au marché
```

Exemples :

- salaires fixes pays ;
- loyer local ;
- outils locaux fixes ;
- quote-part Hub régional ;
- quote-part Railway fixe ;
- quote-part équipe centrale ;
- autres charges fixes normales de période.

Une charge fixe par palier de capacité reste fixe dans son palier. Un changement de capacité crée un nouveau scénario de structure.

---

## 7. Le produit ne supporte pas seul la structure

Il est interdit de fabriquer le prix d'un SKU en lui collant une « dette » arbitraire de charges fixes.

Le produit porte :

- son coût d'achat ;
- ses charges variables attribuées ;
- sa capacité contributive dans la borne de marché.

Le portefeuille vendu porte collectivement la couverture des charges fixes.

Exemple :

```text
Produit A : 5 000 de contribution × 100 ventes = 500 000
Produit B : 2 000 de contribution × 200 ventes = 400 000
Produit C : 10 000 de contribution × 30 ventes = 300 000

Contribution portefeuille = 1 200 000
```

La structure est comparée à ce pool unique de 1 200 000, pas imputée artificiellement produit par produit.

---

## 8. Le marché borne la capacité contributive

Pour chaque SKU ou catégorie, Komerce maintient un corridor de marché défendable :

```text
borne basse
borne cible
borne haute
borne très haute éventuelle
```

Ces bornes décrivent ce que le client peut raisonnablement accepter sur le marché concerné.

À chaque position de prix :

```text
contribution_possible(prix)
  = prix
    - coût_variable_complet
```

La capacité contributive du SKU est donc bornée.

Le moteur ne doit jamais répondre à un problème structurel par un prix commercialement irréaliste.

Si même la borne haute ne permet pas au portefeuille de couvrir durablement les charges, le problème se situe ailleurs :

- coût d'achat ;
- fret / douane / exécution ;
- charges fixes ;
- mutualisation ;
- volume ;
- mix produit ;
- capacité / organisation.

> **Le prix ne peut pas résoudre ce que le marché n'accepte pas.**

---

## 9. Besoin contributif moyen : indicateur, pas dette SKU

Le moteur peut traduire le gap restant en contribution moyenne requise :

```text
contribution_moyenne_requise
  = reste_à_couvrir
    / volume_projeté_ou_équivalent
```

Cette valeur sert au pilotage du portefeuille.

Elle ne signifie jamais que chaque SKU « doit » exactement ce montant.

Le bon diagnostic compare :

```text
contribution moyenne requise
vs
contribution moyenne réalisable au mix et aux bornes marché
```

---

## 10. Couverture et résultat

```text
couverture
  = contribution_totale_réconciliée
    / charges_à_couvrir_période

reste_à_couvrir
  = max(0, charges_à_couvrir_période - contribution_totale_réconciliée)

résultat_période
  = contribution_totale_réconciliée
    - charges_à_couvrir_période
```

Lecture :

```text
< 100 %  → structure non couverte
= 100 %  → équilibre économique
> 100 %  → structure couverte, résultat positif
```

Le gap monétaire est la vérité primaire. Les articles, commandes ou colis équivalents sont des traductions opérationnelles du même gap au mix actuel.

---

## 11. Le volume et le mix modifient la vitesse de couverture

La contribution unitaire d'un SKU ne baisse pas mécaniquement avec le volume.

Ce qui change avec le volume global est la vitesse à laquelle la structure est absorbée.

```text
contribution_totale
  = Σ quantité_SKU × contribution_unitaire_SKU
```

Le mix compte autant que le volume : 200 articles à 1 000 de contribution ne valent pas économiquement 200 articles à 8 000 de contribution.

Le moteur publie donc la contribution moyenne pondérée du portefeuille et peut traduire le gap en unités équivalentes au mix actuel.

---

## 12. Modèle dynamique : hypothèse → réel

L'Atelier économique est vivant.

Toute valeur affichée porte une nature explicite :

| Type | Sens | Éditable ? |
|---|---|---|
| **MEASURE** | réel constaté / réconcilié | non |
| **ASSUMPTION** | hypothèse faute de réel suffisant | oui, explicitement marquée |
| **POLICY** | décision gouvernée | oui selon autorité |
| **COST** | charge économique | oui selon autorité |
| **DERIVED** | résultat calculé par le moteur | jamais directement |

Trajectoire canonique :

```text
ASSUMPTION → données suffisantes → MEASURED CALIBRATION
```

Exemples de valeurs qui doivent progressivement apprendre du flux réel :

- articles / commande ;
- commandes / colis ;
- coût fret ;
- coût paiement ;
- taux SAV / risque ;
- mix catégorie ;
- usage Railway ;
- allocation Hub ;
- prix réellement accepté ;
- volumes.

---

## 13. Propagation automatique

Toute modification d'un levier économique doit provoquer un recalcul serveur de ses impacts.

Exemple :

```text
coût achat -2 000
→ coût variable complet -2 000
→ contribution +2 000
→ contribution portefeuille recalculée
→ couverture recalculée
→ reste à couvrir recalculé
→ seuil d'équilibre recalculé
```

Ou :

```text
quote-part Hub +500 000
→ charges à couvrir +500 000
→ couverture baisse
→ gap augmente
→ unités équivalentes restantes augmentent
```

Le navigateur ne redérive jamais la vérité métier :

```text
SOURCE MÉTIER → MOTEUR → AGRÉGATEUR → WORKSPACE / DASHBOARD
```

---

## 14. Contrat UI de l'Atelier

La page principale ne doit montrer que ce qui aide à comprendre ou à décider.

### En haut : quelques indicateurs dérivés

Maximum attendu :

- charges à couvrir ;
- contribution générée ;
- couverture ;
- reste à couvrir ;
- contribution moyenne / article ;
- éventuellement unités équivalentes restantes au mix actuel.

Les valeurs dérivées sont non éditables et visuellement plus discrètes.

### Zone charges

Deux lectures simples :

- charges fixes directes ;
- charges mutualisées avec clé d'allocation visible.

Une porte d'entrée permet d'affiner, compléter et administrer les catégories sans surcharger la page principale.

### Zone portefeuille

Par catégorie puis produit / SKU :

- coût d'achat ;
- coût variable complet ;
- borne basse / cible / haute / très haute ;
- prix décidé ;
- contribution unitaire ;
- quantité réelle / projetée ;
- contribution totale générée.

Les champs actionnables sont visuellement distincts des résultats dérivés.

---

## 15. Règles à ne pas casser

- N1 / N2 / N3 ne sont plus du vocabulaire métier ni UI canonique.
- Toute charge est classée par nature, périmètre et allocation.
- Mutualisé est distinct de fixe / variable.
- Les coûts commande/colis ne sont pas « mutualisés » par nature.
- Le prix est borné par le marché, pas fabriqué par la structure.
- Le coût variable complet doit être couvert avant contribution positive.
- Les charges fixes ne deviennent jamais une dette du SKU.
- Le portefeuille absorbe collectivement la structure.
- Une contribution unique peut être lue par article, commande ou colis mais jamais additionnée plusieurs fois.
- Les hypothèses doivent converger vers le réel lorsque les données deviennent suffisantes.
- Les valeurs dérivées ne sont jamais éditables directement.
- Toute mutation passe par l'autorité métier et déclenche un recalcul serveur ; aucun calcul économique parallèle dans le navigateur.

---

## 16. Compatibilité technique

Des noms internes historiques `n1`, `n2`, `n3` peuvent subsister temporairement dans les tables, services, migrations ou contrats existants.

Ils sont des aliases techniques de compatibilité et ne doivent plus être exposés comme concepts métier.

Leur migration interne doit être traitée séparément, sous gates et preuve de non-régression.

---

## 17. Phrase de contrôle

> **À combien le client est-il réellement prêt à acheter ce produit ? Quelle contribution pouvons-nous générer dans cette borne, et le portefeuille ainsi constitué couvre-t-il durablement nos charges fixes directes et mutualisées ?**

C'est la question économique canonique de Komerce.
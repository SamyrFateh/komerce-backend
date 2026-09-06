# Doctrine Pricing ancré marché & viabilité Komerce

> **Version** : 1.0 — 2026-09-06
> **Statut** : document fondamental du moteur économique
> **Complète** : `DOCTRINE_ECONOMIQUE_KOMERCE.md`, `DOCTRINE_ALLOCATION_COUTS.md`, `DOCTRINE_DENSITE_VALEUR.md`, `DOCTRINE_MOTEUR_ECONOMIQUE_STRATEGIE.md`

---

## 1. Phrase de vérité

> **Le CDR dit la vérité économique. Le marché borne le prix acceptable. La contribution et la couverture réelle du portefeuille disent si ce prix est viable.**

Komerce ne fixe jamais durablement un prix par un coefficient arbitraire appliqué au coût (`+40 %`, `x2`, `x4`, etc.).

Le moteur calcule les coûts et les frontières. Le marché fournit une contrainte de réalité. L'humain décide un prix en connaissant sa contribution et ses conséquences sur la viabilité du marché.

---

## 2. Ce qui reste intangible

```text
N1 = coût rendu relais
N2 = business variable
Coût variable complet = N1 + N2
N3 = charges fixes de période imputées
CDR complet = N1 + N2 + N3
Contribution = prix décidé - coût variable complet
```

Le **plancher économique** part toujours du coût variable complet réel. Le marché ne fixe jamais ce plancher.

Une vente sous le coût variable complet est destructrice. Elle ne peut être autorisée qu'exceptionnellement avec validation humaine explicite, motif, durée et traçabilité.

`minimum_safe_price != CDR complet` reste un invariant.

---

## 3. N3 n'est pas une dette du SKU

N3 représente une convention d'imputation de charges de période. Un article ne « doit » pas individuellement sa quote-part N3.

Vendre sous le CDR complet mais au-dessus du coût variable complet signifie :

```text
la vente contribue positivement aux charges fixes,
mais ne couvre pas à elle seule la quote-part N3 qui lui a été imputée.
```

L'écart au CDR est donc un **indicateur de mix et de couverture**, pas une dette produit.

La question économique correcte est :

```text
Somme des contributions réalisées sur la période >= charges fixes réelles de la période ?
```

---

## 4. Verrou fondamental : réalisé pour imputer, objectif pour simuler

Il est interdit d'utiliser un objectif commercial comme vérité de référence pour dégonfler N3.

### Référence

Le CDR de référence utilise des dénominateurs **réalisés ou calibrés sur données réelles** :
- commandes réellement observées ;
- articles réellement observés par commande ;
- articles réellement observés par colis ;
- volume/poids réellement observé par shipment selon la doctrine transport.

### Projection

`objectif_commandes_mois`, les volumes cibles et les ratios futurs servent uniquement aux **scénarios prospectifs**. Ils doivent être présentés comme hypothèses et ne remplacent jamais la référence réalisée.

Tout fallback ou ratio non calibré dégrade explicitement la confiance. Un CDR calculé sur un dénominateur par défaut ou de confiance basse ne peut pas servir silencieusement à autoriser une stratégie agressive.

---

## 5. Contrôle de viabilité : portefeuille et période

Le contrôle de sous-couverture est global :

```text
coverage_ratio = Σ contributions réalisées / charges fixes réelles
```

Lecture :
- `coverage_ratio >= 1` : les contributions couvrent les charges fixes de période ;
- `coverage_ratio < 1` : le portefeuille ne couvre pas la structure.

Une stratégie de prix sous le CDR complet ne peut jamais être justifiée par le seul mérite du SKU. Elle dépend de l'état réel du portefeuille.

Le dashboard doit publier au minimum :
- contribution totale de période ;
- charges fixes réelles ;
- ratio de couverture ;
- distribution des commandes contributives ;
- part des commandes sous coût variable ;
- contribution par marché ;
- écart imputé vs réel.

---

## 6. Mesurer au niveau où le coût est engagé

La moyenne seule ne suffit pas.

- **Article** : coût variable et contribution unitaire.
- **Commande** : contribution réelle de commande, notamment panier mono-produit.
- **Colis** : densité, poids, volume et coûts logistiques réels.
- **Shipment** : remplissage, allocation réelle, marge par m³ / poids taxable selon mode.
- **Période** : couverture des charges fixes et profit global.

Le panier moyen reste un indicateur utile mais ne constitue jamais, seul, une preuve de viabilité.

---

## 7. Les quatre repères prix canoniques

| Repère | Nature | Autorité |
|---|---|---|
| **Prix plancher** | mécanique, dur | moteur économique |
| **Prix de couverture complète** | référence comptable / économique | moteur économique |
| **Prix marché observé** | réalité externe / terrain | données comparables |
| **Prix décidé** | arbitrage commercial assumé | humain autorisé |

Le terme `recommended_price` ne doit plus être interprété comme un ordre de vente. Il représente au mieux une **référence mécanique de couverture complète** tant que le marché réel n'est pas intégré.

Un vrai prix de test marché peut se situer entre le plancher variable et le CDR complet, à condition que sa contribution et la couverture portefeuille soient visibles.

---

## 8. Ancrage marché

Komerce compare des produits **strictement identiques** lorsque possible : même marque, modèle, capacité, variante et condition.

Amazon, Noon ou d'autres acteurs sont des références de plausibilité, jamais une source de plancher économique.

La comparaison pertinente est le **coût alternatif rendu réellement accessible au client** :

```text
prix plateforme + transport + douane éventuelle + délai + risque + disponibilité
```

Un prix concurrent inférieur au plancher Komerce ne justifie jamais une vente destructrice. Il indique soit :
- une structure de coût Komerce non compétitive ;
- un produit inadapté à ce marché ;
- un besoin de densité / volume supérieur ;
- ou un avantage concurrent impossible à reproduire.

---

## 9. Densité, rotation et fréquence

La densité logistique est un vrai déterminant économique lorsqu'elle modifie les coûts réellement engagés.

La rotation et la fréquence d'expédition ne doivent jamais devenir des coefficients arbitraires de prix. Elles influencent le pricing uniquement si elles modifient explicitement un coût réel modélisé : stockage, capital immobilisé, remplissage, cadence de shipment, etc. Sinon elles restent des signaux de sourcing et d'opérations.

---

## 10. Gouvernance des hypothèses

Toute modification de :
- `objectif_commandes_mois` ;
- `avg_articles_per_order` ;
- `avg_articles_per_parcel` ;
- `avg_articles_per_shipment` ;
- charges fixes ;
- marge cible ;
- marge de sécurité ;
- seuils de santé ;

doit être versionnée avec auteur, date, motif, valeur avant/après et impact calculé.

Aucune modification de ces paramètres ne doit pouvoir créer de dette silencieuse. Les hypothèses agressives nécessitent une validation humaine explicite.

---

## 11. Réconciliation obligatoire avant refonte du prix

Avant de modifier la logique de fixation des prix en profondeur, Komerce doit disposer de la réconciliation :

```text
coût imputé théorique vs coût engagé réel
```

Cette phase est le juge du modèle. Sans elle, ni une formule de marge ni une intuition de marché ne peuvent être validées objectivement.

Ordre doctrinal :
1. mesurer le réel ;
2. réconcilier l'imputé et le réel ;
3. recalibrer les ratios ;
4. calculer la couverture portefeuille ;
5. observer le marché ;
6. décider le prix.

---

## 12. Stratégies temporaires et règle d'arrêt

Toute stratégie `loss_leader`, `conquest`, sous-couverture ou prix manuel sous CDR complet doit avoir :
- un motif ;
- une date d'effet ;
- une date de fin ;
- un indicateur de compensation ;
- un seuil d'arrêt ;
- un responsable de validation.

À expiration, la stratégie doit être réexaminée. Aucune sous-couverture temporaire ne peut devenir permanente par oubli.

---

## 13. Interdictions

- Interdit : `prix = coût × coefficient` comme règle unique.
- Interdit : utiliser le marché pour définir le plancher économique.
- Interdit : utiliser un objectif non réalisé comme dénominateur de référence N3.
- Interdit : masquer une confiance faible dans un CDR exploitable sans signal fort.
- Interdit : juger la viabilité du portefeuille uniquement par un panier moyen.
- Interdit : autoriser une sous-couverture produit sans contrôle de couverture globale.
- Interdit : modifier les ratios d'allocation sans historique et justification.
- Interdit : laisser une stratégie temporaire sans mécanisme d'expiration.

---

## 14. Phrase de contrôle

Avant de valider un prix, poser quatre questions :

1. **Quel est le plancher variable réel ?**
2. **Quelle contribution ce prix génère-t-il ?**
3. **Le portefeuille et le shipment couvrent-ils réellement la structure ?**
4. **Ce prix est-il crédible dans le marché réel ?**

Si l'une de ces réponses est inconnue, le système doit le dire explicitement au lieu de fabriquer une fausse précision.

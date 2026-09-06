# Doctrine Pricing ancré marché & viabilité Komerce

> **Version** : 1.1 — 2026-09-06
> **Statut** : document fondamental du moteur économique — draft avant merge
> **Complète** : `DOCTRINE_ECONOMIQUE_KOMERCE.md`, `DOCTRINE_ALLOCATION_COUTS.md`, `DOCTRINE_DENSITE_VALEUR.md`, `DOCTRINE_MOTEUR_ECONOMIQUE_STRATEGIE.md`

---

## 1. Phrase de vérité

> **Komerce cherche le prix le plus juste, soutenable pour le client et pour le modèle.**

Le moteur calcule la vérité des coûts. Le marché borne la plausibilité commerciale. La contribution mesure ce que chaque vente apporte. La couverture de période dit si le modèle est viable. L'humain autorisé décide le prix dans les limites des gates et avec traçabilité.

Komerce ne fixe jamais durablement un prix par un coefficient arbitraire appliqué au coût (`+40 %`, `x2`, `x4`, etc.).

---

## 2. Ce qui reste intangible

```text
N1 = coût rendu relais
N2 = business variable
Coût variable complet = N1 + N2
N3 = charge de structure imputée pour lecture du CDR
CDR complet = N1 + N2 + N3
Contribution = prix décidé - coût variable complet
```

Le **plancher économique** part toujours du coût variable complet réel ou réconcilié au niveau de confiance requis. Le marché ne fixe jamais ce plancher.

Une vente sous le coût variable complet est destructrice. Elle ne peut être autorisée qu'exceptionnellement avec validation humaine explicite, motif, durée, budget stratégique et traçabilité.

`minimum_safe_price != CDR complet` reste un invariant.

---

## 3. N3 n'est pas une dette du SKU

N3 représente une convention d'imputation d'une **charge économique de période**. Un article ne « doit » pas individuellement sa quote-part N3.

Vendre sous le CDR complet mais au-dessus du coût variable complet signifie :

```text
la vente contribue positivement à la couverture de la structure,
mais ne couvre pas à elle seule la quote-part N3 qui lui a été imputée pour lecture.
```

L'écart au CDR est donc un **indicateur de mix et de couverture**, pas une dette produit.

La vérité de structure se juge au niveau de période :

```text
Somme des contributions réconciliées de la fenêtre
>= charge économique de la même fenêtre ?
```

Trois notions sont distinctes :

- **décaissement** : date à laquelle le cash sort ;
- **charge économique de période** : coût réel rattaché à la période où il est économiquement consommé ;
- **budget / configuration** : projection ou hypothèse, jamais vérité de couverture.

---

## 4. Réalisé pour référencer, objectif pour simuler

Il est interdit d'utiliser un objectif commercial comme vérité de référence pour dégonfler N3 ou améliorer artificiellement le CDR.

Les dénominateurs de référence sont **réalisés ou calibrés sur données réelles**, avec fenêtre mécanique, échantillon minimum et confiance visible : commandes réellement observées, articles par commande, articles par colis, volume / poids réellement observé par shipment selon la doctrine transport.

Les paramètres de calibration sont gouvernés. Une valeur calculée sur un échantillon insuffisant peut rester visible comme hypothèse mais ne devient pas une référence décisionnelle.

`objectif_commandes_mois`, volumes cibles et ratios futurs servent uniquement aux **scénarios prospectifs**. Tout fallback ou ratio non calibré dégrade explicitement la confiance et ne peut pas servir silencieusement à autoriser une stratégie agressive.

---

## 5. Couverture de période : gate canonique

La couverture gouverne l'autorisation d'ouvrir de nouvelles positions sous CDR complet.

### Fenêtre canonique

Le gate utilise une **fenêtre glissante de largeur fixe** se terminant au **watermark de maturité**. Aucun rôle ne choisit manuellement les dates du verrou.

Le dashboard peut afficher d'autres périodes d'analyse, mais elles ne pilotent jamais le gate canonique.

### Watermark de maturité

Une commande est réconciliée lorsque les coûts variables qui la concernent ont atteint leur état de vérité requis : shipment clos pour les coûts logistiques applicables, douane liquidée quand applicable, commission relais réellement constatée, frais de paiement réellement constatés et autres coûts variables requis réconciliés selon leur niveau d'engagement.

Le watermark est la dernière date jusqu'à laquelle la fenêtre peut être évaluée sans sélectionner les bonnes commandes et laisser les mauvaises en attente.

### Maturité

```text
maturity_ratio = commandes réconciliées de la fenêtre / commandes totales de la fenêtre
```

Une donnée immature ne devient jamais un chiffre rassurant :

```text
si maturity_ratio < maturity_threshold:
  coverage_ratio = null
  coverage_status = NOT_DECISIONAL
```

`NOT_DECISIONAL` a le même effet d'autorisation que `UNCOVERED`, sans falsifier le ratio.

### Ratio de couverture

Numérateur et dénominateur portent sur la même fenêtre économique :

```text
coverage_ratio = Σ contributions réconciliées / charge économique de période
```

Le ratio ne se calcule pas à partir de décaissements bruts si ceux-ci couvrent une autre période économique.

### États du gate

| État | Condition | Effet |
|---|---|---|
| `COVERED` | maturité >= seuil ET ratio >= seuil de couverture | ouverture possible d'une stratégie sous CDR |
| `UNCOVERED` | maturité >= seuil ET ratio < seuil de couverture | aucune nouvelle sous-couverture |
| `NOT_DECISIONAL` | maturité < seuil ou données critiques absentes | même effet que `UNCOVERED`, ratio `null` |

Le gate ne bloque pas automatiquement les ventes et ne repricie pas un produit. Il ferme l'ouverture de **nouvelles** positions sous CDR.

---

## 6. Mesurer au niveau où le coût devient vrai

- **Article** : achat produit et coûts propres à l'article.
- **Commande** : frais de paiement, commission relais et autres coûts de commande réellement constatés.
- **Colis** : emballage, transport local, poids et volume constatés.
- **Shipment** : fret, douane, port, transitaire, densité et allocation réelle ; le shipment est la cohorte de vérité de N1 logistique.
- **Période** : provision risque réconciliée, charge économique de structure, budgets stratégiques consommés et viabilité globale.

Le panier moyen reste un indicateur utile mais ne constitue jamais, seul, une preuve de viabilité.

La distribution doit être visible : part de commandes mono-article, part de commandes sous coût variable de commande, distribution de contribution par commande, concentration de contribution par produit / catégorie / marché.

Par défaut, une commande mono-article couvre son coût variable de commande. Une exception n'est autorisée que si elle est financée par un budget stratégique gouverné.

---

## 7. Les quatre repères prix canoniques

| Repère | Nature | Autorité |
|---|---|---|
| **Prix plancher** | mécanique, dur | moteur économique |
| **Prix de couverture complète** | référence économique / comptable | moteur économique |
| **Prix marché observé** | réalité externe / terrain | données comparables vérifiées |
| **Prix décidé** | arbitrage commercial assumé | humain autorisé, sous gates |

`recommended_price` reste transitoirement une référence mécanique de couverture complète pour compatibilité.

Un vrai prix de test marché peut se situer entre le plancher variable et le CDR complet **uniquement si le gate de couverture l'autorise** et si contribution, écart au CDR, motif, durée et budget éventuel sont tracés.

---

## 8. Ancrage marché

Komerce compare des produits **strictement identiques** lorsque possible : même marque, modèle, capacité, variante et condition.

Amazon, Noon ou d'autres acteurs sont des références de plausibilité, jamais une source de plancher économique.

La comparaison pertinente est le **coût alternatif rendu réellement accessible au client** :

```text
prix plateforme + transport + douane éventuelle + délai + risque + disponibilité
```

Sans comparable strict suffisamment fiable :

```text
market_anchor_status = NO_STRICT_COMPARABLE
```

Aucun corridor canonique n'est inventé par approximation.

---

## 9. Densité, rotation et fréquence

La densité logistique est un déterminant économique lorsqu'elle modifie les coûts réellement engagés.

La rotation et la fréquence d'expédition ne deviennent jamais des coefficients arbitraires de prix. Elles influencent le pricing uniquement si elles modifient explicitement un coût réel modélisé ; sinon elles restent des signaux de sourcing et d'opérations.

La densité conditionne d'abord le sourcing et la conception logistique. Elle ne masque jamais un plancher variable destructeur.

---

## 10. Gouvernance des hypothèses et des leviers

Toute modification susceptible d'améliorer artificiellement CDR, contribution, maturité ou couverture est versionnée avec auteur, date, motif, valeur avant/après et impact calculé.

Sont gouvernés au minimum : objectifs et moyennes d'allocation, fenêtre et tailles d'échantillon, seuils de maturité et couverture, charges de structure et leur classification, taux de provision risque, taux de change appliqués, marge cible, marge de sécurité, seuils de santé, cibles de densité, règles d'éligibilité des comparables et règles qui déterminent si une commande est réconciliée.

### Périmètre fermé des charges

Le périmètre des charges de structure est fermé. Désactiver, reclassifier en `exceptional`, déplacer ou exclure une charge susceptible de réduire le dénominateur est un acte gouverné, publié et auditable.

Aucun changement de classification ne peut améliorer silencieusement le ratio de couverture.

---

## 11. Réconciliation et maturité avant refonte du prix

```text
mesurer le réel
→ réconcilier estimé vs réel
→ établir la maturité
→ recalibrer les ratios
→ calculer la couverture de période
→ observer le marché
→ décider le prix
```

Deux pistes restent distinctes :

```text
Piste A : estimé N1 + N2 vs réel N1 + N2
Piste B : Σ contributions réconciliées vs charge économique de période
```

N3 n'est jamais réconcilié en fabriquant un « N3 réel par article ».

La contribution ne peut être calculée proprement depuis un snapshot si N2 et N3 sont fusionnés. Avant tout gate, le schéma doit distinguer :

```text
estimated_business_variable_cost_kmf
estimated_fixed_overhead_kmf
```

`estimated_business_complete_cost_kmf` peut être conservé pour compatibilité.

---

## 12. Provision risque : contribution provisoire et réconciliation de période

La provision risque appartient à N2 et agit donc sur la contribution. Elle doit être réconciliée en période : provisions passées versus sinistres, pertes et incidents réellement constatés.

Tant que cette réconciliation n'est pas suffisamment mature, contribution et couverture portent un indicateur de confiance explicite.

Modifier un taux de provision risque est un acte gouverné car il agit directement sur le numérateur du ratio de couverture.

---

## 13. Budget stratégique : produit d'appel, conquête et extinction

Une sous-couverture volontaire n'est jamais logée silencieusement dans une marge produit négative.

Toute stratégie `loss_leader`, `conquest` ou équivalent utilise un **budget stratégique explicite**, daté, borné, consommable et gouverné.

Le budget est affiché séparément des charges structurelles. Pour la viabilité globale, son montant consommé est un coût économique de période et réduit la capacité de couverture.

À l'épuisement du budget, à la date de fin ou au franchissement du seuil d'arrêt, l'exception se ferme pour toute nouvelle application du prix concerné et force une décision explicite : repricing, renouvellement gouverné ou sortie de la stratégie.

---

## 14. Saisonnalité

Une fenêtre mûre est nécessairement passée. Avant au moins un cycle annuel représentatif, la saisonnalité reste un contexte documenté, pas un multiplicateur improvisé du gate.

Après accumulation de données suffisantes, les ajustements saisonniers peuvent être calibrés et versionnés sur preuve historique.

---

## 15. Interdictions

- Interdit : `prix = coût × coefficient` comme règle unique.
- Interdit : utiliser le marché pour définir le plancher économique.
- Interdit : utiliser un objectif non réalisé comme dénominateur de référence N3.
- Interdit : transformer une absence de vérité en chiffre rassurant.
- Interdit : calculer un gate sur un numérateur sélectionnable manuellement.
- Interdit : masquer une confiance faible utilisée pour autoriser une stratégie agressive.
- Interdit : juger la viabilité uniquement par un panier moyen.
- Interdit : autoriser une sous-couverture sans gate de couverture.
- Interdit : modifier les ratios d'allocation sans historique et justification.
- Interdit : sortir ou reclassifier une charge du périmètre sans acte gouverné.
- Interdit : loger une subvention commerciale dans une marge produit invisible.
- Interdit : laisser une exception temporaire sans action par défaut définie.
- Interdit : utiliser un comparable approximatif comme ancrage marché canonique.
- Interdit : coder le ratio de couverture tant que N2 et N3 ne sont pas séparés dans les snapshots.

---

## 16. Ce qui ne doit pas être codé encore

Tant que les préconditions de vérité ne sont pas remplies :

- ne pas modifier `computePrices` pour remplacer aujourd'hui `CDR / (1 - marge)` par un prix marché ;
- ne pas retirer `recommended_price` de l'API ;
- ne pas coder le gate de couverture avant séparation N2 / N3 et watermark de maturité ;
- ne pas coder l'ancrage marché décisionnel avant échantillon de comparables stricts vérifié ;
- ne pas donner d'autorité commerciale à un ratio calculé sur charges configurées au lieu de charges économiques de période.

---

## 17. Phrase de contrôle

Avant de valider un prix ou une stratégie :

1. Quel est le plancher variable réel et avec quel niveau de confiance ?
2. Quelle contribution ce prix génère-t-il ?
3. Le gate de couverture de période est-il `COVERED` ?
4. La donnée de maturité est-elle suffisante et non sélectionnable ?
5. Le prix est-il crédible au regard d'un comparable strict réellement accessible au client ?
6. S'il s'agit d'une exception, quel budget la finance et quand expire-t-elle ?

Le shipment porte la vérité logistique de N1. La période porte la vérité de structure. Le marché borne la plausibilité. Aucun de ces niveaux ne remplace les autres.

Si une réponse critique est inconnue, Komerce dit `NOT_DECISIONAL` au lieu de fabriquer une fausse précision.

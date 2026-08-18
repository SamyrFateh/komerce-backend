# Doctrine moteur economique — allocation, unites et surcharge

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

> Le moteur calcule la verite economique. La strategie assume le prix. Le dashboard montre les consequences.

Ce document est la reference active pour le moteur economique Komerce quand une modification touche le pricing, le CDR, les allocations de couts ou les dashboards economiques.

Il complete les regles generales du projet : un ecran ou un service ne doit jamais recalculer sa propre verite si le moteur economique peut la fournir.

---

## 1. Principe directeur

Un cout ne vaut rien s'il n'a pas :

- une origine ;
- une unite ;
- une regle de repartition ;
- une proportion dans sa categorie ;
- un diagnostic de surcharge ou non.

La carte economique doit donc repondre a deux questions en meme temps :

```text
Combien ca coute ?
Pourquoi ca coute autant ?
```

---

## 2. Vocabulaire canonique

| Niveau | Nom doctrinal | Contenu | Nature |
|---|---|---|---|
| N1 | Cout rendu relais | achat, sourcing, hub, emballage, fret, douane, port/transitaire, distribution locale, relais | variable operationnel |
| N2 | Business variable | frais de paiement + provision risque | variable commercial / risque |
| N3 | Charges fixes imputees | quote-part des charges de structure | fixe impute |

Definitions intangibles :

```text
Cout variable complet = N1 + N2
Contribution = prix de vente - cout variable complet
CDR complet = N1 + N2 + N3
Marge complete = prix de vente - CDR complet
```

Important : contribution et marge complete ne sont pas la meme chose.

Une vente peut etre contributive tout en restant sous le CDR complet.

---

## 3. Regle d'or : toujours comparer la meme unite

Avant toute addition, le moteur doit connaitre l'unite d'analyse.

```text
Vue produit  -> cout par article
Vue commande -> cout par commande
Vue colis    -> cout par colis, puis repartition par article si necessaire
Vue mois     -> agregat mensuel
```

Regle doctrinale :

> Si l'ecran analyse un produit, N1, N2 et N3 doivent tous etre exprimes par article.

Il est interdit d'additionner :

```text
N1 par article + N2 par article + N3 par commande
```

Dans ce cas, le CDR est faux parce qu'il melange des unites differentes.

---

## 4. Decision N3 pour la carte produit

Pour une carte produit, N3 doit etre impute par article.

Formule obligatoire :

```text
N3 par article = charges fixes mensuelles / commandes prevues / articles moyens par commande
```

Exemple :

```text
Charges fixes mensuelles = 420 000 KMF
Commandes prevues = 80
Articles moyens par commande = 2,5

N3 par article = 420 000 / 80 / 2,5 = 2 100 KMF
```

Ce calcul est different du N3 par commande :

```text
N3 par commande = 420 000 / 80 = 5 250 KMF
```

Les deux calculs peuvent exister, mais pas dans la meme vue.

```text
Vue produit  -> N3 = 2 100 KMF par article
Vue commande -> N3 = 5 250 KMF par commande
```

---

## 5. Repartition par niveau d'origine

| Niveau ou le cout nait | Exemple | Regle de repartition | Ou ca finit |
|---|---|---|---|
| Article | achat fournisseur | direct sur l'article | N1 |
| Colis | emballage, fret colis, livraison colis | repartition entre articles du colis | N1 |
| Commande | paiement, preparation, support commande | repartition entre articles de la commande si vue produit | N2 |
| Mois / structure | loyer, salaires fixes, outils | commandes prevues x articles moyens par commande | N3 |

Regles de repartition possibles :

| Regle | Usage typique |
|---|---|
| Quantite | articles proches en taille/poids |
| Poids | fret, transport, colis lourd |
| Volume | colis encombrant |
| Valeur | assurance, risque, douane ad valorem |
| Manuel | arbitrage metier exceptionnel |

Format obligatoire d'affichage :

```text
cout engage / niveau / diviseur / cout impute
```

Exemples :

```text
Emballage : 1 200 KMF par colis / 4 articles = 300 KMF imputes
Paiement : 800 KMF par commande / 2,5 articles = 320 KMF imputes
Charges fixes : 420 000 KMF par mois / 80 commandes / 2,5 articles = 2 100 KMF imputes
```

---

## 6. Proportions : identifier la surcharge

Un montant isole ne suffit pas. Chaque cout important doit etre affiche avec sa proportion.

Format attendu :

```text
Montant -> categorie -> proportion -> diagnostic
```

Exemple :

```text
Fret = 743 KMF
= 9 % de N1
= 6 % du prix de vente
= 7 % du CDR complet
Diagnostic : normal / a surveiller / surcharge
```

Proportions minimales a exposer :

| Ligne | Proportions attendues |
|---|---|
| Ligne N1 | part dans N1 + part dans CDR |
| Ligne N2 | part dans N2 + part dans CDR |
| N3 | part dans CDR + part dans prix final |
| Contribution | part du prix final |
| Marge complete | part du prix final |

Le but du dashboard n'est pas seulement de calculer. Il doit montrer immediatement ce qui ecrase la marge.

---

## 7. Frontieres economiques

Le dashboard doit afficher deux frontieres.

```text
Frontiere rouge = cout variable complet = N1 + N2
Frontiere CDR   = cout complet = N1 + N2 + N3
```

Lecture :

```text
Prix < N1 + N2
= vente destructrice.

N1 + N2 <= prix < CDR
= vente contributive mais sous-couverte.

Prix >= CDR
= vente complete, structure incluse.
```

Le prix plancher ne doit pas etre egal au CDR.

```text
minimum_safe_price != cdr_complete
minimum_safe_price part du cout variable complet + marge de securite
recommended_price part du CDR complet + marge cible
```

---

## 8. Contrat API attendu

Le moteur doit exposer explicitement :

```text
n1_landed_relay_cost_kmf
n2_business_variable_cost_kmf
variable_cost_complete_kmf
contribution_kmf
n3_fixed_overhead_allocation_kmf
n3_allocation_unit
n3_formula
cdr_complete_kmf
minimum_safe_price_kmf
recommended_price_kmf
final_price_kmf
pricing_strategy
strategy_risk
allocations
allocation_averages
cost_breakdown
data_quality
warnings
```

Pour chaque allocation significative :

```text
allocation_level = article | parcel | order | month | shipment
allocation_basis = quantity | weight | volume | value | manual
engaged_cost_kmf
allocation_divisor
allocated_cost_kmf
confidence
```

---

## 9. Tests d'invariants obligatoires

Toute modification du moteur economique doit verifier :

```text
N1 est exprime dans l'unite de la vue.
N2 est exprime dans l'unite de la vue.
N3 est exprime dans l'unite de la vue.
Pour une vue produit : N3 = charges fixes / commandes prevues / articles moyens par commande.
CDR = N1 + N2 + N3.
Cout variable complet = N1 + N2.
Contribution = prix final - cout variable complet.
minimum_safe_price != CDR.
minimum_safe_price > cout variable complet.
minimum_safe_price < recommended_price quand la marge cible est positive.
```

Cas pedagogique de reference :

```text
Charges fixes = 420 000
Commandes = 80
Articles / commande = 2,5

N3 produit attendu = 2 100
N3 commande attendu = 5 250
```

---

## 10. Consigne pour Opus / agent dev

A faire en priorite :

1. Corriger `computeFixedCostAllocation` pour que la carte produit utilise N3 par article.
2. Exposer `n3_allocation_unit` et `n3_formula` dans le contrat moteur.
3. Ajouter les proportions par categorie dans la sortie ou dans le DTO dashboard.
4. Verrouiller les invariants par tests.
5. S'assurer que `pricing-dashboard` relaie le moteur et ne recalcule pas son propre CDR.

Phrase de controle :

```text
La carte produit calcule un CDR par article. N1, N2 et N3 doivent donc tous etre dans l'unite article.
```

# Doctrine économique Komerce

> **Version** : 2.0 — 2026-09-07  
> **Statut** : document fondamental canonique  
> **Classification des coûts** : `DOCTRINE_CLASSIFICATION_COUTS_N1_N2_N3.md`  
> **Flux / équilibre** : `DOCTRINE_FLUX_CONTRIBUTION_POINT_EQUILIBRE.md`

---

## 1. Phrase de vérité

Komerce ne cherche pas un coefficient magique qui ferait payer toute la structure à chaque produit.

> **Chaque vente doit d'abord couvrir ses coûts variables et contribuer positivement au flux. C'est le flux de la période qui absorbe la structure N3.**

Le prix final reste un arbitrage entre vérité économique, marché, stratégie et gouvernance humaine.

---

## 2. Les trois niveaux canoniques de coûts

La nomenclature métier est désormais intangible :

| Niveau | Nom canonique | Nature | Question de classification |
|---|---|---|---|
| **N1** | Variable opérationnel / logistique | Variable | Ce coût est-il causé par l'achat, l'acheminement ou l'exécution physique du flux ? |
| **N2** | Variable business / transactionnel | Variable | Ce coût est-il causé par la transaction, le paiement ou le risque de la vente ? |
| **N3** | Structure fixe / semi-fixe de période | Fixe / semi-fixe de période | Ce coût existe-t-il indépendamment d'une vente particulière ? |

La séparation principale est :

```text
COÛTS VARIABLES = N1 + N2
STRUCTURE DE PÉRIODE = N3
```

La fréquence de facturation ne détermine jamais seule la classification. La causalité économique tranche.

---

## 3. N1 — Variable opérationnel / logistique

N1 porte les coûts variables nécessaires pour acheter, acheminer, traiter et rendre le produit disponible au client ou au relais.

Exemples :

- achat fournisseur ;
- sourcing variable ;
- fret lié au poids / volume / shipment ;
- douane et taxes liées au flux ;
- port / transitaire variable ;
- emballage facturé par colis ;
- distribution locale par livraison ;
- commission relais par retrait.

N1 peut être engagé à l'article, à la commande, au colis ou au shipment sans perdre sa nature variable.

---

## 4. N2 — Variable business / transactionnel

N2 porte les coûts variables déclenchés par la transaction commerciale, le paiement et le risque économique de la vente.

Exemples :

- frais de paiement ;
- commission transactionnelle ;
- coût business facturé par commande ;
- provision de risque liée à la vente ;
- risque réel réconcilié selon la doctrine de période ;
- autres coûts business qui augmentent avec les transactions.

N2 n'est pas « tout ce qui varie ». **N1 est également variable.**

---

## 5. N3 — Structure fixe / semi-fixe de période

N3 porte l'ensemble des coûts fixes ou semi-fixes nécessaires à l'activité normale, indépendants d'une vente particulière et reconnus sur une période économique.

Exemples :

- salaires fixes et fonctions support ;
- loyer Hub / bureau ;
- Railway et plateforme à composante fixe ;
- SaaS et abonnements fixes ;
- comptabilité / administration ;
- assurances de structure ;
- forfait fixe d'un relais ;
- minimum garanti ;
- marketing structurel ;
- coûts fixes pays ;
- quote-part de structure groupe allouée selon une politique gouvernée.

N3 est lu sur une période économique : mois, trimestre, année ou autre fenêtre canonique.

Un coût de structure peut évoluer par palier de capacité sans devenir variable par transaction : embauche, nouvel espace Hub, véhicule, capacité réservée, etc.

---

## 6. Coûts mixtes

Une même facture peut contenir plusieurs natures et doit alors être décomposée.

```text
Relais :
  forfait mensuel fixe     → N3
  commission par retrait   → N1 ou N2 selon la fonction

Plateforme :
  abonnement fixe          → N3
  usage par transaction    → N1 ou N2 selon la fonction
```

Il est interdit de classer silencieusement toute une facture dans une seule famille si les composantes sont identifiables.

---

## 7. Formules économiques canoniques

### Coût variable complet

```text
Coût variable complet = N1 + N2
```

### Contribution

```text
Contribution = prix encaissé - (N1 + N2)
```

La contribution mesure ce que la vente ajoute au flux après couverture de ses coûts variables.

### CDR complet de référence

```text
CDR complet de référence = N1 + N2 + N3 imputé
```

Le CDR sert à lire une couverture complète théorique / imputée. Il ne transforme pas N3 en dette du produit.

### Couverture du flux

```text
Couverture = Σ contributions réconciliées / N3 réel de période
```

---

## 8. Les trois zones économiques d'un prix

```text
Prix < N1 + N2
→ vente destructrice

N1 + N2 <= Prix < CDR complet
→ vente contributive : elle couvre son variable et aide à absorber N3

Prix >= CDR complet
→ couverture complète de référence au niveau unitaire
```

La vérité globale de viabilité reste celle du flux de période, pas celle d'un SKU isolé.

---

## 9. N3 réel et N3 imputé ne doivent jamais être confondus

### N3 réel de période

C'est la vérité de structure reconnue sur la période. Elle sert au calcul de couverture et du point d'équilibre.

### N3 imputé

C'est une allocation de lecture / simulation vers un article ou un autre objet économique afin de construire un CDR complet de référence.

> **N3 réel est absorbé par le flux. N3 imputé éclaire le CDR.**

---

## 10. Les unités économiques du flux

| Unité | Rôle |
|---|---|
| **Article** | Porte une contribution marginale et certains coûts variables directs. |
| **Commande** | Porte l'acte commercial, le paiement et certains coûts variables business. |
| **Panier** | Décrit la composition commerciale d'une commande ; c'est un KPI commercial. |
| **Colis** | Porte les coûts et la densité logistique. |
| **Shipment** | Porte une cohorte logistique de fret / douane / transit. |
| **Période** | Porte N3, la couverture et la vérité de viabilité du marché. |

La rentabilité ne se résume donc jamais au seul panier moyen.

---

## 11. Point d'équilibre

La structure est couverte lorsque :

```text
Σ contributions réconciliées = N3 réel de période
```

Le moteur peut traduire la distance à l'équilibre en commandes, articles ou colis **équivalents à mix actuel**. Ces valeurs sont des traductions opérationnelles du même gap, pas trois vérités différentes.

---

## 12. Prix et marché

Le pricing ne doit jamais être un simple `cost × coefficient`.

Le moteur calcule les frontières économiques ; la stratégie choisit un prix dans un corridor de marché compatible avec :

- l'acceptabilité client ;
- la contribution recherchée ;
- le rôle du produit dans le mix ;
- le volume ;
- la densité logistique ;
- la politique de sécurité ;
- la validation humaine.

Le marché borne le possible. Le moteur mesure les conséquences. La stratégie décide.

---

## 13. Règles à ne pas casser

- N1 et N2 sont toujours variables dans la nomenclature métier canonique.
- N3 est toujours une structure fixe / semi-fixe rattachée à une période économique.
- La périodicité d'une facture ne suffit jamais à classifier un coût.
- Un coût mixte doit être séparé entre sa part fixe et sa part variable lorsque cela est possible.
- N3 ne devient jamais une dette du SKU.
- Le coût variable complet est toujours `N1 + N2`.
- La contribution est toujours `prix - (N1 + N2)`.
- Le point d'équilibre réel compare la contribution cumulée au N3 réel de période.
- Les nomenclatures historiques « niveau 2 = charges fixes » et « niveau 3 = provisions risques » sont supersédées et ne doivent plus alimenter UI, documentation métier ou nouvelles API.
- Ne jamais masquer les risques dans une marge globale opaque.
- Ne jamais présenter une hypothèse d'imputation comme un coût réel réconcilié.

---

## 14. Phrase de contrôle

Pour chaque coût :

> **Une vente supplémentaire fait-elle augmenter ce coût ?**

- oui → coût variable : N1 ou N2 ;
- non → N3 si le coût appartient à la structure normale de la période.

Puis :

> **Est-ce un coût d'exécution opérationnelle/logistique ou un coût business/transactionnel ?**

- opérationnel / logistique → N1 ;
- business / transactionnel → N2.

Cette double question est la règle canonique de classification Komerce.

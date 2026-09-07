# Doctrine canonique — Classification des coûts N1 / N2 / N3

> **Version** : 1.0 — 2026-09-07  
> **Statut** : canonique / intangible  
> **Objet** : fixer définitivement la frontière entre coûts variables et structure de période dans Komerce.  
> **Complète** : `DOCTRINE_ECONOMIQUE_KOMERCE.md`, `DOCTRINE_MOTEUR_ECONOMIQUE_STRATEGIE.md`, `DOCTRINE_FLUX_CONTRIBUTION_POINT_EQUILIBRE.md`, `PRICING_PERIOD_STRUCTURE_TRUTH.md`.

---

## 1. Phrase de vérité

> **Dans Komerce, N1 et N2 sont les coûts variables de l'activité. N3 est la structure fixe ou semi-fixe rattachée à une période économique.**

La séparation principale est donc :

```text
COÛTS VARIABLES = N1 + N2
STRUCTURE DE PÉRIODE = N3
```

N1 et N2 se distinguent par la **nature du coût variable** qu'ils portent. N3 se distingue d'eux par sa **causalité économique** : il n'est pas déclenché directement par une vente supplémentaire.

---

## 2. Test canonique de classification

Pour chaque ligne de coût, la première question est :

> **Si Komerce réalise une vente supplémentaire, ce coût augmente-t-il du fait de cette vente ?**

### Si oui

Le coût est **variable** et appartient à N1 ou N2.

### Si non

Le coût appartient à la **structure de période N3**, s'il est nécessaire à l'activité normale et économiquement rattachable à la période.

La fréquence de facturation ne décide jamais à elle seule de la classification.

```text
facturé chaque mois ≠ automatiquement N3
facturé ponctuellement ≠ automatiquement variable
```

C'est la causalité économique qui tranche.

---

## 3. N1 — Variable opérationnel / logistique

### Définition

**N1 regroupe les coûts variables directement nécessaires pour acheter, acheminer, traiter et rendre le produit disponible au client / relais.**

N1 appartient au flux physique et opérationnel.

Exemples typiques :

- achat fournisseur ;
- sourcing variable ;
- fret lié au poids / volume / shipment ;
- douane et taxes liées au flux importé ;
- port / transitaire variable ;
- emballage facturé par colis ;
- distribution locale facturée par livraison ;
- commission relais facturée par retrait ;
- tout autre coût opérationnel causé par l'article, la commande, le colis ou le shipment.

### Invariant

```text
N1 = variable opérationnel / logistique
```

N1 peut être engagé à plusieurs niveaux : article, commande, colis ou shipment. Le niveau d'engagement ne change pas sa nature variable.

---

## 4. N2 — Variable business / transactionnel

### Définition

**N2 regroupe les coûts variables déclenchés par la transaction commerciale, le paiement et le risque économique de la vente.**

N2 appartient au flux business et financier.

Exemples typiques :

- frais de paiement proportionnels ou par transaction ;
- commission transactionnelle ;
- coût business facturé par commande ;
- provision de risque liée à la vente ;
- risque réel de période réconcilié selon la doctrine dédiée ;
- autres coûts business dont le montant croît avec les transactions.

### Invariant

```text
N2 = variable business / transactionnel
```

N2 n'est pas « tout le variable ». N1 est également variable.

---

## 5. N3 — Structure fixe / semi-fixe de période

### Définition

**N3 regroupe l'ensemble des coûts fixes ou semi-fixes nécessaires à l'activité normale, qui existent indépendamment d'une vente particulière et qui sont reconnus sur une période économique.**

N3 est la structure que le flux doit absorber.

Exemples typiques :

- salaires fixes et fonctions support ;
- loyer du Hub ou des bureaux ;
- Railway / hébergement / plateforme à composante fixe ;
- abonnements SaaS fixes ;
- comptabilité et administration ;
- assurances de structure ;
- forfait fixe mensuel d'un relais ;
- minimum garanti fixe ;
- marketing structurel non lié à une transaction précise ;
- coûts fixes pays ;
- quote-part de structure groupe allouée au marché selon une politique gouvernée.

### Période économique

N3 est toujours lu sur une période économique : mois, trimestre, année ou autre fenêtre canonique.

```text
N3_période = somme des coûts de structure reconnus sur cette période
```

Une charge annuelle peut donc être reconnue au prorata de la période économique qu'elle couvre. La date de paiement n'est pas la seule vérité temporelle.

### Semi-fixe / palier de capacité

Un coût peut rester fixe dans une plage de volume puis augmenter par palier :

```text
0–500 commandes      → structure actuelle
501–1 000 commandes  → + salarié / capacité / espace
1 001+               → nouveau palier
```

Cela reste du N3 : le coût n'est pas causé par **chaque** vente marginale, mais par un changement de capacité de structure.

### Invariant

```text
N3 = structure fixe / semi-fixe de période
```

---

## 6. Coûts mixtes : séparation obligatoire

Une même facture ou un même fournisseur peut porter plusieurs natures économiques.

Exemple relais :

```text
forfait mensuel de présence      → N3
commission par retrait           → N1 ou N2 selon la fonction économique
```

Exemple plateforme :

```text
abonnement mensuel fixe          → N3
coût par transaction / usage     → N1 ou N2 selon la fonction économique
```

Il est interdit de classer toute la facture dans une seule famille lorsque les deux composantes sont identifiables.

---

## 7. Conséquences sur les formules

### Coût variable complet

```text
Coût variable complet = N1 + N2
```

C'est la frontière économique marginale de la vente.

### Contribution

```text
Contribution = Prix encaissé - (N1 + N2)
```

La contribution mesure ce que la vente ajoute au flux après couverture de ses coûts variables.

### N3 et point d'équilibre

```text
Σ contributions du flux < N3 période
→ structure non encore couverte

Σ contributions du flux = N3 période
→ point d'équilibre

Σ contributions du flux > N3 période
→ résultat positif de période
```

---

## 8. N3 réel vs N3 imputé dans le CDR

Deux lectures doivent rester distinctes.

### N3 réel de période

C'est la vérité économique de structure :

```text
N3 réel de période
= coûts de structure reconnus sur la période
```

Il sert à calculer la couverture du marché et le point d'équilibre.

### N3 imputé au produit

C'est une allocation de lecture / simulation utilisée pour construire un CDR complet de référence :

```text
CDR complet de référence = N1 + N2 + N3 imputé
```

Cette imputation ne transforme jamais N3 en coût variable et ne crée jamais une dette du SKU.

> **N3 réel est absorbé par le flux. N3 imputé sert à éclairer le CDR.**

---

## 9. Hors N3 standard : exceptionnel

Un incident, une campagne exceptionnelle, une correction ponctuelle ou une dépense non représentative de la structure normale ne doit pas être silencieusement transformé en N3 récurrent.

Le caractère exceptionnel doit rester explicite et gouverné.

---

## 10. Vocabulaire canonique obligatoire

| Niveau | Nom canonique | Nature |
|---|---|---|
| **N1** | Variable opérationnel / logistique | Variable |
| **N2** | Variable business / transactionnel | Variable |
| **N3** | Structure fixe / semi-fixe de période | Fixe / semi-fixe de période |

Formules canoniques :

```text
Variables = N1 + N2
Coût variable complet = N1 + N2
Contribution = Prix - (N1 + N2)
N3 = structure de période
CDR complet de référence = N1 + N2 + N3 imputé
Couverture = Σ contributions réconciliées / N3 réel de période
```

---

## 11. Nomenclatures historiques

Des fichiers legacy peuvent encore employer des expressions historiques telles que « niveau 2 = charges fixes » ou « niveau 3 = provisions risques ».

Ces libellés sont **supersédés** par la présente doctrine et ne doivent plus être utilisés comme vocabulaire métier, UI ou nouvelle API.

Ils peuvent être conservés temporairement comme aliases techniques de compatibilité tant qu'une migration contrôlée est nécessaire.

---

## 12. Phrase de contrôle

Avant de classer une ligne :

> **Est-elle causée par une vente supplémentaire ? Si oui : N1 ou N2. Sinon : structure de période N3, sous réserve qu'elle appartienne à l'activité normale.**

Puis, pour distinguer N1 de N2 :

> **Le coût appartient-il à l'exécution opérationnelle/logistique du flux, ou à la transaction business/financière ?**

Cette double question constitue le test canonique de classification Komerce.

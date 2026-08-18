# Doctrine du moteur économique, de la stratégie prix et des dashboards

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

> Le moteur calcule. La stratégie assume. Le dashboard rend les conséquences visibles.

Ce document complète la doctrine du moteur économique Komerce. Il fixe le contrat entre trois couches qui ne doivent plus être mélangées :

- **Doctrine économique** : produire la vérité du coût.
- **Stratégie prix** : choisir un prix final assumé.
- **Dashboard** : montrer comment chaque décision se propage.

Un écran, une route ou un service qui affiche un prix doit pouvoir être relu à travers cette chaîne. Si un dashboard affiche un chiffre sans montrer d'où il vient, il n'est pas encore au niveau de la doctrine.

---

## 1. Principe directeur

Un prix final n'est pas seulement un calcul. C'est un arbitrage.

Le moteur économique ne décide pas à la place de l'humain. Il calcule les coûts, les frontières, les contributions, les scénarios et les alertes. L'humain choisit ensuite une stratégie commerciale en voyant clairement ce qu'elle consomme ou protège.

La règle d'or reste :

> Dire la vérité économique, même quand la stratégie choisit de ne pas couvrir toute cette vérité immédiatement.

---

## 2. Les trois couches

| Couche | Rôle | Ne doit pas faire |
|--------|------|-------------------|
| Doctrine économique | Calculer N1, N2, N3, coût variable, contribution, CDR, plancher, conseillé | Décider le prix final |
| Stratégie prix | Choisir une posture commerciale et un prix final | Cacher le coût réel |
| Dashboard | Rendre la chaîne lisible et interactive | Recalculer avec une autre vérité |

Formule canonique :

```text
Objet
  -> N1 coût rendu relais
  -> N2 business variable
  -> coût variable complet
  -> contribution
  -> N3 charges fixes imputées
  -> CDR complet
  -> stratégie prix
  -> prix final assumé
```

---

## 3. Vocabulaire canonique

| Niveau | Nom doctrinal | Contenu | Nature | Famille technique |
|--------|---------------|---------|--------|-------------------|
| N1 | Coût rendu relais | Achat, sourcing, hub, emballage, fret, douane, port/transitaire, distribution locale, relais | Variable | `landed_relay` |
| N2 | Business variable | Frais de paiement + provision risque | Variable | `business.variable` |
| N3 | Charges fixes imputées | Quote-part des charges de structure | Fixe imputé | `business.fixed_overhead` |
| Hors chaîne | Exceptionnel | Incident, campagne, correction ponctuelle | Hors prix standard | `exceptional` |

Définitions intangibles :

```text
Coût variable complet = N1 + N2
CDR complet = N1 + N2 + N3
Contribution = prix de vente - coût variable complet
Marge complète = prix de vente - CDR complet
```

Il faut distinguer contribution et marge complète. Une vente peut contribuer positivement tout en restant sous le CDR complet.

---

## 4. Les deux frontières économiques

Le dashboard doit afficher deux frontières, pas une seule.

### Frontière 1 : coût variable complet

```text
Coût variable complet = N1 + N2
```

Sous cette ligne, chaque vente détruit de l'argent. C'est la frontière rouge.

Une stratégie peut exceptionnellement passer sous cette ligne uniquement avec une alerte explicite, un motif, une durée et une validation humaine.

### Frontière 2 : CDR complet

```text
CDR complet = N1 + N2 + N3
```

Sous cette ligne, la vente couvre ses coûts variables mais ne couvre pas toute sa part de structure. C'est possible dans une stratégie de conquête, de volume ou de produit d'appel, mais cela doit être assumé.

Le dashboard doit donc distinguer :

```text
Prix < coût variable complet
= vente destructrice.

Coût variable complet <= prix < CDR complet
= vente contributive mais sous-couverte.

Prix >= CDR complet
= vente complète, structure incluse.
```

---

## 5. Du coût au prix

Le moteur doit produire trois repères, jamais un seul :

1. **Prix plancher** (`minimum_safe_price`)  
   Dérivé du coût variable complet augmenté d'une marge minimale de sécurité.

2. **Prix conseillé** (`recommended_price`)  
   Dérivé du CDR complet avec la marge cible.

3. **Scénarios**  
   Variantes commerciales qui montrent le prix, la contribution, la couverture du CDR et le risque.

Règle importante :

```text
minimum_safe_price != CDR complet
```

Le CDR complet est une frontière de couverture totale. Le plancher est une barrière de sécurité contre la vente destructrice.

---

## 6. Stratégies prix canoniques

La stratégie est le choix humain appliqué après le calcul.

| Stratégie | Sens | Prix possible | Condition |
|----------|------|---------------|-----------|
| `mechanical` | Suivre le moteur | Prix conseillé | Par défaut |
| `competition_aligned` | S'aligner sur le marché | Autour prix concurrent | Ne pas masquer l'écart au CDR |
| `premium` | Vendre au-dessus du conseillé | Conseillé + majoration | Justifié par service, rareté, confiance |
| `loss_leader` | Produit d'appel | Sous CDR possible | Contribution et compensation visibles |
| `conquest` | Sous-couverture temporaire | Sous CDR possible | Durée, volume cible, seuil affichés |
| `manual` | Prix fixé manuellement | Libre avec alertes | Écart et risque explicités |

Une stratégie peut accepter une sous-couverture du CDR. Elle ne doit jamais la faire disparaître.

---

## 7. Ce qu'une stratégie doit afficher

Chaque stratégie doit afficher :

- prix final choisi ;
- prix plancher ;
- prix conseillé ;
- écart au coût variable ;
- contribution ;
- écart au CDR ;
- charges fixes non couvertes si prix sous CDR ;
- volume nécessaire pour compenser ;
- durée d'acceptation si stratégie temporaire ;
- verdict : `PRIORITY`, `TEST`, `WATCH`, `AVOID`, `LOSS`.

Exemple :

```text
Prix final : 12 990 KMF
Coût variable complet : 9 060 KMF
Contribution : 3 930 KMF
CDR complet : 11 160 KMF
Écart au CDR : +1 830 KMF
Verdict : TEST
```

Exemple sous-couverture :

```text
Prix final : 10 490 KMF
Coût variable complet : 9 060 KMF
Contribution : 1 430 KMF
CDR complet : 11 160 KMF
Sous-couverture : 670 KMF par article
Condition : acceptable uniquement si volume cible atteint ou compensation par d'autres produits.
```

---

## 8. Dashboard : boîtes et flèches

La vue principale doit être une carte de flux, pas un tableau plat.

```text
[Objet]
  -> [N1 coût rendu relais]
  -> [N2 business variable]
  -> [Coût variable complet]
  -> [Contribution]
  -> [N3 charges fixes imputées]
  -> [CDR complet]
  -> [Décision prix]
```

Chaque boîte doit répondre à quatre questions :

```text
Je reçois quoi ?
Je calcule quoi ?
Je transmets quoi ?
Quel impact si on me modifie ?
```

Une boîte doit afficher :

- nom doctrinal ;
- montant principal ;
- formule courte ;
- confiance ;
- statut d'alerte ;
- variation récente si une valeur a été modifiée.

---

## 9. Détail attendu par boîte

### Objet

- achat fournisseur ;
- devise et taux ;
- catégorie ;
- poids ;
- volume ;
- prix actuel.

### N1 - Coût rendu relais

Les 9 lignes : achat fournisseur, sourcing, hub Dubai, emballage, fret, douane, port / transitaire, distribution locale, relais.

### N2 - Business variable

- frais de paiement ;
- provision risque.

### Coût variable complet

```text
N1 + N2
```

Phrase obligatoire :

> Sous cette ligne, chaque vente détruit de l'argent.

### Contribution

```text
prix de vente - coût variable complet
```

Phrase obligatoire :

> La contribution sert à couvrir les charges fixes.

### N3 - Charges fixes imputées

- charges fixes mensuelles ;
- volume cible ;
- articles moyens par commande ;
- quote-part imputée par article.

### CDR complet

```text
N1 + N2 + N3
```

Phrase obligatoire :

> Le CDR est le coût complet imputé, structure comprise.

### Décision prix

- prix plancher ;
- prix conseillé ;
- prix final choisi ;
- stratégie choisie ;
- scénarios ;
- verdict.

---

## 10. Imputation : règle pédagogique obligatoire

Un coût agrégé ne doit jamais être affiché sans sa mécanique.

Format obligatoire :

```text
coût engagé / niveau / diviseur / coût imputé
```

Exemples :

```text
Emballage : 1 200 KMF par colis / 4 articles = 300 KMF imputés
Paiement : 800 KMF par commande / 2,5 articles = 320 KMF imputés
Fret : 60 000 KMF par shipment / 200 articles = 300 KMF imputés
Charges fixes : 420 000 KMF par mois / 80 commandes / 2,5 articles = 2 100 KMF imputés
```

Les ratios sont des hypothèses tant qu'ils ne sont pas calibrés. Leur confiance doit être visible.

---

## 11. Impact live

Quand une valeur est modifiée, le dashboard doit afficher la propagation.

Exemple :

```text
Tu as modifié : emballage par colis

Impact :
N1 : +300 KMF
N2 : +0 KMF
Coût variable complet : +300 KMF
Contribution : -300 KMF
N3 : +0 KMF
CDR complet : +300 KMF
Prix conseillé : +462 KMF
```

La propagation doit suivre la chaîne réelle. On ne doit pas afficher un impact isolé qui ne montre pas les boîtes aval.

---

## 12. Contrat backend attendu

La sortie du moteur moderne doit exposer explicitement :

```text
n1_landed_relay_cost_kmf
n2_business_variable_cost_kmf
variable_cost_complete_kmf
contribution_kmf
n3_fixed_overhead_allocation_kmf
cdr_complete_kmf
minimum_safe_price_kmf
recommended_price_kmf
final_price_kmf
pricing_strategy
strategy_risk
cost_breakdown
allocations
allocation_averages
data_quality
warnings
```

Les noms existants peuvent être conservés pour compatibilité, mais les noms doctrinaux doivent exister dans la réponse afin que les dashboards ne réinterprètent pas les chiffres.

---

## 13. Gouvernance technique

- `pricing-engine`, `pricing-cdr` et `pricing-output` sont la source de vérité du calcul.
- Les dashboards ne doivent pas maintenir un calcul parallèle.
- Les anciens calculs basés uniquement sur `pricing_components` doivent être supprimés ou transformés en compatibilité legacy.
- `cost_components` est la source canonique des familles, catégories, unités, scopes, sources et confiances.
- `exceptional` reste hors prix standard, sauf scénario explicitement assumé.
- Les snapshots de coûts de commande doivent figer la vérité estimée au moment de la vente.

Règle de cohérence :

```text
Un même produit ne doit pas avoir deux CDR différents selon l'écran.
```

---

## 14. Cible d'implémentation

À court terme :

1. séparer explicitement N2 et N3 dans la sortie API ;
2. corriger `minimum_safe_price` pour qu'il parte du coût variable complet ;
3. afficher les deux frontières : coût variable et CDR ;
4. brancher les dashboards sur `pricing-engine` ;
5. matérialiser la carte économique en boîtes et flèches ;
6. ajouter le panneau d'impact live ;
7. rendre l'imputation visible partout.

À moyen terme :

1. calibrer les ratios d'imputation sur volume réel ;
2. versionner les taux de change appliqués ;
3. associer chaque stratégie à une durée, un motif et une mesure de compensation ;
4. relier contribution moyenne et seuil de rentabilité dans le dashboard économique.

---

## 15. Phrase de contrôle

Avant de valider un écran, poser cette question :

> Est-ce que l'utilisateur comprend en 30 secondes d'où vient le coût, ce qui est variable, ce qui est fixe, ce que la vente contribue et pourquoi le prix final est assumé ?

Si la réponse est non, l'écran n'est pas encore aligné avec la doctrine.

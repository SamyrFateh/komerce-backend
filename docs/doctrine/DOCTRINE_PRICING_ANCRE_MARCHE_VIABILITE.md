# Doctrine Pricing ancré marché & viabilité Komerce

> **Version** : 1.2 — 2026-09-06
> **Statut** : document fondamental du moteur économique — draft avant merge
> **Complète** : `DOCTRINE_ECONOMIQUE_KOMERCE.md`, `DOCTRINE_ALLOCATION_COUTS.md`, `DOCTRINE_DENSITE_VALEUR.md`, `DOCTRINE_MOTEUR_ECONOMIQUE_STRATEGIE.md`, `DOCTRINE_REFACTURATION_RAILWAY.md`, `DOCTRINE_MUTUALISATION_HUB.md`

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

## 6. Couverture par marché, vérité globale

Le **gate d'autorisation est évalué par marché** (`market_id`). Un marché déficitaire ne peut pas devenir artificiellement `COVERED` parce qu'un autre marché est rentable.

```text
market_coverage_ratio = contributions réconciliées du marché
                        / charge économique de structure attribuée au marché
```

La couverture globale groupe reste publiée comme vérité du modèle :

```text
group_coverage_ratio = Σ contributions réconciliées groupe
                       / charge économique groupe
```

Le ratio global ne pilote aucune autorisation locale. Il sert au pilotage du groupe.

Un marché en ouverture peut être sous couverture sans être abandonné : il devient une **position de conquête groupe explicite**, financée par un budget d'expansion daté, borné, consommable et visible séparément.

---

## 7. Mesurer au niveau où le coût devient vrai

- **Article** : achat produit et coûts propres à l'article.
- **Commande** : frais de paiement, commission relais et autres coûts de commande réellement constatés.
- **Colis** : emballage, transport local, poids et volume constatés.
- **Shipment** : fret, douane, port, transitaire, densité et allocation réelle ; le shipment est la cohorte de vérité de N1 logistique.
- **Période** : provision risque réconciliée, charge économique de structure, budgets stratégiques consommés et viabilité globale.

Le panier moyen reste un indicateur utile mais ne constitue jamais, seul, une preuve de viabilité.

La distribution doit être visible : part de commandes mono-article, part de commandes sous coût variable de commande, distribution de contribution par commande, concentration de contribution par produit / catégorie / marché.

Par défaut, une commande mono-article couvre son coût variable de commande. Une exception n'est autorisée que si elle est financée par un budget stratégique gouverné.

---

## 8. Charges de structure mutualisées : plateforme et Hub physique

Railway, Cloudinary, la part fixe de Twilio, le loyer du Hub, le personnel fixe Hub et les coûts structurels équivalents sont **du N3**.

Ils ne deviennent jamais des coûts variables d'article du seul fait qu'ils sont ventilés par marché.

Les coûts Hub réellement variables déjà portés dans N1 — contrôle qualité unitaire, étiquetage, packaging ou opération unitaire — restent hors du pool fixe mutualisé.

### Imputation vs refacturation

- **imputation** : convention interne de lecture d'une charge de période ;
- **refacturation** : mouvement d'argent réel vers une entité/partenaire contractuellement facturable.

Les deux portent sur une seule vérité économique. Invariant de conservation :

```text
Σ quotes-parts attribuées / refacturables aux marchés
= charge économique du pool de structure sur la fenêtre canonique
```

Il est interdit de refacturer une charge de structure aux marchés et de la compter une seconde fois comme nouveau coût article.

### Fenêtre unique

La mutualisation et, le cas échéant, la refacturation utilisent la **même fenêtre canonique** que la couverture. Un mois calendaire ne devient pas une seconde base économique indépendante.

---

## 9. Rôle pays et statut de facturation

Le rôle RBAC `market_operator` exprime une autorité opérationnelle sur un marché. Il ne signifie pas qu'un opérateur est un partenaire facturable.

Deux modes sont distincts :

```text
internal_allocation
partner_reinvoice
```

- `internal_allocation` : responsable pays interne ; on calcule sa performance et sa quote-part, sans facture partenaire ;
- `partner_reinvoice` : partenaire/entité sous contrat ; la quote-part peut devenir une refacturation défendable ligne à ligne.

Par défaut, tant qu'aucun contrat de facturation n'existe, le marché reste en `internal_allocation`.

Le passage à `partner_reinvoice` est une décision de gouvernance/contrat indépendante du rôle `market_operator`.

---

## 10. Clés de mutualisation et intégrité des assiettes

Une clé de prorata n'est jamais neutre. Elle doit être gouvernée et versionnée.

Deux politiques sont admissibles :

1. **mutualisation pure** selon une assiette d'activité/usage réellement constatée ;
2. **socle par marché + marginal** : coût minimal de présence par marché, puis variable selon consommation réelle.

Le choix est un arbitrage de groupe/actionnaire, pas une décision silencieuse du moteur.

### Règles spécifiques

- Cloudinary ne se divise jamais par `markets.is_active` ; seuls les marchés avec activité constatée sur la fenêtre canonique peuvent entrer dans une assiette d'activité.
- La structure Hub ne se pondère pas arbitrairement au poids : manutention par colis/opération réellement traités ; stockage par volume occupé, idéalement `m3_jours` ; fallback égalitaire `confidence: low` si la mesure manque.
- Pour le maritime, le poids n'est jamais utilisé comme proxy d'un volume absent.

Les données d'assiette doivent provenir de sources opérationnelles indépendantes quand elles existent. Les commandes viennent du système de paiement ; les colis et scans du Hub viennent des flux opérationnels. Le `market_operator` ne peut pas produire librement la mesure qui réduit sa propre quote-part.

---

## 11. Les quatre repères prix canoniques

| Repère | Nature | Autorité |
|---|---|---|
| **Prix plancher** | mécanique, dur | moteur économique |
| **Prix de couverture complète** | référence économique / comptable | moteur économique |
| **Prix marché observé** | réalité externe / terrain | données comparables vérifiées |
| **Prix décidé** | arbitrage commercial assumé | humain autorisé, sous gates |

`recommended_price` reste transitoirement une référence mécanique de couverture complète pour compatibilité.

Un vrai prix de test marché peut se situer entre le plancher variable et le CDR complet **uniquement si le gate de couverture du marché l'autorise** et si contribution, écart au CDR, motif, durée et budget éventuel sont tracés.

---

## 12. Ancrage marché

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

## 13. Densité, rotation et fréquence

La densité logistique est un déterminant économique lorsqu'elle modifie les coûts réellement engagés.

La rotation et la fréquence d'expédition ne deviennent jamais des coefficients arbitraires de prix. Elles influencent le pricing uniquement si elles modifient explicitement un coût réel modélisé ; sinon elles restent des signaux de sourcing et d'opérations.

La densité conditionne d'abord le sourcing et la conception logistique. Elle ne masque jamais un plancher variable destructeur.

---

## 14. Gouvernance des hypothèses et des leviers

Toute modification susceptible d'améliorer artificiellement CDR, contribution, maturité, quote-part de structure ou couverture est versionnée avec auteur, date, motif, valeur avant/après et impact calculé.

Sont gouvernés au minimum :

- objectifs et moyennes d'allocation ;
- fenêtre et tailles d'échantillon ;
- seuils de maturité et couverture ;
- charges de structure et leur classification ;
- périmètre **groupe / marché** de chaque charge ;
- clés de prorata et politique de mutualisation ;
- règle d'activité constatée d'un marché ;
- mode `internal_allocation` / `partner_reinvoice` ;
- taux de provision risque ;
- taux de change appliqués ;
- marge cible, marge de sécurité et seuils de santé ;
- cibles de densité ;
- règles d'éligibilité des comparables ;
- règles qui déterminent si une commande est réconciliée.

### Périmètre fermé des charges

Le périmètre des charges de structure est fermé dans deux dimensions :

```text
fixe / variable
groupe / marché
```

Désactiver, reclassifier, déplacer groupe→marché ou marché→groupe, ou exclure une charge est un acte gouverné, publié et auditable.

Aucun changement de classification ne peut améliorer silencieusement un ratio de couverture ou une quote-part facturable.

---

## 15. Réconciliation et maturité avant refonte du prix

```text
mesurer le réel
→ réconcilier estimé vs réel
→ établir la maturité
→ recalibrer les ratios
→ attribuer la charge économique de structure
→ calculer la couverture par marché et groupe
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

## 16. Provision risque : contribution provisoire et réconciliation de période

La provision risque appartient à N2 et agit donc sur la contribution. Elle doit être réconciliée en période : provisions passées versus sinistres, pertes et incidents réellement constatés.

Tant que cette réconciliation n'est pas suffisamment mature, contribution et couverture portent un indicateur de confiance explicite.

Modifier un taux de provision risque est un acte gouverné car il agit directement sur le numérateur du ratio de couverture.

---

## 17. Budgets stratégiques : produit d'appel et conquête marché

Une sous-couverture volontaire n'est jamais logée silencieusement dans une marge produit négative ou dans la marge d'un autre marché.

Toute stratégie `loss_leader`, `conquest` produit ou **conquête de marché** utilise un budget stratégique explicite, daté, borné, consommable et gouverné.

Le budget est affiché séparément des charges structurelles. Son montant consommé est un coût économique de période et réduit la capacité de couverture.

À l'épuisement du budget, à la date de fin ou au franchissement du seuil d'arrêt, l'exception se ferme pour toute nouvelle application et force une décision explicite : repricing, renouvellement gouverné, réduction de périmètre ou arrêt de la stratégie.

---

## 18. Saisonnalité

Une fenêtre mûre est nécessairement passée. Avant au moins un cycle annuel représentatif, la saisonnalité reste un contexte documenté, pas un multiplicateur improvisé du gate.

Après accumulation de données suffisantes, les ajustements saisonniers peuvent être calibrés et versionnés sur preuve historique.

---

## 19. Gaps structurels connus

La doctrine cible dépasse encore le modèle de données actuel sur plusieurs points :

- `finance_config` est global/singleton et ne porte pas une vérité N3 par marché ;
- `charges` ne matérialise pas encore la frontière groupe / marché ;
- il n'existe pas encore de vérité canonique de charge économique de période par marché ;
- N2 et N3 sont encore fusionnés dans certains snapshots ;
- le watermark de maturité n'existe pas encore comme concept de données ;
- le budget stratégique de conquête n'est pas encore matérialisé ;
- les clés de mutualisation Hub/plateforme ne sont pas encore implémentées de façon décisionnelle.

Ces gaps sont des préconditions de chantier, pas une invitation à les combler par des fallbacks silencieux.

---

## 20. Interdictions

- Interdit : `prix = coût × coefficient` comme règle unique.
- Interdit : utiliser le marché pour définir le plancher économique.
- Interdit : utiliser un objectif non réalisé comme dénominateur de référence N3.
- Interdit : transformer une absence de vérité en chiffre rassurant.
- Interdit : calculer un gate sur un numérateur sélectionnable manuellement.
- Interdit : masquer une confiance faible utilisée pour autoriser une stratégie agressive.
- Interdit : juger la viabilité uniquement par un panier moyen.
- Interdit : autoriser une sous-couverture sans gate de couverture du marché.
- Interdit : modifier les ratios d'allocation sans historique et justification.
- Interdit : sortir ou reclassifier une charge du périmètre sans acte gouverné.
- Interdit : déplacer une charge groupe / marché sans acte gouverné.
- Interdit : loger une subvention commerciale dans une marge produit invisible.
- Interdit : laisser une exception temporaire sans action par défaut définie.
- Interdit : utiliser un comparable approximatif comme ancrage marché canonique.
- Interdit : coder le ratio de couverture tant que N2 et N3 ne sont pas séparés dans les snapshots.
- Interdit : réinjecter une quote-part Railway / Cloudinary / Hub fixe comme coût variable article.
- Interdit : refacturer et imputer deux fois la même charge économique.
- Interdit : utiliser `markets.is_active` comme diviseur économique d'un pool partagé.
- Interdit : utiliser le poids comme proxy de stockage Hub ou de volume maritime absent.
- Interdit : déduire la facturabilité d'un marché du rôle `market_operator`.

---

## 21. Ce qui ne doit pas être codé encore

Tant que les préconditions de vérité ne sont pas remplies :

- ne pas modifier `computePrices` pour remplacer aujourd'hui `CDR / (1 - marge)` par un prix marché ;
- ne pas retirer `recommended_price` de l'API ;
- ne pas coder le gate de couverture avant séparation N2 / N3 et watermark de maturité ;
- ne pas coder l'ancrage marché décisionnel avant échantillon de comparables stricts vérifié ;
- ne pas donner d'autorité commerciale à un ratio calculé sur charges configurées au lieu de charges économiques de période ;
- ne pas coder la refacturation partenaire avant ratio de couverture réconcilié et contrat explicite ;
- ne pas ajouter `market_id` à `charges` avant arbitrage de la frontière groupe / marché ;
- ne pas dupliquer `finance_config` par marché avant séparation N2 / N3 et modèle de structure validé.

---

## 22. Phrase de contrôle

Avant de valider un prix, une stratégie ou une quote-part marché :

1. Quel est le plancher variable réel et avec quel niveau de confiance ?
2. Quelle contribution ce prix génère-t-il ?
3. Ce marché est-il `COVERED`, ou consomme-t-il un budget de conquête groupe explicite ?
4. La donnée de maturité est-elle suffisante et non sélectionnable ?
5. La charge de structure attribuée au marché provient-elle d'un pool gouverné sans double comptage ?
6. Le prix est-il crédible au regard d'un comparable strict réellement accessible au client ?
7. S'il s'agit d'une exception, quel budget la finance et quand expire-t-elle ?
8. S'il s'agit d'une refacturation, existe-t-il un contrat et l'invariant de conservation est-il vérifié ?

Le shipment porte la vérité logistique de N1. La période porte la vérité de structure. Le `market_id` porte la responsabilité économique locale. Le groupe porte la vérité consolidée. Le marché borne la plausibilité. Aucun de ces niveaux ne remplace les autres.

Si une réponse critique est inconnue, Komerce dit `NOT_DECISIONAL` au lieu de fabriquer une fausse précision.

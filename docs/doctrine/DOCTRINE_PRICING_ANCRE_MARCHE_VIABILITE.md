# Doctrine Pricing ancré marché & viabilité Komerce

> **Version** : 1.3 — 2026-09-06
> **Statut** : doctrine fondamentale canonique du moteur économique à l'adoption de cette PR
> **Complète** : `DOCTRINE_ECONOMIQUE_KOMERCE.md`, `DOCTRINE_ALLOCATION_COUTS.md`, `DOCTRINE_DENSITE_VALEUR.md`, `DOCTRINE_MOTEUR_ECONOMIQUE_STRATEGIE.md`, `DOCTRINE_REFACTURATION_RAILWAY.md`, `DOCTRINE_MUTUALISATION_HUB.md`

---

## 1. Phrase de vérité

> **Komerce cherche le prix le plus juste, soutenable pour le client et pour le modèle.**

Le moteur calcule la vérité des coûts. Le marché borne la plausibilité commerciale. La contribution mesure ce que chaque vente apporte. La couverture de période dit si le modèle est viable. L'humain autorisé décide le prix dans les limites des gates et avec traçabilité.

> **Le moteur calcule la vérité économique. Le marché borne le possible. La stratégie décide. Le système rend la compensation visible.**

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

## 5. Maturité, watermark et dispositions gouvernées

La couverture n'est décisionnelle que sur une base de vérité économique suffisante.

### 5.1 Fenêtre canonique

Le futur gate de couverture utilise une **fenêtre glissante de largeur fixe**, définie par une politique versionnée, et terminée au **watermark de maturité**. Aucun rôle ne choisit manuellement les dates du verrou.

Le dashboard peut afficher d'autres périodes d'analyse, mais elles ne pilotent jamais le gate canonique.

### 5.2 Maturité d'une commande

Une commande est `MATURE` uniquement lorsque les coûts variables qui la concernent ont atteint l'état de preuve requis : achat réellement réconcilié, shipment clos quand applicable, douane liquidée quand applicable, frais de fret réellement connus et alloués, commission relais réellement constatée, frais de paiement réellement constatés, et autres coûts variables requis réconciliés selon leur niveau d'engagement.

Une configuration, une estimation ou une absence de donnée ne devient jamais une preuve réelle.

### 5.3 Watermark anti cherry-picking

Le watermark avance uniquement sur un préfixe temporel franchissable. Une commande immature bloque sa cohorte temporelle et interdit de sélectionner les commandes plus récentes déjà favorables pour améliorer artificiellement la lecture.

Deux notions restent séparées :

```text
mature = vérité économique réconciliée
watermark_passable = frontière mécanique autorisée à avancer
```

### 5.4 Commande définitivement irréconciliable

Une commande qui ne pourra plus être réconciliée peut recevoir une disposition humaine gouvernée `IRRECONCILABLE_DISPOSED`.

Cette disposition :

- est enregistrée dans un journal append-only ;
- porte motif, justification, référence de preuve, auteur et date ;
- peut être renversée uniquement par un nouvel événement ;
- reprend le `market_id` de la commande côté serveur ;
- peut rendre la commande **franchissable par le watermark** ;
- **ne transforme jamais la commande en `MATURE`** ;
- ne satisfait aucun critère économique manquant ;
- ne transforme jamais une contribution inconnue en zéro ou en contribution réelle.

### 5.5 Ratios publiés séparément

Le système ne confond jamais :

```text
maturity_ratio      = commandes MATURE / commandes de la cohorte
disposition_ratio   = dispositions effectives / commandes de la cohorte
effective_pass_ratio = commandes franchissables / commandes de la cohorte
```

Un bon `effective_pass_ratio` n'est pas une preuve de maturité.

### 5.6 Politique de disposition externe

Aucun plafond numérique de dispositions n'est caché dans le service.

Si une cohorte utilise des dispositions, une politique externe et versionnée doit définir au minimum son `max_ratio`, sa source et sa version.

```text
si dispositions > 0 ET politique absente:
  status = NOT_DECISIONAL

si disposition_ratio > max_ratio:
  status = NOT_DECISIONAL
```

La disposition sert à empêcher qu'une impossibilité documentaire définitive ne gèle éternellement la chronologie. Elle n'autorise pas à fabriquer la vérité économique manquante.

---

## 6. Couverture de période : gate canonique

La couverture gouverne l'autorisation d'ouvrir de nouvelles positions sous CDR complet.

### 6.1 Maturité minimale

```text
si maturity_ratio < maturity_threshold:
  coverage_ratio = null
  coverage_status = NOT_DECISIONAL
```

`NOT_DECISIONAL` a le même effet d'autorisation que `UNCOVERED`, sans falsifier le ratio.

La présence de dispositions est une information séparée. Elle ne remplace jamais le seuil de maturité et ne rend jamais une contribution non réconciliée utilisable comme réel.

### 6.2 Ratio de couverture

Numérateur et dénominateur portent sur la même fenêtre économique :

```text
coverage_ratio = Σ contributions réconciliées / charge économique de période
```

Le ratio ne se calcule pas à partir de décaissements bruts si ceux-ci couvrent une autre période économique.

Une commande disposée mais non mature n'ajoute aucune « contribution réelle » inventée au numérateur. Avant qu'un gate utilisant de telles cohortes devienne décisionnel, la politique de couverture doit définir explicitement le traitement conservateur de cette incertitude.

### 6.3 États du gate

| État | Condition | Effet |
|---|---|---|
| `COVERED` | maturité suffisante, politique de disposition satisfaite et ratio >= seuil de couverture | ouverture possible d'une stratégie sous CDR |
| `UNCOVERED` | données décisionnelles mais ratio < seuil de couverture | aucune nouvelle sous-couverture |
| `NOT_DECISIONAL` | maturité insuffisante, politique de disposition absente/dépassée ou donnée critique absente | même effet que `UNCOVERED`, ratio non autorisant |

Le gate ne bloque pas automatiquement les ventes et ne repricie pas un produit. Il ferme l'ouverture de **nouvelles** positions sous CDR.

---

## 7. Couverture par marché, vérité globale

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

## 8. Mesurer au niveau où le coût devient vrai

- **Article** : achat produit et coûts propres à l'article.
- **Commande** : frais de paiement et autres coûts transactionnels réellement constatés.
- **Colis** : emballage, transport local, commission relais selon son niveau réel d'engagement, poids et volume constatés.
- **Shipment** : fret, douane, port, transitaire, densité et allocation réelle ; le shipment est la cohorte de vérité de N1 logistique.
- **Période** : provision risque réconciliée, charge économique de structure, budgets stratégiques consommés et viabilité globale.

Le panier moyen reste un indicateur utile mais ne constitue jamais, seul, une preuve de viabilité.

La distribution doit être visible : part de commandes mono-article, part de commandes sous coût variable de commande, distribution de contribution par commande, concentration de contribution par produit / catégorie / marché.

Par défaut, une commande mono-article couvre son coût variable de commande. Une exception n'est autorisée que si elle est financée par un budget stratégique gouverné.

---

## 9. Charges de structure mutualisées : plateforme et Hub physique

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

## 10. Rôle pays et statut de facturation

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

## 11. Clés de mutualisation et intégrité des assiettes

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

## 12. Les quatre repères prix canoniques

| Repère | Nature | Autorité |
|---|---|---|
| **Prix plancher variable** | mécanique, dur | moteur économique |
| **Prix de couverture complète** | référence économique / comptable | moteur économique |
| **Prix marché observé / corridor** | réalité externe / terrain | données comparables vérifiées |
| **Prix décidé** | arbitrage commercial assumé | humain autorisé, sous gates |

`recommended_price` reste transitoirement une référence mécanique de couverture complète pour compatibilité. Il n'est pas automatiquement le prix commercial à appliquer.

Un vrai prix de test marché peut se situer entre le plancher variable et le CDR complet **uniquement si le gate de couverture du marché l'autorise** et si contribution, écart au CDR, motif, durée et budget éventuel sont tracés.

Les trois zones restent :

```text
prix < N1 + N2          => destructif
N1 + N2 <= prix < CDR   => contributif mais sous-couvert
prix >= CDR             => couverture de la structure imputée
```

---

## 13. Ancrage marché

Komerce compare des produits **strictement identiques** lorsque possible : même marque, modèle, capacité, variante et condition.

Amazon, Noon ou d'autres acteurs sont des références de plausibilité, jamais une source de plancher économique.

La comparaison pertinente est le **coût alternatif rendu réellement accessible au client** :

```text
prix plateforme + transport + douane éventuelle + délai + risque + disponibilité
```

Le protocole de benchmark conserve au minimum : source, date, devise, taxe, livraison, disponibilité, vendeur, garantie/service et identité exacte de la variante.

Le marché fournit un corridor, pas une vérité unique. L'indicateur utile est notamment :

```text
contribution disponible sous contrainte marché
= prix marché acceptable - coût variable complet
```

Sans comparable strict suffisamment fiable :

```text
market_anchor_status = NO_STRICT_COMPARABLE
```

Aucun corridor canonique n'est inventé par approximation.

---

## 14. Densité, rotation, fréquence et mix

La densité logistique est un déterminant économique lorsqu'elle modifie les coûts réellement engagés.

La rotation et la fréquence d'expédition ne deviennent jamais des coefficients arbitraires de prix. Elles influencent le pricing uniquement si elles modifient explicitement un coût réel modélisé ; sinon elles restent des signaux de sourcing et d'opérations.

La viabilité se lit comme un régime économique de marché :

```text
panier × densité logistique × cadence × mix produits × rotation cash × risque
```

La densité conditionne d'abord le sourcing et la conception logistique. Elle ne masque jamais un plancher variable destructeur.

---

## 15. Gouvernance des hypothèses et des leviers

Toute modification susceptible d'améliorer artificiellement CDR, contribution, maturité, quote-part de structure ou couverture est versionnée avec auteur, date, motif, valeur avant/après et impact calculé.

Sont gouvernés au minimum :

- objectifs et moyennes d'allocation ;
- largeur de fenêtre et tailles d'échantillon ;
- seuils de maturité et couverture ;
- plafond de dispositions et sa version de politique ;
- règles qui déterminent la maturité et la franchissabilité du watermark ;
- charges de structure et leur classification ;
- périmètre **groupe / marché** de chaque charge ;
- clés de prorata et politique de mutualisation ;
- règle d'activité constatée d'un marché ;
- mode `internal_allocation` / `partner_reinvoice` ;
- taux de provision risque ;
- taux de change appliqués ;
- marge cible, marge de sécurité et seuils de santé ;
- cibles de densité ;
- règles d'éligibilité des comparables.

### Périmètre fermé des charges

Le périmètre des charges de structure est fermé dans deux dimensions :

```text
fixe / variable
groupe / marché
```

Désactiver, reclassifier, déplacer groupe→marché ou marché→groupe, ou exclure une charge est un acte gouverné, publié et auditable.

Aucun changement de classification ne peut améliorer silencieusement un ratio de couverture ou une quote-part facturable.

---

## 16. Chaîne de vérité avant refonte du prix

La séquence canonique est :

```text
mesurer le réel
→ réconcilier estimé vs réel
→ établir la maturité / disposition gouvernée
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

### Préconditions déjà matérialisées dans le moteur

Depuis les lots techniques du 2026-09-06 :

- les snapshots distinguent `estimated_business_variable_cost_kmf` (N2) et `estimated_fixed_overhead_kmf` (N3) ;
- le legacy `estimated_business_complete_cost_kmf` reste conservé pour compatibilité ;
- la variance transactionnelle est fail-closed et ne mélange plus N3 au variable réconciliable ;
- la maturité économique et le watermark anti cherry-picking existent ;
- une disposition irréconciliable est tracée séparément de la maturité et bornée par une politique externe.

Ces préconditions ne signifient pas que le **gate de couverture** est déjà prêt : la vérité N3 de période et sa répartition par marché restent à matérialiser.

---

## 17. Provision risque : contribution provisoire et réconciliation de période

La provision risque appartient à N2 et agit donc sur la contribution. Elle doit être réconciliée en période : provisions passées versus sinistres, pertes et incidents réellement constatés.

Tant que cette réconciliation n'est pas suffisamment mature, contribution et couverture portent un indicateur de confiance explicite.

Modifier un taux de provision risque est un acte gouverné car il agit directement sur le numérateur du ratio de couverture.

---

## 18. Budgets stratégiques : produit d'appel et conquête marché

Une sous-couverture volontaire n'est jamais logée silencieusement dans une marge produit négative ou dans la marge d'un autre marché.

Toute stratégie `loss_leader`, `conquest` produit ou **conquête de marché** utilise un budget stratégique explicite, daté, borné, consommable et gouverné.

Le budget est affiché séparément des charges structurelles. Son montant consommé est un coût économique de période et réduit la capacité de couverture.

À l'épuisement du budget, à la date de fin ou au franchissement du seuil d'arrêt, l'exception se ferme pour toute nouvelle application et force une décision explicite : repricing, renouvellement gouverné, réduction de périmètre ou arrêt de la stratégie.

---

## 19. Saisonnalité

Une fenêtre mûre est nécessairement passée. Avant au moins un cycle annuel représentatif, la saisonnalité reste un contexte documenté, pas un multiplicateur improvisé du gate.

Après accumulation de données suffisantes, les ajustements saisonniers peuvent être calibrés et versionnés sur preuve historique.

---

## 20. Gaps structurels encore ouverts

La doctrine cible dépasse encore le modèle de données actuel sur les points suivants :

- `finance_config` est global/singleton et ne porte pas une vérité N3 par marché ;
- `charges` ne matérialise pas encore la frontière groupe / marché ;
- il n'existe pas encore de vérité canonique de charge économique de période par marché ;
- la largeur de fenêtre canonique et les seuils décisionnels restent à fixer dans une politique versionnée ;
- le traitement conservateur d'une cohorte contenant des dispositions doit être défini avant autorité du ratio de couverture ;
- le budget stratégique de conquête n'est pas encore matérialisé ;
- les clés de mutualisation Hub/plateforme ne sont pas encore implémentées de façon décisionnelle ;
- le corridor marché décisionnel et sa confiance ne sont pas encore matérialisés dans le moteur de prix.

Ne sont plus des gaps : la séparation N2/N3 des snapshots, la maturité, le watermark anti cherry-picking et le journal de dispositions gouvernées.

Ces gaps restants sont des préconditions de chantier, pas une invitation à les combler par des fallbacks silencieux.

---

## 21. Interdictions

- Interdit : `prix = coût × coefficient` comme règle unique.
- Interdit : appeler « marge 300 % » un markup de 300 % ; les terminologies markup et marge sur vente restent distinctes.
- Interdit : utiliser le marché pour définir le plancher économique.
- Interdit : utiliser un objectif non réalisé comme dénominateur de référence N3.
- Interdit : transformer une absence de vérité en chiffre rassurant ou en zéro.
- Interdit : transformer une disposition en maturité réelle.
- Interdit : utiliser une disposition sans politique externe versionnée lorsque la cohorte en contient.
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
- Interdit : réinjecter une quote-part Railway / Cloudinary / Hub fixe comme coût variable article.
- Interdit : refacturer et imputer deux fois la même charge économique.
- Interdit : utiliser `markets.is_active` comme diviseur économique d'un pool partagé.
- Interdit : utiliser le poids comme proxy de stockage Hub ou de volume maritime absent.
- Interdit : déduire la facturabilité d'un marché du rôle `market_operator`.

---

## 22. Ce qui ne doit pas être codé encore

Les préconditions N2/N3 + maturité + watermark + dispositions étant désormais matérialisées, le prochain verrou n'est plus là. Il est dans la **vérité de structure de période**.

Tant que cette vérité et les politiques associées ne sont pas explicites :

- ne pas modifier `computePrices` pour remplacer aujourd'hui `CDR / (1 - marge)` par un prix marché ;
- ne pas retirer `recommended_price` de l'API ;
- ne pas donner d'autorité au gate de couverture avant matérialisation de la charge N3 économique de période par marché et définition versionnée de la fenêtre, des seuils de maturité/couverture et de la politique de dispositions ;
- ne pas coder l'ancrage marché décisionnel avant échantillon de comparables stricts vérifié ;
- ne pas donner d'autorité commerciale à un ratio calculé sur charges configurées au lieu de charges économiques de période ;
- ne pas coder la refacturation partenaire avant ratio de couverture réconcilié et contrat explicite ;
- ne pas ajouter `market_id` à `charges` avant arbitrage de la frontière groupe / marché ;
- ne pas dupliquer `finance_config` par marché avant modèle de structure validé ;
- ne pas traiter une commande disposée comme une commande mature ou comme une contribution connue.

---

## 23. Phrase de contrôle

Avant de valider un prix, une stratégie ou une quote-part marché :

1. Quel est le plancher variable réel et avec quel niveau de confiance ?
2. Quelle contribution ce prix génère-t-il ?
3. Ce marché est-il `COVERED`, ou consomme-t-il un budget de conquête groupe explicite ?
4. La donnée de maturité est-elle suffisante et non sélectionnable ?
5. Les dispositions éventuelles sont-elles visibles, bornées et sans faux réel ?
6. La charge de structure attribuée au marché provient-elle d'un pool gouverné sans double comptage ?
7. Le prix est-il crédible au regard d'un comparable strict réellement accessible au client ?
8. S'il s'agit d'une exception, quel budget la finance et quand expire-t-elle ?
9. S'il s'agit d'une refacturation, existe-t-il un contrat et l'invariant de conservation est-il vérifié ?

Le shipment porte la vérité logistique de N1. La période porte la vérité de structure. Le `market_id` porte la responsabilité économique locale. Le groupe porte la vérité consolidée. Le marché borne la plausibilité. Aucun de ces niveaux ne remplace les autres.

Si une réponse critique est inconnue, Komerce dit `NOT_DECISIONAL` au lieu de fabriquer une fausse précision.

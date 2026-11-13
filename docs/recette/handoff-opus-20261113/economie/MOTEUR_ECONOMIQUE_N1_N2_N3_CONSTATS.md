# Audit contradictoire du moteur économique N1 / N2 / N3

`main` @ 6439116, 11 novembre 2026. Audit en lecture seule : aucun prix, aucune configuration ni donnée n'a été modifié.

**Niveaux de preuve.**
- **[CODE]** : démontré par la lecture du code. Quand c'est indiqué « reproduit », `computeCDR` a été exécuté hors base avec les valeurs semées par les migrations.
- **[DONNÉES]** : dépend des valeurs réellement en base sur le staging. Je n'avais aucun accès à la base pendant l'audit ; les requêtes de vérification sont en annexe.
- **[HYP]** : hypothèse de travail, à confirmer.

---

## Réponse à la question finale

**Non. Komerce ne sait pas encore calculer un coût rendu relais prévisionnel économiquement défendable.**

Trois raisons, toutes démontrées dans le code :
1. **Doubles comptages.** Le calcul prévisionnel compte deux fois le fret au volume et deux fois les provisions de risque. La seconde provision est invisible dans le détail affiché.
2. **Diviseurs jamais mesurés.** Tous les coûts engagés par commande, par colis ou par expédition sont divisés par 2,5, 4 et 200 articles. Ces valeurs ont été posées comme hypothèses en avril 2026. Le recalibrage automatique annoncé n'existe pas, et la proposition de recalibrage manuelle mesure mal ces moyennes.
3. **Deux méthodes de répartition opposées.** La prévision répartit au nombre d'articles. Le réel répartit au poids, au volume ou à la valeur CIF. Prévu et réel ne sont donc pas comparables.

**Ce qui est fiable :**
- le prix d'achat converti par l'autorité FX unique ;
- la ventilation **réelle, après coup**, des frais d'expédition (`transport-cost-allocation`) et de la douane, par clés physiques explicites et avec repli signalé ;
- la règle « inconnu ≠ zéro » pour la douane ;
- l'exclusion de la N3 du prix plancher.

**Ce qui ne l'est pas :**
- la N1 prévisionnelle (doublons, diviseurs arbitraires) ;
- la N2 (risque compté deux fois, frais de paiement calculés sur le coût au lieu du prix) ;
- la N3 par article (elle dépend d'un **objectif** de 100 commandes par mois, pas d'un volume réel) ;
- le statut « sous-tarifé / sur-tarifé » de l'Atelier, calculé par l'ancienne formule.

La correction tient sans perte de traçabilité, parce que le côté réel est déjà bien construit (livrable D).

---

## Livrable A — Cartographie des coûts

**Les sources.**
- `cost_components`, semé par la migration 043 et modifié par la 047, avec surcharges par marché via `cost-component-market-service`.
- `risk_provisions`.
- `charges` (structure).
- `finance_config` : une **ligne unique `id = 1`, commune à tous les marchés**, avec des colonnes historiques parallèles.

Le calcul est fait dans `services/pricing-cdr.js` (`computeCDR`), puis consommé par `pricing-engine.js` et `pricing-output.js`. Le côté réel vit dans `services/transport-cost-allocation.js` et `services/cost-allocation/allocate.js`.

| Coût | Source | Montant semé | Unité / répartition prévisionnelle | Nature | Classe | Fiabilité | Risque |
|---|---|---|---|---|---|---|---|
| Achat fournisseur | `products.cost_kmf` | produit | article | direct | N1 | connu si `cost_kmf` à jour | absent vaut 0 avec un avertissement, mais le calcul continue |
| Frais bancaires achat | `frais_bancaires_achat_pct` | 1,5 % | % du sous-total | variable | N1 | estimé | % appliqué en cascade, dépend de l'ordre |
| Temps acheteur | `sourcing_temps_acheteur_kmf` | 200 / commande | ÷ 2,5 | mutualisé | N1 | estimé | engagé par commande fournisseur, pas par commande client |
| Contrôle qualité Hub | `hub_controle_qualite_kmf` | 150 / colis | ÷ 4 | mutualisé | N1 | estimé | unité « colis » mais `allocation_method = per_item` : contradiction |
| Étiquetage Hub | `hub_etiquetage_kmf` | 50 / colis | ÷ 4 | mutualisé | N1 | estimé | idem |
| Carton | `packaging_carton_standard_kmf` | 300 / colis | ÷ 4 | mutualisé | N1 | estimé | indépendant de la taille de l'article |
| Fret au volume, **en dur** | `pricing-cdr.js:255`, `fret_eur_per_m3` | 180 €/m³ | m³ × €/m³ × taux | variable | N1 | estimé | **doublon** avec la ligne suivante |
| Fret maritime, **composant** | `fret_maritime_eur_m3` | 180 €/m³ | `by_volume` | variable | N1 | estimé | **doublon** avec la ligne précédente |
| Assurance transport | `assurance_transport_pct` | 0,5 % | % du sous-total, pas de la CIF | variable | N1 | estimé | assiette fausse |
| Inspection douane | `frais_inspection_douane_kmf` | 5 000 / expédition | ÷ 200 | mutualisé | N1 | estimé | fait passer la douane à « estimée » |
| Transitaire | `transitaire_kmf` (047) | 80 000 / expédition, « sans facture, fourchette 50–120 k » | ÷ 200 | mutualisé | N1 | **inconnu** | indépendant du volume |
| Frais portuaires | `frais_portuaires_kmf` | 25 000 / expédition | ÷ 200 | mutualisé | N1 | estimé | idem |
| Port → relais | `transport_port_relais_kmf` | 500 / colis | ÷ 4 | mutualisé | N1 | estimé | appliqué aussi au stock local |
| Inter-îles Mohéli / Anjouan | composants dédiés | 800 / colis | `scope = category` | mutualisé | N1 | estimé | lié à la catégorie produit, pas au relais de destination [DONNÉES] |
| Commission relais | `commission_relais_kmf` | 500 / commande | ÷ 2,5 = 200 par article | variable | N1 | estimé | **réel facturé 500 par unité** (`allocate.js:399`) |
| Frais Stripe | `stripe_pct`, `stripe_fixed_kmf` | 1,5 % et 130 / commande | % du **coût** | variable | N2 | connu (contrat PSP) | assiette fausse : Stripe prélève sur le prix |
| Collecte cash | `cash_collecte_kmf` | 200 / commande | ÷ 2,5 | variable | N2 | estimé | — |
| Provisions non-collecte et casse | composants `risk_provision` | 2 % et 1 % | % du sous-total | variable | N2 | hypothèse | **double comptage invisible** |
| Provision risque | table `risk_provisions` | [DONNÉES] | % du coût variable | variable | N2 | hypothèse | voir ci-dessus |
| Provision risque réelle | `finance_config.provision_risque_pct` | 1 % | % du **CA du mois**, par ligne de commande | variable | N2 | hypothèse | base et source différentes de la prévision |
| Charges de structure | `charges` (047 : loyer 200 k, salaires 800 k, SaaS 100 k, divers 100 k par mois) | 1 200 000 / mois | ÷ objectif de commandes ÷ 2,5 | fixe | N3 | estimé | les charges `per_order` sont rangées en fixe |
| Hub Dubaï | `finance_config.hub_monthly_cost_aed` | 7 000 AED / mois | **porté nulle part** en prévision ; en réel `period_structure_not_allocated` | fixe mutualisé | N3 | estimé | omission : pool Hub non refacturé |
| Douane réelle | `customs_shipments` et frais typés | réel | ventilée par CIF, poids, volume ou manuel | réel | N1 réel | réel | correct |
| Fret, port, transitaire réels | `allocateShipmentRealCosts` | réel | poids taxable, volume, colis ou CIF, repli signalé | réel | N1 réel | réel | correct |
| Force majeure | `incident_force_majeure_kmf` | 0 | manuel | exceptionnel | exceptionnel | — | — |
| Colonnes historiques de `finance_config` | `frais_stripe_pct`, `transitaire_pct`, `portuaires_kmf`, `commission_relais_*`, `cost_fixed_*`, `customs_rate_default_pct` (42 %) | — | — | — | — | — | **deuxième source** pour les mêmes coûts, dont certaines encore lues en repli |

**Ce qu'est une « expédition ».** En réel, `customs_shipments` est un groupage de colis expédiés ou en transit, remis au transitaire, qui porte des frais typés. En prévision, c'est « 1 conteneur LCL Dubaï–Moroni » (commentaire de la migration 045). Il n'existe donc qu'un seul corridor implicite, alors que CM et CG en ont d'autres.

---

## Livrable B — Diagnostic critique

Les points sont classés par impact.

**B1. Le fret au volume est compté deux fois** [CODE, reproduit].
- `pricing-cdr.js:255` calcule un fret en dur : `volume × fret_eur_per_m3 × taux`.
- Le composant `fret_maritime_eur_m3` (catégorie `freight`, `by_volume`) ajoute le même montant (`:302`).
- Pour 0,002 m³ : fret 661 avec le composant, 483 sans. Les 177 KMF du volume sont comptés deux fois.

**B2. Les provisions de risque sont comptées deux fois, et la seconde est masquée** [CODE, reproduit].
- Les composants de catégorie `risk_provision` (2 % + 1 %) entrent dans le sous-total variable.
- Ensuite, `details.risks` est **écrasé** (`:377`) par le seul calcul de `risk_provisions`, et ce calcul s'ajoute à son tour (`:384`).
- Exemple : coût variable du CDR 65 265, somme du détail affiché 63 370. Il y a **1 894 KMF comptés mais invisibles**.
- Le plancher est calculé sur 65 265, alors que l'écran affiche un coût variable de 63 370 : le prix plancher ne se reconstitue pas à partir des lignes affichées.

**B3. La même mécanique vaut pour `fixed_overhead`** [CODE].
- Un composant de catégorie `fixed_overhead` entre dans le coût variable, puis `details.fixed_costs` est écrasé.
- Le filtre de `pricing-output.js:88` est inopérant : il teste `economic_nature` et `cost_type`, deux champs que les allocations ne portent pas.
- Ce n'est sans conséquence que si le composant vaut 0 (c'est le cas du seed) [DONNÉES].

**B4. Les coefficients 200, 4 et 2,5 ne sont pas justifiés** [CODE].
- **Origine** : migration 045 d'avril 2026, « valeurs hypothèses (low confidence), recalibrées automatiquement quand on aura du volume ». Ce sont aussi les valeurs par défaut des colonnes, et les replis `|| 200 / 4 / 2.5` sont recopiés dans 3 fichiers.
- **Pourquoi 200 articles par expédition ?** Un conteneur LCL Dubaï–Moroni imaginé avant tout volume réel. Rien ne relie ce chiffre à un volume ni à une capacité.
- **Pourquoi 4 articles par colis ?** Un sac ou carton sortant moyen supposé. Ça ne correspond pas au modèle actuel, où le Hub regroupe librement (KOM-BOX multi-commandes, pas « 1 colis = 1 commande »).
- **Pourquoi 2,5 articles par commande ?** Un panier supposé. Il n'est ni mesuré, ni différencié par marché.
- **Recalibrage** : aucun job ne recalibre. `allocation_calibrated_at` est probablement nul [DONNÉES].
- **Conséquence** : un même produit porte entre 930 et 2 810 KMF de coûts mutualisés par article selon le regroupement réel (livrable C). C'est négligeable sur un article à 60 000 KMF, mais **décisif sur un article à 3 000 KMF**.
- **Incompatibilités** :
  - frais d'expédition répartis sans tenir compte du volume, alors que le fret réel est au m³ ;
  - stock local ;
  - corridors CM et CG ;
  - expéditions de taille variable ;
  - articles volumineux, qui sont sous-chargés.

**B5. Le recalibrage proposé mesure faux** [CODE] (`routes/admin-costing.js:542-544`).
- Il compte des **lignes** de commande (`COUNT(oi.id)`) et non des unités.
- Il ne filtre ni par marché ni par circuit : les articles locaux, qui n'ont jamais d'expédition, gonflent le ratio articles / expédition.
- Il compte tous les colis et toutes les expéditions créés sur la période, quel que soit leur statut.

**B6. Prévision et réel utilisent des unités différentes** [CODE].
- **Commission relais** : la prévision compte 500 par commande ÷ 2,5 = 200 par article. Le réel compte 500 **par unité** (`allocate.js:399`). L'écart est de ×2,5 sur chaque article.
- **Risque** : la prévision applique 3 % + 1 % au coût. Le réel applique 1 % au CA du mois, divisé par le nombre de lignes.
- **Frais d'expédition** : la prévision divise par 200 articles. Le réel répartit au poids, au volume ou à la valeur CIF.
- Conséquence : l'écart prévu / réel ne mesure pas une erreur d'estimation, il mesure une différence de méthode.

**B7. Les pourcentages sont appliqués sur un sous-total de coût, en cascade** [CODE] (`:288`).
- Chaque % s'applique au total déjà accumulé. Le résultat dépend donc de l'ordre d'affichage des composants.
- Les frais Stripe et la provision de non-collecte sont des **% du prix** encaissé, pas du coût. Ils sont sous-estimés de `taux × (prix − coût)`.
- L'assurance s'applique au sous-total et non à la valeur CIF déclarée.

**B8. Une petite ligne d'inspection masque l'absence d'estimation douane** [CODE] (`:355`).
- Il suffit d'un composant de catégorie `customs` (l'inspection, 25 KMF par article) pour que le statut passe à `cost_component`. L'avertissement « douane non estimée » disparaît alors.
- Les honoraires transitaire (prestation commerciale) et les frais portuaires sont regroupés dans la même ligne. La doctrine demande de les distinguer des droits de douane.

**B9. Le stock local paie le Hub** [CODE] (`:254`).
- `LOCAL_STOCK` n'exclut que fret, douane et port.
- Le contrôle qualité Hub, l'étiquetage, le carton Hub, le temps acheteur, les frais bancaires d'achat et le transport port → relais restent imputés.
- Ça contredit la doctrine « commandes locales hors Hub et hors PO ».

**B10. La N3 n'est pas une vérité de période** [CODE].
- La N3 par article vaut charges mensuelles ÷ **objectif** de commandes (100 par défaut) ÷ 2,5. Dans l'exemple, ça donne 4 800 KMF par article ; avec 30 commandes réelles par mois, ce serait 16 000.
- Les charges `per_order` (`:181`), qui sont variables, sont rangées en N3.
- La table `charges` est globale et n'est pas attribuée par marché.
- Le Hub (7 000 AED par mois) n'est dans aucun calcul prévisionnel, et il n'est pas alloué en réel : le pool mutualisé que tu veux refacturer au prorata des marchés n'est porté nulle part.
- `order-cost-snapshot.js:86-95` enregistre une N3 et un `cdr = n1 + n2 + n3` **par commande**, ce qui contredit « N3 n'est jamais une dette du SKU ». Le prix plancher, lui, l'exclut correctement.

**B11. Deux moteurs coexistent, et l'Atelier affiche un statut incohérent avec son prix** [CODE].
- `pricing-recommend.js` garde l'ancien calcul. Ce qu'il appelle « Niveau 2 » est la structure fixe, et son « Niveau 3 » les provisions, calculées sur N1 + structure. Le prix y vaut **coût complet ÷ (1 − marge)** (`:258`, `:468`).
- **Le batch utilisé par l'Atelier** (`pricing-workspace.js:591`) calcule `status` (sous-tarifé, sur-tarifé, aligné), `gap_kmf` et les compteurs avec cette ancienne formule (`:477`). Il remplace ensuite le prix affiché par celui du moteur doctrinal.
- Résultat : un produit peut être marqué « sous-tarifé » par rapport à un prix que l'écran ne montre pas.
- En cas d'erreur du moteur, le repli vers l'ancien calcul est silencieux (`source_of_truth: legacy-fallback`).
- **L'Atelier est tronqué à 200 produits** (`limit: 200`) pour un catalogue d'environ 500.

**B12. Le prix de référence reste du coût majoré** [CODE].
- Le prix de référence vaut `V ÷ (1 − marge cible)`.
- Le plancher vaut `V × 1,10`, une marge de sécurité de 10 % sans justification.
- La doctrine « prix ancré dans le marché, protégé par un plancher variable » n'est donc pas encore implémentée dans `computePrices`. Elle vit dans d'autres couches (corridor, politique de décision marché), que je n'ai pas auditées en profondeur.

**B13. Des valeurs par défaut silencieuses fabriquent une précision apparente** [CODE].
- Catégorie absente : `phones`.
- Poids absent : 1 kg. Volume absent : 0,005 m³.
- Catégorie de composant inconnue : rangée en sourcing (`:344`).
- Des avertissements sont émis, mais le calcul produit quand même un plancher au KMF près. La couverture réelle des poids et volumes produits reste à mesurer [DONNÉES].

**B14. Les paramètres sont uniques pour tous les marchés** [CODE].
- `finance_config` n'a qu'une ligne (`id = 1`) : fret €/m³, moyennes, objectif de commandes et marge cible sont partagés par KM, CM et CG.
- Seuls les composants peuvent être surchargés par marché.

**B15. Deux référentiels existent pour les mêmes coûts** [CODE].
- Les colonnes historiques de `finance_config` doublonnent `cost_components`.
- Certaines sont encore lues en repli : commission relais, `provision_risque_pct`, Hub.
- `customs_rate_default_pct = 42` subsiste, alors que la doctrine neutralise les taux théoriques.

**B16. Les valeurs semées ne viennent pas de factures** [DONNÉES].
- Transitaire 80 000 : « estimation initiale en l'absence de facture ».
- Portuaires 25 000 et inspection 5 000 : confiance faible ou moyenne.
- Il faut vérifier si elles ont été remplacées par des montants réels.

**Ce qui tient :**
- La ventilation réelle des expéditions (`transport-cost-allocation`) : clés poids taxable, volume, colis ou CIF, avec repli `estimated_fallback` signalé.
- La douane réelle par expédition, avec quote-part, frais typés et règle « inconnu ≠ zéro ».
- La commission relais n'est « réelle » que si elle a été saisie par un opérateur avec une provenance.
- La marge réelle en mode shadow.
- L'autorité FX unique.
- La N3 exclue du prix plancher.

---

## Livrable C — Exemple chiffré

Le produit est **hypothétique** et ce ne sont pas des coûts réels : je n'avais pas accès aux données du staging.
- Accessoire de téléphone vendu sur KM : achat 60 000 KMF, 0,4 kg, 0,002 m³, canal cash relais.
- Paramètres : valeurs semées par les migrations 043 et 047, EUR à 491,96 KMF, `risk_provisions` à 1 %, charges de 1 200 000 par mois, objectif de 100 commandes.
- Résultats obtenus en exécutant le vrai `computeCDR`.

| # | Étape | Montant (KMF) | Formule | Source |
|---|---|---|---|---|
| 1 | Achat | 60 000 | `cost_kmf` | produit |
| 1b | Frais bancaires | 903 | 1,5 % du sous-total | composant |
| 2 | Livraison fournisseur | **absente** | aucun composant | omission [HYP] |
| 3 | Hub (contrôle, étiquetage, carton, temps acheteur) | 51 + 75 + 80 | 200 ÷ 4, 300 ÷ 4, 200 ÷ 2,5 | composants |
| 4 | Fret | 661, dont **177 en doublon** | 0,002 × 180 × 491,96, deux fois, + assurance 307 | B1 |
| 4b | Expédition (inspection, transitaire, port) | 25 + 400 + 125 | 110 000 ÷ 200 | B4 |
| 4c | Port → relais et commission relais | 125 + 200 | 500 ÷ 4, 500 ÷ 2,5 (réel : 500) | B6 |
| 5 | **N1 affiché** | ≈ 62 644 | somme des lignes | — |
| 6 | N2 : collecte cash et provision 1 % | 80 + 646 | — | — |
| 6b | N2 masqué : provisions des composants | **1 894** | 2 % + 1 % | B2 |
| 7 | Coût variable affiché / utilisé | **63 370 / 65 265** | — | B2 |
| 8 | Plancher | 71 990 | 65 265 × 1,10, arrondi | `computePrices` |
| 8b | Référence | 93 990 | V ÷ (1 − 30 %) | — |
| 9 | Contribution à 80 000 | 14 735 (réelle sans doublons ≈ 16 800) | P − V | — |
| 10 | Couverture N3 | 82 articles par mois | 1 200 000 ÷ 14 735 | période |

**Le même produit selon le regroupement.**

Les coûts mutualisés se répartissent ainsi :
- **Par commande : 900 KMF** (temps acheteur 200, relais 500, collecte cash 200).
- **Par colis : 1 000 KMF** (contrôle 150, étiquetage 50, carton 300, port → relais 500).
- **Par expédition : 110 000 KMF** (inspection 5 000, transitaire 80 000, port 25 000).

| Scénario | Commande | Colis | Expédition | Total par article |
|---|---|---|---|---|
| Moteur actuel (2,5 / 4 / 200) | 360 | 250 | 550 | **1 160** |
| Article seul (1 / 1 / 200) | 900 | 1 000 | 550 | **2 450** |
| Panier de 5 articles, colis de 5 | 180 | 200 | 550 | **930** |
| Petite expédition de 50 articles | 360 | 250 | 2 200 | **2 810** |
| Expédition au volume (1,5 m³ [HYP]) | 360 | 250 | 147 | **757** |

Pour un article acheté **3 000 KMF** (0,1 kg, 0,0005 m³), le moteur sort un coût variable de **4 486 KMF** et un plancher de 4 990. Les seules hypothèses de répartition pèsent de 25 % à 94 % du prix d'achat : c'est là que le prix devient arbitraire.

---

## Livrable D — Architecture corrigée

**Les principes.** Aucun nouveau chiffre arbitraire. La traçabilité existante est conservée, et la bascule passe d'abord par un mode shadow.

1. **Une seule autorité de calcul.** `pricing-engine` porte le prix, le plancher **et** le statut de l'Atelier. `pricing-recommend` relaie intégralement ce résultat (statut, écart, compteurs) ou disparaît. Le repli vers l'ancien calcul est supprimé : si le moteur échoue, le produit est `NOT_DECISIONAL`. L'Atelier est paginé, sans troncature à 200.
2. **Chaque composant déclare** :
   - son niveau d'engagement (article, colis, commande, expédition, période) ;
   - sa clé physique (unités, kg taxable, m³, CIF, prix de vente) ;
   - le statut de sa valeur (`MEASURED`, `QUOTED`, `ESTIMATED`, `UNKNOWN`) avec sa provenance ;
   - son marché et son corridor.

   Une seule ligne par coût : on supprime le fret en dur et les colonnes historiques. Les composants `risk_provision` et `fixed_overhead` sont exclus du sous-total variable.
3. **Des diviseurs mesurés, jamais supposés :**
   - **Expédition** : un coût observé au m³ (ou au kg taxable) par corridor, égal à Σ frais des expéditions clôturées ÷ Σ volume expédié, sur une fenêtre glissante avec un minimum d'expéditions. Article : coût au m³ × volume de l'article. C'est la même clé que la ventilation réelle, ce qui rend prévu et réel comparables.
   - **Colis** : part de l'article = son volume ÷ le volume utile moyen observé d'un colis.
   - **Commande** : on ne dilue pas ce coût dans un plancher unitaire. Le plancher est affiché pour deux cas explicites : commande mono-article, et panier médian **observé** du marché.
   - **Pas de mesure suffisante** → `UNKNOWN`, donc `NOT_DECISIONAL`. Pas de repli 200 / 4 / 2,5.
4. **Les frais proportionnels au prix sont calculés sur le prix**, par résolution :
   `P_plancher = (V_hors_pourcentages + frais fixes) ÷ (1 − Σ %prix − marge de sécurité)`.
   Les % sur le coût s'appliquent à une assiette explicite (CIF, achat) et non en cascade.
5. **La N3 est traitée hors article.**
   - Couverture de période par marché (`pricing-period-structure` et `market_cost_attributions`), en N3 réelle et non en objectif.
   - Le Hub est un pool mutualisé refacturé au prorata des marchés, selon une clé à décider.
   - Le snapshot de commande n'additionne plus de N3 ; il la renomme éventuellement `analytical_structure_share`.
   - Les charges `per_order` passent en N2.
6. **Circuits.** `LOCAL_STOCK` exclut tout le bloc Hub et import et porte ses propres coûts locaux. Les surcoûts inter-îles dépendent du relais de destination.
7. **Paramètres par marché et par corridor** : le fret, les observations et l'objectif sortent de la ligne unique `finance_config`.
8. **Boucle de réconciliation.** Chaque expédition clôturée produit un écart prévu / réel par composant. Cet écart alimente la mesure du point 3, sans jamais modifier un prix automatiquement.

**Arbitrages qui te reviennent :**
1. La clé par défaut des frais d'expédition : volume, poids taxable ou CIF.
2. Le plancher de référence : mono-article ou panier médian observé.
3. La clé de refacturation du Hub entre marchés.
4. Le seuil d'observations pour passer `MEASURED`.
5. Le traitement du transitaire : forfait par expédition ou % CIF, selon les factures réelles.
6. Le retrait de l'ancien calcul de recommandation.
7. La marge de sécurité de 10 %, à justifier ou à remplacer.

**Les données à collecter :**
- volume et poids taxable de chaque expédition ;
- factures du transitaire, du port et du fret ;
- volume des colis et KOM-BOX ;
- unités par commande, par marché ;
- couverture des poids et volumes produits ;
- coût Hub mensuel réel.

---

## Livrable E — Plan de validation

- **Tests unitaires** (fonctions pures, sans base) :
  - le fret n'est compté qu'une fois ;
  - Σ des lignes affichées = coût variable utilisé par le plancher ;
  - `fixed_overhead` est exclu du variable ;
  - les frais Stripe sont calculés sur le prix ;
  - les % ne dépendent pas de l'ordre des composants ;
  - `LOCAL_STOCK` ne porte aucun coût Hub ;
  - un diviseur inconnu donne `NOT_DECISIONAL` et jamais 200 / 4 / 2,5 ;
  - la commission relais a la même unité en prévu et en réel.
- **PostgreSQL** :
  - mesure par marché, en unités, uniquement sur les expéditions import clôturées ;
  - comparaison shadow prévu / réel sur une expédition de test multi-colis et multi-commandes ;
  - le snapshot de commande ne somme plus de N3.
- **Cas limites** : expédition d'un seul colis, colis multi-commandes, commande sur plusieurs colis, produit sans volume, zéro distinct de l'inconnu, marché CM sans historique, annulation après groupage.
- **Chromium (Atelier des prix)** :
  - le prix, le plancher, le statut et le détail se reconstituent à l'identique ;
  - `NOT_DECISIONAL` est visible quand une mesure manque ;
  - le catalogue complet est accessible au-delà de 200 produits ;
  - aucun prix catalogue n'est modifié sans action humaine.
- **Bascule** : shadow sur données réelles, comparaison avec l'ancien calcul, GO humain explicite.

---

## Annexe — Requêtes de vérification, en lecture seule, à exécuter sur le staging

```sql
-- 1. Paramètres effectifs et état de calibration
SELECT avg_articles_per_order, avg_articles_per_parcel, avg_articles_per_shipment,
       allocation_confidence, allocation_calibrated_at, fret_eur_per_m3, objectif_commandes_mois
FROM finance_config;

-- 2. Composants actifs : confirmer B1 (fret_maritime_eur_m3), B2 (risk_provision), B3 (fixed_overhead)
SELECT key, category, unit, default_value, allocation_method, scope, confidence, source
FROM cost_components WHERE is_active ORDER BY category, key;

-- 3. Provisions et structure
SELECT * FROM risk_provisions WHERE is_active;
SELECT name, amount_kmf, recurrence_period FROM charges WHERE is_active;

-- 4. Réalité du panier par marché (unités, pas lignes)
SELECT o.market_id, COUNT(DISTINCT o.id) AS commandes,
       SUM(oi.quantity)::numeric / NULLIF(COUNT(DISTINCT o.id), 0) AS unites_par_commande
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.payment_status = 'paid' AND o.status NOT IN ('cancelled', 'refunded')
GROUP BY o.market_id;

-- 5. Couverture poids et volume du catalogue actif
SELECT COUNT(*) AS actifs,
       COUNT(*) FILTER (WHERE weight_kg IS NULL OR weight_kg <= 0) AS sans_poids,
       COUNT(*) FILTER (WHERE volume_cm3 IS NULL OR volume_cm3 <= 0) AS sans_volume
FROM products WHERE is_active;

-- 6. Expéditions réelles : colis, frais et volume (noms de colonnes de frais à adapter au schéma)
SELECT cs.id, COUNT(DISTINCT csp.parcel_id) AS colis
FROM customs_shipments cs LEFT JOIN customs_shipment_parcels csp ON csp.shipment_id = cs.id
GROUP BY cs.id ORDER BY cs.id DESC LIMIT 20;
```

# Contre-expertise N1/N2/N3 : code actuel et staging réel, en lecture seule

**Preuve exécutée.**
- Run [#43002604483](https://github.com/SamyrFateh/komerce-backend/actions/runs/43002604483), sur la branche `research/economic-staging-readonly-census` (script `scripts/recette/economic-engine-staging-readonly-census.js`). Le workflow ne se déclenche que sur cette branche, rien n'est mergé.
- Staging : commit `eb656dd` (`/health/version`), cible vérifiée par `target-guard`, migrations appliquées jusqu'à la 401.
- **Lecture seule imposée à trois niveaux** : `PGOPTIONS=default_transaction_read_only=on` pour toute session (y compris le pool du moteur), `BEGIN READ ONLY` contrôlé par `SHOW transaction_read_only = on`, et une garde statique contre tout SQL mutable.
- Aucune écriture, aucun prix modifié. Les fixtures de #3808 ne sont pas touchées.

**Niveaux de preuve** : **[CODE]**, **[DONNÉES STAGING]**, **[HYPOTHÈSE]**, **[NON VÉRIFIABLE]**.

## Verdict

| Question | Réponse |
|---|---|
| **Montants réellement payés et enregistrés** | **Aucun** [DONNÉES STAGING]. Zéro frais d'expédition (`customs_shipment_fees`), zéro allocation réelle (`order_item_real_cost_allocations`), zéro imputation, zéro attribution marché, zéro événement de structure. Les 10 expéditions sont des fixtures E2E (CIF 1 000, droits 0, sans poids). |
| **Montants estimés** | **Tous les composants**. 21 composants actifs, tous `source = default` sauf un, aucun avec provenance, confiance faible ou moyenne. Aucun ne vient d'une facture ou d'un devis. |
| **Doublons** | Fret maritime compté deux fois, **actif** [CODE + DONNÉES]. |
| **Charges imputées à tort** | Les surcoûts inter-îles Mohéli **et** Anjouan s'appliquent ensemble à chaque article, **y compris sur CM et CG** [DONNÉES]. |
| **Lignes masquées** | Les provisions de risque (3 %) entrent dans le plancher mais pas dans la N2 affichée [DONNÉES]. |
| **Omissions** | Livraison fournisseur → Hub, et coût réel du Hub Dubaï [CODE + DONNÉES]. |
| **Diviseurs 200 / 4 / 2,5** | Valeurs d'avril 2026, **jamais calibrées** (`allocation_calibrated_at = NULL`, confiance `low`). Le staging ne contient que des commandes simulées : 1,75 unité par commande, ce qui ne prouve rien. |

**Conclusion.** Le N1/N2/N3 actuel ne peut servir qu'à **ordonner des hypothèses**, pas à fixer un prix. Pour le rendre utile, il faut :
- supprimer les doublons ;
- prendre les coûts dans l'unité où ils sont réellement engagés ;
- partir de **tarifs ou devis** réels (`QUOTED`) avant la première expédition, puis de mesures (`MEASURED`) ;
- marquer tout le reste `ESTIMATED` ou `UNKNOWN`, de façon visible et non décisionnelle.

## A. Configuration effective du staging [DONNÉES STAGING]

- **`finance_config`** : 2,5 / 4 / 200, `allocation_confidence = low`, `calibrated_at = NULL`, fret 180 €/m³, objectif 100 commandes par mois, marge cible 40 %, Hub 7 000 AED par mois, `provision_risque_pct = 0,01`. Dernière modification le 23 avril 2026.
- **`cost_components`** : 21 actifs, **aucune surcharge par marché** (`market_id` vide partout), donc KM, CM et CG partagent les composants de Moroni.
  - `fret_maritime_eur_m3` (180 €, par volume) est actif, et `pricing-cdr.js:255` ajoute aussi le fret en dur : **doublon actif**.
  - `transitaire_kmf` est en réalité un **pourcentage (3 %)** du sous-total de coût en cascade, malgré son nom. Le forfait de 80 000 KMF prévu par la migration 047 n'est pas en vigueur.
  - `commission_relais_kmf` vaut 600 par commande (modifié le 19 octobre, `source = default`, sans provenance), donc compté comme estimation en réel.
  - `transport_inter_iles_moheli_kmf` et `_anjouan_kmf` valent 800 par colis, `scope = category`, sans lien avec le relais de destination.
  - Il reste une seule ligne de risque : les composants `provision_non_collecte` (2 %) et `provision_casse_transport` (1 %).
- **`risk_provisions`** : vide. Le double comptage du risque n'existe donc pas sur ces données, mais le masquage existe : `details.risks` est écrasé à 0.
- **`charges`** (structure active) :
  - 1 200 000 KMF par mois de charges réelles supposées : salaires 800 k, loyer « bureaux + hub Moroni » 200 k, SaaS 100 k, divers 100 k.
  - **cinq lignes historiques** reprises des colonnes `finance_config.cost_fixed_*` : Sourcing Dubaï 1 000, Hub Dubaï 400, Relais Comores 300 et Support 200 « par mois », Transit Comores 500 **par commande**. Ce sont d'anciens coûts unitaires étiquetés comme charges de structure. Le « Hub Dubaï » vaut 400 KMF par mois face aux 7 000 AED de `finance_config`.
  - douze doublons inactifs de seeds répétés.
- **Marchés actifs** : CG, CM, KM, WM, YT, ZZ. DJ est inactif.
- **Catalogue actif** : 79 produits, tous des fixtures. Prix d'achat médian 3 000 KMF, **76 sur 79 sans catégorie** (le moteur bascule alors silencieusement sur `phones`), 3 sans volume.
- **Stock local** : 19 allocations `local_stock_allocations`.

## B. Matrice des coûts : chaîne réelle, unité réelle et état actuel

| Étape | Coût | Unité d'engagement réelle | Clé causale | Prévision actuelle [CODE / DONNÉES] | Réel actuel | Classe | Source et confiance | Problème |
|---|---|---|---|---|---|---|---|---|
| Achat | prix fournisseur | ligne de PO, au taux réellement débité | direct | `cost_kmf` | achat réel (doctrine #3164) | N1 achat | catalogue | inconnu ≠ 0 non garanti |
| Achat | frais bancaires et conversion | règlement fournisseur | au prorata des lignes du règlement | 1,5 % du sous-total en cascade | — | N1 | default | assiette fausse ; la doctrine en fait une nature `payment` distincte |
| Achat | temps acheteur | PO ou temps passé | à la PO, pas à la commande client | 200 par commande ÷ 2,5 | — | N1 (ou N3 si salarié) | default, low | mauvaise unité ; doublon possible avec les salaires N3 |
| Fournisseur → Hub | **livraison fournisseur** | PO ou colis entrant KOM-IN | à la PO, réparti par poids ou valeur | **absente** | — | N1 | — | **omission** |
| Hub | contrôle, étiquetage | article (`per_item`) ou KOM-IN | unités traitées | 150 et 50 « par colis » ÷ 4 | — | N1 (ou N3 si Hub salarié) | default | unité contradictoire ; si le Hub est payé au mois, c'est un pool, pas un variable |
| Hub | Hub Dubaï (personnel, local) | mois | pool refacturé aux marchés | 400 KMF par mois dans `charges` ; 7 000 AED dans `finance_config`, non utilisé | `period_structure_not_allocated` | N3 pool | incohérent | **omission ou valeur fausse** |
| Hub | carton KOM-BOX | carton sortant | volume de la commande dans la box | 300 ÷ 4 | — | N1 | default | taille ignorée |
| Remise transitaire | honoraires | lot transitaire (`customs_shipment`) | facture → expédition, puis volume / poids / CIF | 3 % du coût en cascade | ventilation prête, **0 frais** | N1 | default | assiette arbitraire ; pas une douane |
| Transport | fret | expédition (m³ ou kg taxable) | volume ou poids taxable | **2 ×** 180 €/m³ | ventilation prête, 0 | N1 | default | **doublon** ; une seule route implicite |
| Transport | assurance | expédition, valeur CIF | CIF | 0,5 % du sous-total | — | N1 | default | assiette fausse (doit être la CIF) |
| Port / douane | inspection, portuaires | expédition | volume, poids ou CIF | 5 000 et 25 000 ÷ 200 | prêt, 0 | N1 | default | ÷ 200 sans volume ; l'inspection fait passer la douane à « estimée » |
| Port / douane | droits et taxes | expédition (quote-part) | CIF ou méthode typée | **non estimés**, mais statut `cost_component` | prêt, 0 | N1 | — | état masqué |
| Distribution | port → relais | trajet vers ville / zone / relais | colis ou volume | 500 par colis ÷ 4, **tous marchés** | — | N1 | default, Comores | valeur Comores appliquée à CM et CG |
| Distribution | inter-îles | trajet Grande Comore → Mohéli ou Anjouan | **relais de destination** | **les deux** appliqués à tout article, tous marchés | — | N1 | default | **charge indue** : +400 KMF par article |
| Relais | commission | unité ou commande (à décider, contrat relais) | contrat | 600 par commande ÷ 2,5 = 240 | 600 **par unité** (`allocate.js:399`) | N1 | default, sans provenance | unité divergente prévu / réel (×2,5) |
| Encaissement | Stripe | transaction, **% du prix** | prix encaissé | 1,5 % **du coût** et 130 par commande | — | N2 | tarif PSP (`QUOTED` possible) | assiette fausse |
| Encaissement | collecte cash | remise banque | par remise ou par commande | 200 ÷ 2,5 | — | N2 | default | — |
| Risque | non-collecte, casse | prix encaissé / valeur transportée | prix / CIF | 3 % du coût, **hors affichage** | 1 % du CA en réel | N2 | hypothèse | masqué ; bases prévu / réel différentes |
| Structure | salaires, loyer, SaaS | mois | couverture de période, attribution par marché | ÷ 100 commandes ÷ 2,5 = **5 008 par article** (> prix d'achat) | `market_cost_attributions` vide | N3 | hypothèse | ne pas présenter par SKU ; « Transit Comores par commande » rangé en N3 |

## C. Test sur un produit réel du staging [DONNÉES STAGING]

**Limite** : le staging ne contient pas de produit volumineux ni de produit « catalogue réel ». Les 79 produits actifs sont des fixtures (3 000 KMF, 1 kg, 1 000 cm³). Le test porte donc sur `E2E-HUB-V1-358C559A-PC`, passé par le **vrai moteur** (`pricing-engine.recommend` sur la base staging) pour GLOBAL, CG, CM et KM. Je n'ai fait varier le panier, le colis et l'expédition que par calcul ; les frais réels n'existent pas.

| Ligne (KM) | KMF | Frais engagé / unité / clé / dénominateur |
|---|---|---|
| Achat | 3 000 | `cost_kmf` |
| Frais bancaires | 65 | 1,5 % du sous-total, en cascade |
| Temps acheteur | 80 | 200 par commande ÷ 2,5 (hypothèse) |
| Contrôle et étiquetage Hub | 51 | 200 par colis ÷ 4 (hypothèse) |
| Carton | 75 | 300 par colis ÷ 4 (hypothèse) |
| Fret | 89 + **89** | 0,001 m³ × 180 € × taux, **compté deux fois** |
| Assurance | 17 | 0,5 % du sous-total |
| Inspection et portuaires | 25 + 125 | 30 000 par expédition ÷ 200 (hypothèse) |
| Transitaire | 122 | 3 % du sous-total |
| Port → relais | 125 | 500 par colis ÷ 4 |
| **Inter-îles Mohéli + Anjouan** | 225 + 200 | 800 par colis ÷ 4, **les deux, même en CG ou CM** |
| Commission relais | 240 | 600 par commande ÷ 2,5 (réel : 600 par unité) |
| **N1 affiché** | **4 526** | |
| N2 affiché (collecte cash) | 80 | risque affiché = 0 |
| N2 **masqué** (risque 3 %) | **96** | inclus dans le plancher, absent du détail |
| Coût variable affiché / **utilisé par le plancher** | 4 606 / **4 702** | **somme du détail ≠ total du plancher** |
| Plancher / référence | 5 990 / 6 990 | V × 1,10 ; V ÷ (1 − 30 %) |
| N3 « par article » | 5 008 | à présenter comme besoin de couverture collectif, pas par SKU |
| `health_status` | `strong` | sur 100 % d'estimations : **confiance fausse** |

**Constats supplémentaires du run :**
1. **Le résultat dépend de l'ordre des composants** [DONNÉES]. Mêmes composants, autre ordre de chargement : N1 vaut 4 465 en GLOBAL, 4 499 en CG/CM, 4 526 en KM. C'est l'effet de la cascade des pourcentages.
2. **Le moteur ne relaie pas le statut douane** : `customs_estimate_status` est `null` en sortie du moteur, alors que le CDR le calcule. L'Atelier ne peut donc pas afficher « douane non estimée ».

**Variation du regroupement**, avec le même seed actif et des montants mutualisés par article :
- 1 article par commande et par colis : 200 + 600 + 200 (commande), plus 300 + 200 + 500 + 1 600 (colis), soit environ **3 750 KMF de frais mutualisés pour un achat de 3 000**.
- Panier de 5 articles dans un colis : environ **870**.
- Le moteur actuel affiche environ **1 230**.
- La plage va donc **de 0,3 à 1,25 fois le prix d'achat**. Pour un catalogue dont l'achat médian est à 3 000 KMF, les diviseurs décident du prix.

## D. Contre-proposition sobre et non destructive

1. **Corriger d'abord ce qui est faux, à hypothèses constantes** : un seul fret ; somme du détail = total du plancher ; risque affiché ; inter-îles par relais de destination ; composants Comores limités à KM ; Stripe et risque de non-collecte en % **du prix** (résolution du plancher) ; assiettes % explicites (CIF, achat) au lieu de la cascade ; statut douane relayé ; `health_status` plafonné par la confiance des entrées.
2. **Un état par valeur** : `QUOTED` (tarif, devis, contrat), `MEASURED` (factures et volumes observés), `ESTIMATED`, `UNKNOWN`. Le prix reste fixable par un humain avec des `QUOTED` sans attendre la première expédition. Sans `QUOTED` ni `MEASURED` sur un poste lourd (fret, transitaire), le chiffre est marqué **à valider** et non décisionnel. Le démarrage commercial n'est pas bloqué, conformément à #3164 : le choix du prix reste humain et par marché.
3. **Des unités réelles au lieu des diviseurs** :
   - frais d'expédition → coût au m³ ou au kg taxable par corridor : tarif (`QUOTED`), puis Σ factures ÷ Σ volume (`MEASURED`) ;
   - colis → part au volume ;
   - commande → plancher affiché en **mono-article** et en **panier médian observé**, sans 2,5 ;
   - PO → temps acheteur et livraison fournisseur au niveau de la PO ;
   - 200 / 4 / 2,5 ne servent plus de repli.
4. **Prévu et réel avec les mêmes clés** : la ventilation réelle existante (`transport-cost-allocation`) sert de référence. La commission relais est alignée sur l'unité du contrat.
5. **Structure** :
   - les charges `per_order` (« Transit Comores ») passent en N2 ou N1 ;
   - les cinq lignes historiques `cost_fixed_*` sont requalifiées ou retirées ;
   - le Hub devient un pool de période refacturé aux marchés, avec une clé à décider, **sans entrer dans le plancher SKU** ;
   - la N3 reste une couverture collective par marché.

## Arbitrages pour le propriétaire

1. **Commission relais** : par unité ou par commande ? Le contrat relais tranche.
2. **Clé par défaut des frais d'expédition** : volume, poids taxable ou CIF, éventuellement par nature de frais.
3. **Transitaire** : forfait par lot ou % CIF, selon le premier devis réel.
4. **Hub Dubaï** : montant réel mensuel, et clé de refacturation entre marchés.
5. **Plancher de référence** : mono-article ou panier médian observé (les deux affichés).
6. **Composants Comores** (port → relais, inter-îles) : valeurs CM et CG à fournir, sinon `UNKNOWN`.
7. **Marge de sécurité de 10 %** et marge cible de 40 % : à confirmer ou à remplacer par une décision marché.

## PR proposées (aucune lancée sans ton GO)

| PR | Contenu | Tests |
|---|---|---|
| **P0-1** | Exactitude à hypothèses constantes : fret unique, somme du détail = plancher, risque affiché, assiettes % explicites, Stripe et non-collecte sur le prix, statut douane relayé, confiance plafonnée. Aucune donnée modifiée. | unitaires (somme du détail = plancher ; pas de doublon fret ; indépendance à l'ordre) ; Chromium Atelier (détail affiché = plancher) |
| **P0-2** | Périmètre : inter-îles selon le relais de destination, composants Comores limités à KM, catégorie absente → `UNKNOWN` au lieu de `phones`. | unitaires et PostgreSQL (CG ou CM ne porte aucun inter-îles) |
| **P1-1** | États `QUOTED` / `MEASURED` / `ESTIMATED` / `UNKNOWN` et provenance par composant ; Atelier non décisionnel quand un poste lourd est inconnu. | unitaires, PostgreSQL, Chromium |
| **P1-2** | Clés physiques par corridor (m³, kg taxable), plancher mono-article et panier observé, retrait des replis 200 / 4 / 2,5, commission relais à unité unique. | PostgreSQL (expédition de test multi-colis, prévu = ventilation réelle au même tarif) |
| **P1-3** | Atelier : statut et écart calculés par le moteur doctrinal, plus de repli silencieux vers l'ancien calcul, pagination au-delà de 200. | Chromium |
| **P2** | Requalification des charges historiques, pool Hub par marché, retrait des colonnes `finance_config` en doublon. | PostgreSQL et shadow |

**Méthode de bascule** : calcul shadow en parallèle de l'actuel, rapport prévu / réel par expédition dès les premières factures, aucun prix catalogue modifié automatiquement, GO humain explicite.

## Reproduire le recensement

Pousser sur `research/economic-staging-readonly-census` relance le run. L'artefact `economic-staging-readonly-<run_id>` contient `census.json` : configuration, volumes, frais, allocations et sorties du moteur.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi

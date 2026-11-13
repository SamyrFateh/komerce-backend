# Prix plancher prévisionnel avant toute expédition : doctrine et démonstration

Komerce, complément à l'audit N1/N2/N3 et à la contre-expertise #3830. 11 novembre 2026, en lecture seule : aucun prix, aucune configuration ni donnée modifiés. Les corrections P0-1 et P0-2 confiées à Sonnet restent un chantier distinct et leur périmètre n'est pas élargi.

**Calcul reproductible** : `plancher_previsionnel.py`, livré avec ce document (`python3 -I plancher_previsionnel.py`).

---

## Réponse à la question finale

Komerce peut calculer dès aujourd'hui un plancher utilisable, à trois conditions :

1. **Calculer chaque coût à partir de son vrai déclencheur**, c'est-à-dire le volume, le poids, la valeur CIF, la commande ou la PO, et le tarif qui s'y applique. On n'utilise plus de nombre moyen d'articles. Les seuls coûts qui doivent vraiment être mutualisés sont les forfaits de lot. Pour eux, on prend le **volume de lot prévu**. C'est une décision de planification explicite et vérifiable, pas une moyenne inventée.
2. **Donner trois valeurs (favorable, centrale, défavorable) à chaque hypothèse**, avec sa provenance et sa date de validité. Le plancher sort alors en trois scénarios. Le scénario défavorable remplace la marge de sécurité forfaitaire de 10 %.
3. **Juger un prix commercial par sa robustesse face aux scénarios.** On ne cherche pas à prouver l'exactitude d'un chiffre unique, on regarde si le prix tient dans les trois scénarios. On ne bloque que lorsqu'un scénario est impossible à calculer, c'est-à-dire quand l'incertitude n'est pas bornée.

La précision s'améliore ensuite en remplaçant les hypothèses par des devis, puis par des coûts réels mesurés avec les mêmes clés. La démonstration montre aussi **quel devis obtenir en premier** : celui qui fait le plus bouger le plancher.

---

## Livrable 1 — Doctrine

### 1.1 Trois prix distincts

| Notion | Définition | Qui la fixe |
|---|---|---|
| **Seuil de couverture variable P0** | Prix sous lequel la vente ne couvre plus ses coûts variables imputables (N1 + N2 + risque) | Calcul |
| **Plancher prudent** | P0 calculé dans le scénario défavorable | Calcul |
| **Prix commercial** | Prix choisi par marché (concurrence, valeur perçue, politique) | Humain (#3164) |

**Contribution = prix commercial − (N1 + N2 + risque).** Elle couvre la N3, puis forme le bénéfice. La N3 n'entre jamais dans P0.

### 1.2 Hiérarchie des preuves, pour chaque composante

| Niveau | Source | Exemple | Statut |
|---|---|---|---|
| 1 | Contrat, prix fournisseur, parité réglementaire | prix fournisseur, livraison affichée par le fournisseur, EUR/KMF | `CONTRACT` |
| 2 | Devis écrit exploitable | devis transitaire (forfait par lot, €/m³, minimum) | `QUOTED` |
| 3 | Tarif public vérifiable | taux de droits par code SH, tarif Stripe | `TARIFF` |
| 4 | Estimation technique (caractéristiques du produit et parcours) | carton au volume, poids taxable | `ESTIMATED_TECH` |
| 5 | Hypothèse opérationnelle justifiée, avec une plage | volume de lot prévu, taux de casse | `ASSUMED` |
| 6 | Inconnu, sans borne défendable | corridor sans route ni tarif | `UNKNOWN` |

Chaque valeur porte son niveau, sa source, sa date, sa date d'expiration et son triplet (favorable, central, défavorable). **Un inconnu n'est jamais remplacé par zéro.**

### 1.3 N1 : achat et coût rendu relais

| Coût | Déclencheur | Assiette | Unité facturée | Prévision | Clé | Données nécessaires |
|---|---|---|---|---|---|---|
| Prix fournisseur | ligne de PO | — | article | prix fournisseur × taux de l'autorité FX | direct | prix, devise |
| Paiement et conversion fournisseur | règlement | montant de l'achat | règlement | % de l'achat (tarif bancaire) | au prorata des lignes | tarif banque ou PSP |
| Livraison fournisseur → Hub | expédition du fournisseur | — | commande fournisseur ou article | tarif affiché par le fournisseur | direct, ou au prorata de la PO | tarif du fournisseur |
| Opérations Hub variables | réception, étiquetage | — | article | consommables par article | direct | coût des consommables |
| Personnel et local Hub | mois | — | période | **N3 (pool)**, jamais N1 | refacturation par marché | coût mensuel |
| Carton KOM-BOX | emballage sortant | volume | carton | prix du carton × volume ÷ volume utile | au volume | carton, volume utile |
| Fret | trajet du lot | m³ ou kg taxable | lot | v × τ_eff, avec τ_eff = τ × max(1, minimum ÷ V_lot) | au volume (ou au poids taxable en aérien) | devis €/m³, minimum, V_lot |
| Transitaire, port, inspection | lot | — | lot | v × forfait ÷ V_lot | au volume | devis du forfait |
| Assurance | lot | CIF | lot | % × CIF | à la CIF | taux |
| Droits et taxes | importation | CIF (ou règle locale) | lot | % code SH × CIF | à la CIF | tarif douanier |
| Port → relais | livraison | — | commande ou tournée | tarif par commande et par zone | direct | tarif local |
| Inter-îles | relais de destination | — | commande | seulement si le relais est sur Mohéli ou Anjouan | direct | relais |

**Pourquoi ne pas mutualiser.** Le fret, l'assurance et les droits se calculent **directement** à partir du produit (volume, valeur) et d'un tarif. Les mutualiser par un nombre d'articles détruit l'information.

**Le seul vrai coût de groupage, c'est le forfait de lot et le minimum facturable.** On le ramène au m³ par le volume de lot **prévu** `V_lot`. C'est une décision : « on expédie au moins X m³ par lot sur ce corridor ». L'effet d'un lot sous-rempli apparaît dans le scénario défavorable (`V_lot` réduit, minimum facturable atteint).

### 1.4 N2 : frais variables commerciaux

| Coût | Déclencheur | Assiette | Règle |
|---|---|---|---|
| Stripe | transaction | **prix encaissé** + fixe | `ρ` (% du prix) et un fixe par commande |
| Collecte cash | remise à la banque | — | fixe par commande ou par remise |
| Commission relais | **selon le contrat** (unité, commande, remise) | — | **arbitrage à trancher** ; la démonstration utilise 600 par commande comme hypothèse |
| Casse et perte | transport | coût exposé (N1) | `p_casse × N1`, et **pas** un % du prix |
| Non-retrait | colis non retiré | coûts aval perdus (dernier km + commission) | `p_nr × (aval)` |

### 1.5 La formule

```
P0 = ( Achat × (1 + f)  +  L_unitaire  +  T ÷ q  +  R ) ÷ ( 1 − Σρ )

  L_unitaire = livraison fournisseur + consommables Hub + carton × v/v_carton
             + v × τ × max(1, M/V_lot) × taux + v × F_lot/V_lot + (a + d) × CIF
  T          = coûts par transaction (dernier km, collecte ou fixe Stripe, commission si « par commande »)
  q          = unités dans la commande ; plancher de référence = 1 (mono-article, prudent)
  R          = p_casse × N1 + p_nr × (dernier km + commission)
  Σρ         = taux proportionnels au prix (Stripe %, …)
```

- La résolution est algébrique, sans circularité.
- Les % appliqués à l'achat ou à la CIF ne sont **pas** en cascade.
- **Plancher prudent** = P0 avec le triplet défavorable. C'est une réserve explicite et justifiée composante par composante, ce qui remplace les 10 %.
- **Prix cible de rentabilité** (information seulement) : le prix tel que la contribution × le volume prévu couvre la N3 du marché. Ce n'est ni un plancher ni un prix imposé.

---

## Livrable 2 — Modèle démontré (corridor KM, sans historique)

**Les hypothèses**, toutes de niveau 5 sauf mention, à remplacer par des devis :

| Paramètre | Favorable / central / défavorable | Remplacé par |
|---|---|---|
| Fret | 150 / 180 / 250 €/m³, minimum 1 m³ | devis transitaire |
| Volume de lot prévu `V_lot` | 5 / 3 / 1,5 m³ | décision de planification |
| Forfait de lot (transitaire, port, inspection) | 80 000 / 110 000 / 150 000 KMF | devis transitaire |
| Droits et taxes | 0 / 20 / 42 % CIF | taux du code SH (niveau 3) |
| Dernier km | 400 / 500 / 700 KMF par commande | tarif local |
| Casse | 0,5 / 1 / 3 % N1 | mesure après les premiers lots |
| Non-retrait | 2 / 5 / 10 % | mesure après les premiers lots |

Valeurs fixes : EUR = 491,96 KMF (niveau 1), consommables Hub 50, carton 300 KMF pour 0,04 m³ utile.

### Exemple complet : accessoire léger (8 €, 0,15 kg, 0,0008 m³), canal cash

| # | Ligne | KMF | Formule | Source |
|---|---|---|---|---|
| 1 | Achat | 3 936 | 8 € × 491,96 | niveau 1 |
| 1b | Frais bancaires | 59 | 1,5 % de l'achat | niveau 5 |
| 2 | Livraison fournisseur → Hub | 738 | 1,5 € affiché | niveau 1-2 |
| 3 | Hub : consommables et carton | 50 + 6 | 300 × 0,0008 ÷ 0,04 | niveau 5 |
| 4 | Fret | 71 | 0,0008 m³ × 180 € × 491,96 | niveau 5 → devis |
| 4b | Forfait de lot | 29 | 110 000 × 0,0008 ÷ 3 | niveau 5 → devis |
| 4c | Assurance et droits | 24 + 949 | 0,5 % et 20 % de la CIF (4 745) | niveau 5, puis 3 |
| 4d | Port → relais | 500 | par commande | niveau 5 |
| 5 | **N1** | **6 361** | Σ | — |
| 6 | N2 (collecte cash et commission relais) | 800 | par commande, q = 1 | contrat à confirmer |
| 6b | Risque | 119 | 1 % × N1 + 5 % × (500 + 600) | niveau 5 |
| 7 | **P0 central** | **7 280** | (6 361 + 800 + 119) ÷ (1 − 0) | — |
| 8 | **Plancher prudent (défavorable)** | **8 909** | même formule, triplet défavorable | — |
| 9 | Contribution à 7 500 / 9 000 / 12 000 | 220 / 1 720 / 4 720 | P − P0 central | — |
| 10 | Couverture N3 KM par vente | 0,010 / 0,080 / 0,221 % | contribution ÷ 2 138 000 | période |

### Les quatre produits comparés

| Produit | N1 central | P0 favorable | **P0 central** | **Plancher prudent** | Incertitudes dominantes (écart du plancher) |
|---|---|---|---|---|---|
| Accessoire léger importé (8 €) | 6 361 | 6 100 | **7 280** | **8 909** | droits +1 054 ; dernier km +212 ; casse +127 |
| Article volumineux importé (25 €, 0,06 m³) | 26 978 | 21 609 | **28 103** | **40 556** | droits +4 351 ; fret +2 515 ; volume de lot +2 222 |
| Smartphone importé (120 €) | 74 578 | 63 119 | **76 178** | **92 205** | droits +13 475 ; casse +1 492 |
| Accessoire en stock local (5 000 KMF) | 5 500 | 6 247 | **6 410** | **6 801** | dernier km +212 |

**Verdicts aux prix testés :**

| Produit | Prix testés et verdicts |
|---|---|
| Accessoire léger | 7 500 sensible ; 9 000 et 12 000 robustes |
| Volumineux | 22 000 et 27 000 destructifs au central ; 32 000 sensible |
| Smartphone | 75 000 destructif ; 85 000 sensible ; 95 000 robuste |
| Stock local | 7 500, 9 000 et 12 000 robustes |

**Ce que montrent les chiffres :**

1. **Les diviseurs n'étaient pas le problème principal. Les omissions l'étaient.** Sur l'accessoire léger, le fret et le forfait de lot calculés au volume ne pèsent que 100 KMF. Les vrais poids sont la **livraison fournisseur (738)**, les **droits (949)** et le **dernier km par commande (500)**. Le moteur actuel n'a aucune ligne pour les deux premiers.
2. **Les droits dominent l'incertitude sur tous les produits importés.** Le premier document à obtenir est donc le taux de droits par code SH des catégories du catalogue. Viennent ensuite le devis transitaire et la planification des lots pour les produits volumineux.
3. **Les produits volumineux sont les plus sensibles au remplissage des lots** (+2 222 KMF si `V_lot` passe de 3 à 1,5 m³). Cet effet est visible et explicable, contrairement à « ÷ 200 ».
4. **Le stock local est robuste**, car il porte peu d'incertitude.
5. **Regrouper améliore la contribution, sans abaisser le plancher.** Dans un panier de 3 articles, le coût variable de l'accessoire passe de 7 280 à 6 413. On l'affiche à titre d'information ; le plancher de référence reste le mono-article.
6. **N3 KM** = 1 200 000 de charges + 7 000 AED de Hub (≈ 938 000) = **2,14 M KMF par mois**. Avec une contribution moyenne de 2 000 KMF par vente, il faut **≈ 1 070 ventes par mois** pour couvrir la structure. Ce chiffre de pilotage compte davantage que n'importe quelle N3 par article.

---

## Livrable 3 — Politique d'incertitude

### Verdict d'un prix commercial, sans seuil arbitraire

| Situation | Verdict | Effet |
|---|---|---|
| P ≥ plancher prudent | **ROBUSTE** | publiable sur décision humaine |
| P0 central ≤ P < plancher prudent | **SENSIBLE** | publiable avec validation humaine explicite et motif ; l'écran liste les hypothèses dominantes à confirmer par devis |
| P0 favorable ≤ P < P0 central | **DESTRUCTIF au central** | refusé, sauf décision promotionnelle explicite (durée et volume bornés) |
| P < P0 favorable | **DESTRUCTIF** | refusé |

### Statut du plancher

| Statut | Condition | Effet |
|---|---|---|
| **EXPLOITABLE** | Les composantes qui peuvent faire basculer le verdict sont de niveau 1 à 3 | décision normale |
| **PROVISOIRE** | Au moins une composante qui fait basculer le verdict est de niveau 4 ou 5, mais bornée | décision possible sous validation humaine ; réexamen au premier lot ou à l'expiration de l'hypothèse |
| **NON DÉCISIONNEL** | Un scénario est impossible à calculer | blocage |

« Faire basculer le verdict » se mesure directement : on passe cette seule hypothèse en défavorable, et on regarde si le verdict change. Il n'y a donc aucun seuil en %.

**Les seuls blocages réels** :
- prix fournisseur inconnu ;
- produit importé sans poids ni volume, et sans plage technique acceptée par catégorie ;
- corridor sans route définie (aucun tarif ni plage bornée, par exemple CM ou CG aujourd'hui) ;
- droits sans taux ni plage ;
- **hypothèse expirée**, qui fait repasser le plancher en PROVISOIRE.

Tout le reste se décide sous contrôle humain.

**Avant d'ouvrir un corridor, il faut** : un devis transitaire (forfait de lot, €/m³, minimum), le tarif douanier des catégories, le contrat relais, le tarif du dernier km et une décision de volume de lot. **Pour chaque produit** : prix, livraison fournisseur, poids, volume et code SH ou catégorie.

---

## Livrable 4 — Comparaison avec le moteur actuel

| Élément | Décision | Pourquoi |
|---|---|---|
| Table `cost_components`, surcharges par marché, autorité FX | **Conserver** | bonne base ; ajouter niveau de preuve, déclencheur, assiette, triplet et validité |
| Ventilation réelle (`transport-cost-allocation`, douane par expédition) | **Conserver** | utilise déjà le volume, le poids et la CIF : c'est la clé commune prévision / réel |
| `LOCAL_STOCK`, `NOT_DECISIONAL`, marge réelle en shadow | **Conserver** | concepts justes |
| Doublons, cascade de %, masquage, statut douane, périmètre Comores | **Corriger** | P0-1 et P0-2 (Sonnet), déjà engagés |
| Diviseurs 200 / 4 / 2,5 | **Remplacer** | calcul direct au volume ou à la CIF ; forfait de lot ÷ `V_lot` prévu ; plancher mono-article |
| Marge de sécurité de 10 % | **Remplacer** | plancher prudent = scénario défavorable |
| Prix de référence = V ÷ (1 − marge) | **Retirer comme prix** | le prix est une décision de marché ; on garde au plus un repère |
| N3 par article dans le CDR et le snapshot | **Retirer du plancher** | couverture de période par marché ; part analytique seulement en information |
| Personnel Hub en composant N1 | **Reclasser en N3** | évite la double imputation N1 / N3 |
| Livraison fournisseur, droits | **Ajouter** | omissions majeures prouvées par la démonstration |
| `health_status` | **Remplacer** | verdict de robustesse et statut du plancher |

Il n'y a pas de rupture d'architecture : les tables, l'Atelier et les flux restent en place. On change les **règles de calcul** et les **métadonnées** des composants.

---

## Livrable 5 — Méthode de recalibrage

1. **Figer la prévision au moment de la décision.** Chaque décision de prix enregistre la version des paramètres, les valeurs, les niveaux de preuve, le triplet, les dates de validité, P0, le plancher prudent et le verdict. Ce snapshot est immuable. Il existe déjà en partie (snapshot de commande, imputations).
2. **Mesurer le réel avec les mêmes clés.** À la clôture d'un lot, on calcule :
   - le τ effectif (facture fret ÷ m³ expédiés) ;
   - le `V_lot` réel ;
   - le forfait réel ;
   - le taux de droits effectif (droits payés ÷ CIF) ;
   - le dernier km réel.

   Plus tard, on mesure aussi la casse et le non-retrait observés.
3. **Calculer l'écart par composante** entre la prévision figée et le réel, avec sa justification : volume de lot plus faible, tarif différent, reclassement douanier.
4. **Recalibrer.** Une nouvelle version de paramètre est proposée, avec son niveau de preuve (`MEASURED`), puis validée par un humain. Elle s'applique aux **décisions suivantes** et ne réécrit **jamais** une décision passée.
5. **Alerter, sans action automatique.** Si le réel dépasse le scénario défavorable, ou si un prix publié bascule de ROBUSTE à SENSIBLE ou DESTRUCTIF, une revue humaine est proposée. Aucun prix publié n'est modifié automatiquement.

---

## Arbitrages qui te reviennent

1. **Droits en prévision.** La doctrine actuelle neutralise les taux théoriques dans le calcul économique. Pour un plancher **avant vente**, les ignorer sous-estime le plancher : jusqu'à 13 000 KMF sur un smartphone. Je propose que les droits soient **une plage prévisionnelle issue du tarif douanier** (niveau 3), jamais présentée comme un coût réel. Le réel reste ventilé par expédition.
2. **Commission relais** : par unité, par commande ou par remise (contrat).
3. **Volume de lot prévu** par corridor : c'est une décision de planification.
4. **Plancher de référence** : mono-article (proposé), avec le panier affiché à titre d'information.
5. **Clé de refacturation du pool Hub** entre marchés (volume traité ou unités).
6. **Validité des hypothèses** : durée par défaut avant réexamen.

L'implémentation de cette doctrine n'est pas lancée : elle attend ta validation de la méthode.

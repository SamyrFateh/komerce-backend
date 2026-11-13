# Brief Fable : contre-expertise du moteur économique N1/N2/N3 et du prix plancher

**Mode ÉCO « super héros »** : rigueur maximale et tokens minimum. Lis seulement le code qui porte la preuve (`git grep`, puis lecture ciblée par plage de lignes), jamais un fichier entier par réflexe. Pas de reformulation de ce brief ni de narration : seulement des constats prouvés, triés et actionnables. Arrête-toi dès que le rendu est complet.

**Mode** : lecture seule. Aucun test, workflow, modification de code ni écriture. Toute affirmation est prouvée par `fichier:ligne` sur `main`, ou par un calcul reproductible.

## Contexte
- **Doctrine du propriétaire** :
  - N1 : coût de revient rendu au relais.
  - N2 : coûts variables de l'activité.
  - N3 : structure de la période, jamais une dette par SKU.
  - EUR comme pivot, `currency_parities` comme autorité FX unique, prix décidés dans la devise du marché (KMF pour KM, XAF pour CM et CG).
- **Prix plancher prévisionnel** :
  - clés physiques (m³, CIF) ;
  - volume de lot prévu `V_lot` ;
  - triplet favorable / central / défavorable ; le plancher prudent est le scénario défavorable ;
  - verdicts ROBUSTE, SENSIBLE ou DESTRUCTIF ;
  - formule `P0 = (Achat×(1+f) + L + T/q + R)/(1−Σρ)`.
- **À lire d'abord** (dossier `docs/recette/handoff-opus-20261113/economie/` sur la branche `handoff/opus-pre-e2e-20261113`) :
  - `MOTEUR_ECONOMIQUE_N1_N2_N3_CONSTATS.md` : audit contradictoire antérieur, défauts déjà corrigés par #3832 et #3833 ;
  - `DOCTRINE_PLANCHER_PREVISIONNEL.md` et `plancher_previsionnel.py` ;
  - issue #3830 et ses commentaires (contre-expertise sur données réelles du staging) ;
  - #3835 (plancher à 3 scénarios dans l'Atelier, fusionné mais jamais revu).
- **Code** : `services/pricing-cdr.js` (computeCDR), `pricing-engine.js`, `pricing-output.js`, `pricing-recommend.js`, `services/transport-cost-allocation.js`, `services/cost-allocation/allocate.js`, `services/fx-authority.js`, ainsi que les routes `admin-pricing-workspace`.

## Mission
1. **Conformité du code à la doctrine.** Vérifie que le code respecte N1/N2/N3 et la formule du plancher, notamment :
   - pas de double fret ;
   - pas de risque caché ;
   - pas de pourcentages en cascade ;
   - pas de composante comorienne appliquée à CM ou CG ;
   - N3 jamais imputé à un SKU ;
   - conversions uniquement via `fx-authority`.
2. **Revue de #3835** : le plancher à 3 scénarios dans l'Atelier est-il calculé, affiché et appliqué selon la doctrine ? Le verdict ROBUSTE / SENSIBLE / DESTRUCTIF est-il juste ?
3. **Cas extrêmes**, chiffrés pour KM, CM et CG :
   - premier lot de très petit volume (quote-part de transport T/q) ;
   - fret très cher ;
   - devise faible ;
   - taux de retour élevé ;
   - produit léger mais volumineux ;
   - produit manuel du Fournisseur central ;
   - stock local.

   Dis où le plancher devient faux, instable ou destructif.
4. **Écarts entre prévu et réel** : l'achat confirmé (L5, vendeur réel, décision d'écart), la douane réelle et le fret réel se réconcilient-ils correctement avec le prix vendu, sans réécrire les snapshots de la commande ?
5. **Ambiguïtés de doctrine** : liste-les sans les trancher. Points connus : droits de douane dans le prévisionnel, unité de la commission relais, volume de lot, plancher de référence, clé du pool Hub, validité des hypothèses.

## Rendu
Publie dans une **nouvelle issue** « Contre-expertise Fable : moteur économique ».
- Un tableau des constats : `ID | Règle de doctrine | Écart | Preuve (fichier:ligne ou calcul) | Impact chiffré | Correctif minimal | Scénario #3944 concerné`.
- Les cas extrêmes chiffrés.
- Les ambiguïtés à faire trancher par le propriétaire.

Ne crée aucune doctrine nouvelle. Mode économe.

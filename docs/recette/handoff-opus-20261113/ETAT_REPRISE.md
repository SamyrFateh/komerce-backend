# Reprise Opus : certification pré-E2E G6 (revu le 13/11/2026 — états GitHub H1–H4)

Point de départ pour tout agent qui reprend après une coupure. Fil de coordination : issue **#3927**. Matrice commune : PR draft **#3944**, branche `docs/g6-matrix-v2`.

## Décisions du propriétaire en vigueur
- **Double exécution indépendante** : GPT et Opus jouent les mêmes 46 scénarios, sur KM, CM et CG, avec le multi-sourcing CJ + AliExpress + Hub central, la même version applicative et les mêmes assertions. Les données sont distinctes : cohorte GPT-G6 d'un côté, CLAUDE-PAR de l'autre. Un PASS chez l'un et un FAIL chez l'autre est une ANOMALIE.
- **Validation** : Chromium + HTTP + PostgreSQL en lecture seule. **Aucun E2E G6 sans le « GO E2E » explicite du propriétaire, qui n'est pas encore donné.**
- **Stock local W3** : seul le responsable pays déclare et expose. Le stock est un pool par marché, avec le relais tracé dans l'audit.
- **Catalogue pays** : URL publiques `/KM`, `/CM` et `/CG` (#3980, fusionné).
- **Revue visuelle des images par agent** : `AUTOMATED_STAGING` seulement, jamais `HUMAN`. Les fiches FR sont rédigées par l'agent et saisies via `override`.
- **Arbitrages A1 à A8, A2-bis et A2-ter** : #3927, commentaire 6828953843.

## Cohorte CLAUDE-PAR (staging)
- **Comptes** : `claude-par-*` (KM et rôles globaux) et `claude-par-{cm,cg}-*`. Les identifiants sont chiffrés hors dépôt, dans le scratchpad Opus (`claude-par-keys/creds*.json`). Ils ne sont jamais committés. En cas de perte, il faut reprovisionner via les workflows de la branche `cert/claude-par-accounts`.
- **Relais** : `CLAUDE-PAR Relais KM`, `CLAUDE-PAR Relais CM`, `CLAUDE-PAR Relais CG`.
- **Catalogue** (#3927, commentaires 6846833004, 6848752785 et 6848772663) :

| Produit | Source | Mode |
|---|---|---|
| KPR-000144 | CJ | import |
| KPR-000164 | AliExpress | import |
| KPR-000163 | Hub central, manuel | import |
| KPR-000124 | AliExpress | stock local (6) |
| KPR-000162 | Hub central, manuel | stock local (5) |

  KPR-000141 est désactivé.
- **Marqueurs** : `CLAUDE-PAR-20261111` et `CLAUDE-PAR-20261113`.

## Lots de code
| Lot | PR | État |
|---|---|---|
| L1 à L7, #3951, W1 à W3, R1 à R6 (#3981 à #3986) | fusionnés | sur le staging (`589d81d88` vérifié) |
| H1 : avancement automatique (HB-01, HB-02, HB-03), incident `supplier_shortage`, remboursement admin | #4001 | **draft, Required verdict ROUGE** : job PostgreSQL/intégration/E2E API échoué ; 1 test sur 162 en échec, `relation "incidents" does not exist` dans `purchase-lines-engagement-postgres` |
| H2 : verrou de commande dans `distributeOrder` (HB-04) | #4000 | **draft, Required verdict VERT** : CI PG16/intégration/E2E API verte ; test dédié de concurrence réelle à confirmer |
| H3 : quantités (HB-05, HB-06, HB-07, HB-11) | #4003 | **draft, Required verdict ROUGE** : job PostgreSQL/intégration/E2E API échoué ; 13 tests sur 162 en échec, `function purchase_line_received_quantity(unknown) does not exist` ; migration 414 / montage du schéma à diagnostiquer |
| H4 : vue directrice tous marchés, ancienneté, alerte 48 h (HB-08), décision 4 | #4002 | **draft, Required verdict VERT**, PG16/intégration/dashboard verts ; API multi-marchés présente mais **UI directrice non raccordée** (`/api/hub/director-todo`) |

### Revue croisée GitHub (13/11) — points restant à lever

- [H1 #4001](https://github.com/SamyrFateh/komerce-backend/pull/4001) : [Required verdict rouge, run 43452768908](https://github.com/SamyrFateh/komerce-backend/actions/runs/43452768908). Le test d'intégration `purchase-lines-engagement-postgres` échoue sur `relation "incidents" does not exist`. Examiner uniquement le montage de schéma/test avant de conclure à un défaut métier ; ne pas élargir le correctif sans preuve.
- [H2 #4000](https://github.com/SamyrFateh/komerce-backend/pull/4000) : [Required verdict vert, run 43451497471](https://github.com/SamyrFateh/komerce-backend/actions/runs/43451497471). Conserver la preuve de contention de deux répartitions sur une même commande à rejouer en PostgreSQL réel, malgré l'index unique existant.
- [H3 #4003](https://github.com/SamyrFateh/komerce-backend/pull/4003) : [Required verdict rouge, run 43455000959](https://github.com/SamyrFateh/komerce-backend/actions/runs/43455000959). `purchase-lines-engagement-postgres` échoue sur `purchase_line_received_quantity(unknown) does not exist` ; distinguer une migration 414 non chargée d'un défaut de résolution SQL. Les 13 échecs se concentrent dans cette suite, d'autres fichiers du même lot sont marqués non prouvés par sortie non nulle. Rejouer M06 sur produit manuel Hub central avec SKU.
- [H4 #4002](https://github.com/SamyrFateh/komerce-backend/pull/4002) : [Required verdict vert, run 43452050028](https://github.com/SamyrFateh/komerce-backend/actions/runs/43452050028) ; `GET /api/hub/director-todo` fournit le multi-marchés, mais l'écran existant n'utilise pas encore cette vue (la PR l'indique elle-même). **Décision 6 non certifiable en vrai Chromium tant que ce raccordement n'est pas fait.** À faire sans créer de second dashboard.
- Les quatre PR sont **ouvertes et en draft, non fusionnées**. Elles se recouvrent sur `purchasing-engagement-service.js` (H1/H3/H4) et `auto-parcel.js` (H1/H2). Rebaser et contrôler la CI sur les **têtes actualisées** avant chaque fusion ; aucun verdict vert antérieur ne vaut pour une tête modifiée.
- **STOP E2E G6** jusqu'au GO explicite du propriétaire, puis deux campagnes indépendantes GPT/Opus sur la même version de staging. Ne pas confondre tests unitaires/preflight, CI PR et validation métier Chromium + HTTP + PostgreSQL. Aucun paiement ou notification réels.

**Fusion groupée H1 à H4** : à faire quand tout est vert et qu'aucun run `staging`, `chromium` ou `g6` n'est actif. Modèle de boucle : `scripts/merge-list.sh <PR...>`. Elle sort les PR du brouillon via `POST /pulls/{n}/ccr/ready_for_review`, fait update-branch, attend `clean`, fusionne en squash et contrôle `merged=true`. **Dans le même créneau**, activer `E7_ITEM_RESERVATIONS_ENABLED=1` sur le staging Railway (décision du propriétaire du 13/11). Cela redémarre le service.

**Audits Fable** : #3987 (flux d'argent), #3988 (moteur économique), #3998 (Hub). Les décisions 1 à 7 du propriétaire sur #3998 figurent dans le commentaire 6857010399. Les invariants SQL H1 à H9 de #3998 sont à ajouter aux contrôles PostgreSQL des deux campagnes E2E.

## Défauts consignés, non corrigés
- **Catalogue** (#3927) :
  - D1 : `import-now` CJ répond 500 alors que l'import réussit ;
  - D2 : `option_values` null contre `{}` ;
  - D3 : un produit reste invisible sans `product_suppliers` ;
  - D4 : aucun marqueur sur les candidats ;
  - D5 : import manuel sans `stock_available`, et le réimport repasse en WATCH ;
  - D6 : plafond de 120 produits actifs ;
  - D7 : revue visuelle impossible en WATCH, avec doublons à la promotion ;
  - D8 : la réactivation exige un `price_kmf` global supérieur à 0.
- **Passe #3900** (#3900, commentaire 6848393664) : D4, le dossier douane qui présélectionne les colis du marché, est déjà corrigé par #3887 et doit être revérifié.

## Prochaines étapes
1. **Seconde passe #3900** (`briefs/BRIEF_3900_PASSE2.md`), en cours en KM sur `589d81d88`. Elle couvre les 12 points : 3 sources, R4, R6, R1, R2, R3, retrait partiel, timeout et panne réseau, R5 sur KC692IV, encaissement, SAV.
2. **Lever les rouges H1 (#4001) et H3 (#4003)** ; raccorder la vue multi-marchés H4 au cockpit, rejouer migration 414/PG16 et M06 ; H2/H4 restent verts uniquement sur leurs têtes actuelles. Ensuite H1 à H4 au vert sur têtes réconciliées, fusion groupée et activation de E7 sur staging **après** la seconde passe #3900, puis **revérification Hub ciblée** : invariants H1 à H9, complétude automatique, rupture -> incident -> réservation admin -> remboursement de ligne, quarantaine, vue directrice en Chromium.
3. Mettre à jour la matrice #3944 : ajouter les invariants H1 à H9 de #3998 aux oracles, et créer les scénarios « rupture définitive » et « colis arrivé non rapproché ».
4. Si tout est PASS : demander au propriétaire le **GO E2E G6 final, qui n'est pas encore donné**. Ensuite, 46 scénarios sur KM puis CM et CG, avec les fixtures de cas limites (prix inactif, exposition coupée, stock à 0, au moins 2 variantes).
5. **Après les E2E** : supprimer les routes historiques de colis (HB-09) et le code mort de réception (HB-10).

## Contenu de ce dossier
- `briefs/` : tous les briefs Opus, Sonnet et Fable, et les plans, dont `BRIEF_3900_PASSE2.md`, `BRIEF_CORRECTIONS_3900_R2.md` et `BRIEF_CORRECTIONS_HUB_FABLE.md`.
- `scripts/` : helpers Chromium (`parcours-km`, `catalogue-ms`, `par3900`), boucles de fusion, consigne d’alignement GPT (`scripts/ALIGNEMENT_GPT_E2E.md`). Aucun secret ; les scripts lisent les identifiants depuis le scratchpad local.

# Reprise Opus : certification pré-E2E G6 (revue croisée du 13/11/2026 — correctifs Hub et matrice O-HUB)

> **Archivé le 14/11/2026.** Ce fichier n'est plus suivi. Le registre commun unique est `docs/chantier/STATUS.md` sur `main` (#4031). Les briefs et scripts de ce dossier restent consultables comme référence.

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

| Lot | PR | État vérifié sur tête citée |
|---|---|---|
| L1 à L7, #3951, W1 à W3, R1 à R6 (#3981 à #3986) | fusionnés | staging antérieur (SHA `589d81d88` selon handoff Opus ; revérifier `/health/version` avant tout test) |
| H1 : complétude automatique, cron, rupture + incident + remboursement admin (HB-01/02/03) | [#4001](https://github.com/SamyrFateh/komerce-backend/pull/4001) | **draft, Required verdict VERT** sur `58f164a` ; backend, preflight, PG16/intégration/E2E API verts [run 43466803089](https://github.com/SamyrFateh/komerce-backend/actions/runs/43466803089). Fixture d'incident et scénario sac/KOM-BOX réel corrigés, aucune validation Chromium staging revendiquée. |
| H2 : sérialiser les répartitions HB-04 | [#4000](https://github.com/SamyrFateh/komerce-backend/pull/4000) | **draft, Required verdict VERT** sur `c8039a3` ([43451497471](https://github.com/SamyrFateh/komerce-backend/actions/runs/43451497471)), test concurrence PostgreSQL réelle inter-opérateurs restant à prouver. |
| H3 : confirmation ≥ déjà reçu ; quantité unifiée hors quarantaine ; refus ligne sans SKU (HB-05/06/07/11) | [#4003](https://github.com/SamyrFateh/komerce-backend/pull/4003) | **draft, Required verdict VERT** sur `6673e52` ([43464578449](https://github.com/SamyrFateh/komerce-backend/actions/runs/43464578449)), migration 414 et fixture PG synchronisées ; M06 réel Hub central à rejouer. |
| H4 : cockpit directrice multi-marchés, âge et alerte 48 h (HB-08, décision 4) | [#4002](https://github.com/SamyrFateh/komerce-backend/pull/4002) | **draft, Required verdict VERT** sur `8e66663` ([run 43469636463](https://github.com/SamyrFateh/komerce-backend/actions/runs/43469636463)) ; backend, preflight, dashboard Playwright simulé, PG16/intégration/E2E API verts ; la file directrice est maintenant visible **dans le poste central `/admin/hub`** (branches Administration et Opérations), sans nouveau cockpit, ni dépendance au filtre marché ; API `GET /api/hub/director-todo` lecture seule, contrat OpenAPI/DEBT synchronisés. Dédoublonnage : tâches opérationnelles distinctes par marché, colis fournisseur global unique. **CI H4 validée, vrai Chromium staging non réalisé**. |

### Travail poussé et points bloquants

- H1 (CI verte sur `58f164a`) : l'ancien test `hub-order-bag-ownership-postgres` créait une seconde ligne `parcel_items` après la distribution automatique, en conflit avec la garde unique (garde saine). La fixture réutilise désormais les IDs des colis créés automatiquement et les `parcel_item_id` canoniques ; CI actuelle à relire.
- H3 : le runner PostgreSQL a validé la migration 414 et les tests d'intégration sur la tête citée. Ne pas relâcher les protections de variant/SKU pour M06.
- H4 : le poste global `/admin/hub` (Administration et Opérations) affiche désormais la file tous marchés depuis l'API en lecture seule (âge, alerte `>=48h`, référence, lien vers le poste du marché). Plus de doublon dans l'écran d'exécution par marché. Enregistrement API dans `docs/contract/openapi.json` et dette synchronisés ; protections d'écriture inchangées. Reste à prouver en Chromium sur le staging intégré.
- **Matrice commune #3944 (branche `docs/g6-matrix-v2`)** : O-HUB **ajouté** aux fichiers G6 JSON et Markdown et aux scénarios M01/M03/M04/M05/M06/N13-N16, script `docs/recette/G6_HUB_SQL_ORACLES.sql` avec **9 contrôles Fable H1–H9**, test de contrat associé. Ce sont des assertions **à exécuter**, aucune preuve de PASS métier à ce stade. H2 (rupture) et H5b (allocation figée) exigent interprétation contextuelle ; H8/H9 exigent visibilité/âge/alerte, pas nécessairement zéro ligne.
- **Les 4 PR restent draft et non fusionnées**. Chevauchements : `purchasing-engagement-service.js` H1/H3/H4 ; `auto-parcel.js` H1/H2. Réconcilier dans cet ordre en conservant les deux logiques, puis refaire Required verdict sur chaque tête actualisée et PostgreSQL avant la moindre fusion.
- **HOLD staging et E2E** : #3900 encore ouverte, passe 2 non déclarée terminée ; aucun merge Hub, aucun changement de variables Railway ; le GO 46 E2E G6 n'a pas été donné. Pas de paiements, WhatsApp ni notifications réels.

### Réconciliation à vérifier sur tête intégrée (pas encore exécutée)

Ordre proposé **H2 → H1 → H3 → H4**, puis nouveau verdict sur chaque tête réellement actualisée. Les quatre PR avaient la même base `46f540bc` au relevé du 13/11 ; elles sont toutes **vertes individuellement mais draft** et le staging est réservé à #3900.

- **`services/auto-parcel.js` (H2 + H1)** : conserver le `FOR UPDATE` transactionnel de H2 **ET** le calcul `closed_short` / quantité reçue de H1. Ne pas restaurer un distributeOrder non sérialisé en reprenant H1.
- **`services/purchasing-engagement-service.js` (H1 + H3 + H4)** : conserver ensemble H1 `openSupplierShortage` dans la transaction de clôture sans reliquat, H3 `purchase_line_received_quantity` refusant une confirmation sous le reçu, H4 `apiSent` (PO auto, `sent_channel='api'`, pas en simulation). Les modifications portent sur trois points distincts, mais **l'absence de conflit textuel ne prouve pas l'absence de conflit métier**.
- **`tests/integration/purchase-lines-engagement-postgres.test.js` (H1 + H3)** : fixture `incidents`/`alerts` de H1 et migration 414 + tables physiques de H3 doivent coexister ; garder les preuves de réception hors quarantaine et incident de rupture.
- **`tests/unit/purchasing-engagement-service.test.js`, `features/purchasing.feature.js` et projections gouvernées** : concaténer les assertions métiers, régénérer les graphes/contrats depuis les sources, ne jamais écraser une projection plus récente par un fichier généré sur une ancienne tête.
- **Sortie** : PostgreSQL 16 intégral, preflight canonique et Required verdict verts **sur chaque HEAD réconcilié**, puis seule fenêtre de fusion après clôture de la seconde passe #3900 et vérification qu'aucune campagne n'écrit sur le staging. Activer `E7_ITEM_RESERVATIONS_ENABLED=1` sur **staging uniquement** dans cette fenêtre ; déploiement, SHA, puis H1–H9/Chromium ciblés.

**Fusion groupée H1 à H4** : à faire quand tout est vert et qu'aucun run `staging`, `chromium` ou `g6` n'est actif. Modèle de boucle : `scripts/merge-list.sh <PR...>`. Elle sort les PR du brouillon via `POST /pulls/{n}/ccr/ready_for_review`, fait update-branch, attend `clean`, fusionne en squash et contrôle `merged=true`. **Dans le même créneau**, activer `E7_ITEM_RESERVATIONS_ENABLED=1` sur le staging Railway (décision du propriétaire du 13/11). Cela redémarre le service.

**Audits Fable** : #3987 (flux d'argent), #3988 (moteur économique), #3998 (Hub). Les décisions 1 à 7 du propriétaire sur #3998 figurent dans le commentaire 6857010399. Les invariants SQL H1 à H9 de #3998 sont **ajoutés au contrat partagé #3944** dans l'oracle O-HUB ; il reste à les **exécuter** indépendamment pour chaque campagne.

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
2. **Quatre PR H1–H4 individuellement vertes** : réconcilier H1/H2/H3/H4 avec PostgreSQL, vérifier M06 Hub central et vue directrice ; après fin confirmée de #3900 et absence de runs actifs, fusion groupée + activation de E7 **sur staging uniquement**, puis revérification Hub ciblée H1–H9 (Chromium, HTTP et SQL indépendants).
3. **Matrice #3944 mise à jour (O-HUB)** : exécuter les 9 SQL pour ChatGPT et Opus, et vérifier les ruptures définitives, colis arrivés non rapprochés, contention, quarantaine et leur preuve physique sur les scénarios M/N correspondants.
4. Si tout est PASS : demander au propriétaire le **GO E2E G6 final, qui n'est pas encore donné**. Ensuite, 46 scénarios sur KM puis CM et CG, avec les fixtures de cas limites (prix inactif, exposition coupée, stock à 0, au moins 2 variantes).
5. **Après les E2E** : supprimer les routes historiques de colis (HB-09) et le code mort de réception (HB-10).

## Contenu de ce dossier
- `briefs/` : tous les briefs Opus, Sonnet et Fable, et les plans, dont `BRIEF_3900_PASSE2.md`, `BRIEF_CORRECTIONS_3900_R2.md` et `BRIEF_CORRECTIONS_HUB_FABLE.md`.
- `scripts/` : helpers Chromium (`parcours-km`, `catalogue-ms`, `par3900`), boucles de fusion, consigne d’alignement GPT (`scripts/ALIGNEMENT_GPT_E2E.md`). Aucun secret ; les scripts lisent les identifiants depuis le scratchpad local.


## 13/11 — priorité corrections, PR d'intégration H1–H4 #4004

Sur décision propriétaire, **corrections avant certification #3900 ou lancement G6**. GPT a créé la branche `fix/hub-H1-H4-integration-20261113` depuis `main` `46f540bc`, commit `1687f8ecfc073842bfded99f1076c269870edab8`, et la [PR **draft #4004**](https://github.com/SamyrFateh/komerce-backend/pull/4004).

**Composition du code (49 chemins)** : H2 `distributeOrderLocked` sérialisé + H1 `closed_short`/quantité reçue ; H1 `openSupplierShortage` + H3 refus `purchase_line_received_quantity` + H4 PO API prouvée dans le même `purchasing-engagement-service.js`. Les fixtures PG H1+H3 et les tests unitaires des trois lots ont été fusionnés, les deux branches Hub gardent la file directrice globale depuis `/admin/hub`.

**Contrôles** : première exécution [43483473404](https://github.com/SamyrFateh/komerce-backend/actions/runs/43483473404) a échoué **uniquement à l'entrée gouvernance** (sections Pourquoi/Tests absentes de la description PR) ; body corrigé sans changer le commit. Nouveau run [43483644722](https://github.com/SamyrFateh/komerce-backend/actions/runs/43483644722) : **Required verdict SUCCESS** sur le SHA combiné `1687f8e` ; détection scope, gouvernance, migrations, backend, dashboard, préflight canonique, PG16/intégration et E2E API **tous verts**. C'est une preuve CI **intégrée**, pas une preuve Chromium sur staging réel.

**Dette de projection** : `docs/komerce-arch-header-graph.json` reprend provisoirement le blob H1 individuellement validé, non la fusion exacte H1+H4 ; régénérer ou réconcilier ce gros graphe sur l'HEAD intégré si le préflight l'exige. Les autres projections de graphes et contrats ont été consolidées.

**HOLD métier** : aucune fusion `main`, aucun staging/E7 modifié, aucun writer ou campagne G6 déclenché. #3900 reste un chantier de preuve distinct ; avant déploiement coordonner avec Opus un staging libre. Les oracles O-HUB et 46 scénarios demeurent dans #3944.

# Certification métier V1 multi-marché : note de reprise

Cette note sert à reprendre la certification exactement où elle s'est arrêtée, sans autre contexte : tout ce qu'il faut est ici.
**Mise à jour 2026-11-10 : décision staging jetable et campagne réelle G2/G3/G4.** Lire en priorité [la preuve transactionnelle et ses limites](evidence/STAGING_G234_20261110.md) avant les historiques du 7 novembre. Les résultats antérieurs restent traçables mais ne dispensent pas des nouvelles preuves demandées.

## Décision de conduite du 10/11/2026

Le propriétaire autorise les créations/modifications des données **sur Railway staging uniquement**, sans cleanup sélectif par campagne. Les deux gates historiques préflight restent conditionnés à l'identité du propriétaire et à l'environnement jetable ; ils ne certifient pas le résultat métier. Après l'archivage des preuves : reset global `prudent` via `staging-reset.js` (dry-run actuel obligatoire), puis `staging-e2e-provision` pour remettre les comptes. Aucune nouvelle campagne sur PG16 isolé sauf pour diagnostiquer un défaut précis apparu sur staging. Aucun effet externe réel (PSP, SMS, WhatsApp).

**Preuves du 10/11/2026** : G2 13 étapes services/PG KM PASS (run [42826612419](https://github.com/SamyrFateh/komerce-backend/actions/runs/42826612419)). G3 LOCAL_STOCK Chromium + HTTP/PG PASS KM [42826889006](https://github.com/SamyrFateh/komerce-backend/actions/runs/42826889006), CM [42828913515](https://github.com/SamyrFateh/komerce-backend/actions/runs/42828913515), CG [42829199967](https://github.com/SamyrFateh/komerce-backend/actions/runs/42829199967). G4 A/B KM, G2 Chromium chaque geste et G3 SAV intégral ont des verdicts **distincts non déduits** de ces résultats.

## 1. Objectif

Prouver sur le staging Railway (`https://komerce-backend-production.up.railway.app`, qui est le staging malgré son nom) que chaque marché V1 fonctionne de bout en bout :

- la chaîne achats (PO) ;
- la chaîne physique : réception Hub, sacs, KOM-BOX, expédition internationale, transitaire, douane, livraison locale, attestation relais, retrait client ;
- le circuit local : préparation/disponibilité au relais, réception locale si nécessaire, puis preuve de remise client, **sans achat ni expédition Hub**.

Chaque chaîne est prouvée deux fois, d'abord par les routes HTTP réelles, puis par des clics réels dans Chromium. Chaque geste est joué par le vrai rôle.

Ensuite viendront un seed partenaires visible et des comptes partenaires cloisonnés par marché.

## 2. État par marché

| Marché | Statut | Preuve API | Preuve clics | Reste à faire |
|---|---|---|---|---|
| KM | ACTIVE | 53/53 PASS, fixture 71B671EB | 36/36 CLICK_PASS, fixture 2C2EB181, run 42369442085 | Rien pour le nominal |
| CM | ACTIVE ; tarifs RECETTE attestés | **53 PASS physiques**, 35 achats + 1 seam ; RUN8 40A162A6 | **36 CLICK_PASS**, RUN8 2B13C104 | ISOLATION_PASS ; nominal réussi, run #42382520838 |
| CG | ACTIVE ; tarifs RECETTE attestés | **53 PASS physiques**, 35 achats + 1 seam ; RUN8 57030A02 | **36 CLICK_PASS**, RUN8 5D6F90EC | ISOLATION_PASS ; nominal réussi, run #42382886270 |
| YT | SUSPENDED | Hors périmètre | Hors périmètre | Ne pas rouvrir sans décision |
| DJ | PROVISIONING | Hors périmètre | Hors périmètre | Ne pas toucher |

Toutes les preuves staging réussies sont versionnées dans `docs/recette/evidence/` ; l'index se trouve dans `docs/recette/evidence/README.md`. Les captures restent dans les artefacts des runs.
L'audit économique du Hub, qui est un sujet connexe, se trouve dans `docs/audits/hub-economics-20261106/`.

Isolation croisée entre KM, CM et CG : JOUÉE le 2026-11-07, ISOLATION_PASS (run 42375312269, outil `staging-market-isolation` #3481, correctif de sonde #3484). L'agent relais, lié à un relais KM, obtient 200 sur KM et 403 sur CM et CG en lecture et en écriture ; l'admin lit les trois marchés. Preuve : `docs/recette/evidence/isolation-20261107/`. Limite historique du run relais : seul l'agent relais était croisé. Cette limite a été levée pour les responsables pays par la campagne de comptes E2E exclusifs CM/CG du run #42385877161 (section 11). Les rôles Hub, transitaire et admin restent centraux par conception.

Preuves CM et CG déjà versionnées : `docs/recette/evidence/cm-20261107/` et `docs/recette/evidence/cg-20261107/` (readiness avant activation, rapports d'activation, certificats tarifs de vente RECETTE et anciennes fixtures CM en échec). L'index de `docs/recette/evidence/README.md` ne liste que les runs réussis.

## 3. Procédure : certifier un marché (KM, CM ou CG)

Tout passe par GitHub Actions en `workflow_dispatch`. Chaque écriture exige un mot de confirmation exact.

1. **Prérequis, en lecture seule.**
   - `staging-cert-prereq-readonly` vérifie la cible et la version servie.
   - `staging-market-readiness`, avec `markets=CM,CG`, lit le plan de contrôle du marché.
2. **Comptes de test et marqueurs.** `staging-e2e-provision` : `mode=dry-run`, puis `mode=execute` avec `extra_markets=CM,CG` et la confirmation `PROVISION-STAGING-E2E`. Ce workflow pose aussi les marqueurs dans `e2e_test_accounts`.
3. **Activation d'un marché de recette (CM ou CG).** `staging-market-activate` (dry-run d'abord) avec `market=<CODE>` et la confirmation `ACTIVATE-RECETTE-<CODE>`. Il exécute l'attestation puis `POST /api/admin/markets/:code/lifecycle` ACTIVE, audité par `MARKET_LIFECYCLE_CHANGED`.
4. **Fixture neuve.** Lancer `hub-v1-km-fixture-stop-after-2` avec `market=<CODE>`, ou ouvrir une issue dont le titre est exactement `[staging-op] hub-v1-km-fixture-stop-after-2` (elle vaut pour KM). Le run produit un RUN8 de 8 caractères hexadécimaux en majuscules.
5. **Relais sur la fixture.** `staging-e2e-relay-reassign` en `dry-run-to-fixture`, puis en `to-fixture` avec `run8` et la confirmation `REASSIGN-E2E-RELAY`. Le mode `restore`, avec `restore_relay_id`, permet de revenir en arrière.
6. **Chaîne achats.** `hub-v1-http-actions-staging` avec `run8`, `market`, `chain=po` et la confirmation `RUN-HTTP-ACTIONS`. Une seule fois par fixture.
7. **Chaîne physique par API.** Même workflow, avec `chain=physical` et `allow_distribution=true`. Ce run consomme la fixture.
8. **Clics réels.** Sur une autre fixture qui a déjà passé la chaîne achats, `hub-v1-clicks-staging` avec `run8`, `market`, `allow_distribution=true` et la confirmation `RUN-HTTP-CLICKS`.

Points d'attention :

- **Une fixture par run physique.** Les étapes 7 et 8 consomment chacune leur fixture.
- **`allow_distribution` agit sur tout le marché**, pas seulement sur la fixture.
- **Railway ne redéploie pas pour un commit qui ne touche que `.github/`, la doc ou les tests.** Le pin de déploiement (`resolve-staging-deploy-pin.js`, #3448) accepte cet écart. Pour tout autre commit, attendre que `/health/version` renvoie bien HEAD de main avant de lancer un run.
- **Les preuves** (JSON et captures) se trouvent dans les artefacts de chaque run.

Scripts : `scripts/recette/`, notamment `staging-e2e-provision.js`, `hub-v1-certification-runner.js`, `staging-e2e-relay-reassign.js`, `hub-v1-http-action-runner.js`, `hub-v1-http-physical-chain.js` et `target-guard.js`.
Spec des clics : `tests/staging-clicks/hub-v1-clicks.spec.js`, avec la config `playwright.hub-v1-clicks.config.js`.

## 4. Décisions de l'utilisateur (ne pas rouvrir)

- **Paiement client.** Le client paie toujours à la commande, en espèces au relais ou par un autre moyen. Jamais au retrait.
- **PO.** Une PO est mono-marché et mono-fournisseur. L'engagement et le paiement sont validés par la directrice du Hub.
- **Colis import.** Un colis par commande import (#3458). Le local et l'import ne sont jamais mélangés (#3457).
- **Rôles centraux.** `agent_hub` et `agent_transitaire` sont centraux : tous les marchés ACTIVE, sans membership.
  - Leur source unique est `config/central-transit-roles.js` (#3467).
  - Le transitaire n'a accès qu'à Expéditions & Douane, plus sa liste « À traiter ». Il n'a ni Hub Live ni Finance.
- **Douane.** Pour l'instant, elle est réservée à l'admin (`requireCustomsAction`). La cible est une délégation à chaque marché avec une capacité dédiée, le lot D6b, qui est suspendu. Les étapes douane jouées par admin ne sont donc pas un défaut.
- **Réception relais.** Pour l'import, elle passe par l'attestation d'expédition. Le bouton « Réceptionner » est réservé aux colis locaux, c'est-à-dire sans expédition (#3461). La route refuse un colis rattaché à une expédition.
- **Commandes de test.** Les commandes `simulation_scope` ne sont visibles que pour les comptes présents dans `e2e_test_accounts` (#3473, migration 397).
  - Le prédicat unique est `isE2eTestAccount` dans `services/simulation-visibility.js`.
  - Il n'y a pas de garde d'environnement, volontairement : le service Railway « production » est le staging. La sécurité vient de ce que seul le provisioning staging remplit cette table.
- **Responsable opérationnel de recette pour CM et CG.** C'est le compte E2E `market_operator` (« Responsable pays »), posé par `staging-e2e-provision` avec `extra_markets=CM,CG` (#3477, #3480).
  - Memberships manager (tout le plafond DELEGABLE du marché), plus responsable d'exploitation (`is_operating_lead`) par `inviteTeamMember`.
  - Pour les 4 capacités à montant (`cash.custody.receive`, `execution.cash.confirm`, `finance.act`, `settlement.receive`), la limite du membership est celle du plafond du marché : 1 000 000 en CM et en CG. Jamais au-delà du plafond.
  - L'agent relais E2E a aussi les memberships `execution.parcel.receive` et `execution.parcel.collect` en CM et CG.
- **Corridors Dubaï → CM et Dubaï → CG.** Leurs valeurs sont provisoires et marquées « RECETTE » : transporteur, tarif en XAF, jours de transit, référence `RECETTE-PROVISOIRE-<marché>-<date>`. Elles doivent être remplacées par de vraies valeurs avant l'ouverture aux partenaires. Les transporteurs existants ne doivent pas être modifiés.
- **Réouverture.** Passer par `staging-market-readiness` (lecture), puis `staging-market-activate` : readiness vert exigé (sinon arrêt sans écriture), transporteur dédié, attestation, `POST …/lifecycle` ACTIVE. Jamais par seed ni SQL. CM et CG ont été rouverts ainsi, le 2026-11-07, avec un seul manque à l'origine (`NO_ACTIVE_MEMBERSHIP`).
- **Valeurs provisoires posées (RECETTE).** À remplacer avant l'ouverture aux partenaires :
  - CM : transporteur « RECETTE — Maritime Dubaï→Douala », mode SEA, origine « Hub Dubaï », 1 500 XAF par kg, 35 jours, référence `RECETTE-PROVISOIRE-CM-2026-11-07`, validité 90 jours.
  - CG : transporteur « RECETTE — Maritime Dubaï→Pointe-Noire », mode SEA, origine « Hub Dubaï », 1 700 XAF par kg, 40 jours, référence `RECETTE-PROVISOIRE-CG-2026-11-07`, validité 90 jours.
- **Tarif de transport de vente.** Le code (`hub-v1-certification-runner.js`, commentaire du seed) pose en principe que l'absence de tarif sur staging est un constat de certification, jamais une lacune à masquer : ne pas le semer par SQL.
- **Données.** Aucune donnée hors fixtures E2E. Aucun PSP activé. Les remboursements PSP restent désactivés (E7).
- **Fixtures retirées.** 8D2B143C (colis mixte). 7DC2A4D9, 71B671EB, 50A59BFD et 2C2EB181 sont consommées.
- **Relais E2E KM.** Il a été réaffecté et n'a pas été restauré. Son relais d'origine est `9f0e69b4-e772-4857-9a01-6b1083a745f0`.

## 5. Règles de travail

- **Mandat de merge.** L'agent peut merger ses propres PR une fois la CI verte, avec le check requis « Required verdict ». Une PR qui introduit une nouvelle règle métier ou élargit des droits doit d'abord être soumise à l'utilisateur.
- **Avant tout push.** Lancer `npm run pr:preflight` sur un arbre propre, avec `PR_BODY` renseigné. Le hook pre-push bloque sans preflight vert.
- **Corps de PR.** Il doit contenir les sections `## Pourquoi`, `## Quoi` et `## Tests`. Le check « Detect PR scope » échoue sinon.
- **GitHub depuis l'agent.** GraphQL est bloqué, donc pas de `gh pr view` ni de `gh pr create` : utiliser l'API REST (`gh api repos/SamyrFateh/komerce-backend/...`).
- **Git local.** Le dépôt local a des refspecs limités. Pour suivre une nouvelle branche : `git fetch origin '+refs/heads/<b>:refs/remotes/origin/<b>'`, puis `git branch -u origin/<b>`.
- **Sollicitations.** Ne solliciter l'utilisateur que pour un vrai arbitrage métier ou un blocage avéré, et sans notifications répétitives de merge.

## 6. Trous de couverture connus

1. **Refus.** Ils ne sont testés que sur la réception Hub et la création de sac. Il manque, entre autres, le refus d'un relais qui fait avancer une expédition, et celui d'un transitaire qui agit sur le Hub.
2. **Isolation entre marchés.** Elle sera couverte par #3481.
3. **Chemin nominal seulement.** Restent à couvrir : retards fournisseur, réceptions partielles, incidents, remboursements, annulations.
4. **Paiement.** Il est simulé dans la fixture. L'ouverture des lignes d'achat passe par une couture de service (`SEAM_NOT_HTTP`), pas par une route HTTP.

## 7. Ancien point d'arrêt — historique, corrigé par la voie A

**Point d'arrêt connu (2026-11-07, avant implémentation de la voie tarifaire).** CM et CG sont ACTIVE. Les fixtures 82076FAA et B13C6D97 (CM) ont échoué à l'étape 1 du checkout : `CHECKOUT_REFUSED:KOM-101 … MARKET_TRANSPORT_TARIFF_MISSING` (« Aucun tarif de transport de vente n'est configuré pour ce marché »). Ces deux fixtures sont inutilisables (commandes non créées). Les runs `staging-e2e-relay-reassign` et `hub-v1-http-actions-staging` lancés ensuite sur elles ont échoué, ce qui est attendu : ce ne sont pas des preuves. Le run `chain=physical` de la fixture 82076FAA est marqué « success » alors que le `po` précédent a échoué : ne pas l'utiliser non plus.

1. **Décision métier à obtenir (CM et CG) : le tarif de transport de vente.** Table `market_transport_sale_rates` (clés `SEA_KMF_PER_KG_COMMERCIAL` et `AIR_KMF_PER_KG_TAXABLE`, un tarif par kg, une devise, une référence de preuve). Il faut les valeurs par marché (valeurs provisoires de recette acceptables si l'utilisateur le dit), et la voie pour les poser. Constat : aucune route ni aucun service applicatif n'écrit `market_transport_sale_rates` (lecture seule dans `services/market-transport-sale-rates.js` ; seuls des tests e2e et le seed d'une base éphémère insèrent en SQL). Il n'existe donc pas de voie gouvernée : en créer une (route admin auditée) est une nouvelle fonctionnalité, à soumettre à l'utilisateur ; sinon il faut son accord explicite pour une écriture SQL ponctuelle de recette limitée aux marchés CM et CG. Sans cette décision, aucune commande ne peut être créée en CM ni en CG.
2. **Dès que les tarifs sont posés.** Pour CM, puis CG : fixture neuve avec `market=<CODE>`, relais `to-fixture`, `chain=po`, `chain=physical` avec `allow_distribution`, puis une seconde fixture pour les clics. L'enchaînement exact est dans la section 3 ; le script de pilotage utilisé le 2026-11-07 est reproductible avec les mêmes workflows.
3. **Isolation.** Faite (voir section 2). À rejouer après l'ouverture de tout nouveau marché ou compte cloisonné.
4. **Rapport par marché.** Readiness, tableau API, tableau Clic, valeurs provisoires posées et résultat de l'isolation.
5. **Ensuite.** Les cas limites, puis le seed partenaires visible avec plusieurs semaines d'historique par marché, puis les comptes partenaires par marché et par rôle.


## 8. Reprise tarif de vente CM/CG — voie A autorisée le 2026-11-07

Décision du propriétaire : **voie A** (route admin centrale, auditée) et **tarifs de vente KM courants convertis en XAF** uniquement pour la RECETTE. Ne pas confondre le tarif facturé au client avec le coût de fret du corridor (CM 1 500 XAF/kg, CG 1 700 XAF/kg, chiffres provisoires). Un prix de recette inférieur au coût ne vaut jamais GO économique ni ouverture aux partenaires.

Implémentation sur la branche `feat/market-transport-sale-governed-recette` :
- `GET /api/admin/markets/:marketCode/transport-sale-rates` (`?history=1` pour voir les versions révoquées) ;
- `PUT /api/admin/markets/:marketCode/transport-sale-rates/:rateKey`, admin central uniquement, champs `rate_per_kg`, `currency`, `evidence_ref`, `reason`. Vérification de la devise du marché, versionnement (révocation de la précédente), identité de l'auteur et événement `MARKET_TRANSPORT_SALE_RATE_SET` dans une transaction unique. Aucune écriture SQL non gouvernée ;
- outil `scripts/recette/staging-market-transport-sale-rates.js` : lit les vraies règles KM de staging, convertit KMF → EUR → XAF via `fx-authority` (parités certifiées et legs de preuve), arrondit à 4 décimales, ne touche qu'à CM/CG, refuse d'écraser un tarif non-RECETTE ;
- workflow `staging-market-transport-sale-rates.yml` : dry-run sans confirmation ou application après la confirmation exacte `APPLY-RECETTE-TRANSPORT-CM` / `APPLY-RECETTE-TRANSPORT-CG` ; déclenchement alternatif par issue du propriétaire au titre exact `[staging-op] market-transport-sale-CM` ou `[staging-op] market-transport-sale-CG`. Résultat JSON archivé.

**État révisé :** la PR #3488 a été mergée et déployée sur staging (`afcca3e...`), les deux marchés ont reçu les tarifs RECETTE par les routes administratives. Cela n'atteste PAS les parcours commandes/physique/Chromium.

Une fois le tarif CM réellement posé et relu, reprendre la procédure de la section 3 avec une fixture CM neuve (les précédentes sont inutilisables). Refaire sur CG, puis compléter les tests d'isolation avec comptes réellement cloisonnés. Ne pas ouvrir les comptes partenaires tant que les tarifs `RECETTE` subsistent. AIR_EXPRESS reste non commercialisé (registre logistics `INTERNAL/PENDING/DISABLED`) : poser le tarif ne l'expose pas.

## 9. Point de reprise réel — 7 novembre 2026, après tarification

**Fin du blocage tarifaire :**
- CM : workflow GitHub Actions [42381811718](https://github.com/SamyrFateh/komerce-backend/actions/runs/42381811718), verdict `TARIFFS_APPLIED_AND_VERIFIED`, justification `RECETTE-VENTE-TRANSPORT-CM-2026-11-07`, écriture HTTP 201 × 2 et readback 200 vérifié.
- CG : workflow [42382091838](https://github.com/SamyrFateh/komerce-backend/actions/runs/42382091838), même verdict, justification `RECETTE-VENTE-TRANSPORT-CG-2026-11-07`.
- Source de calcul : staging `business_rules` KM : maritime 65 KMF/kg → **86.6667 XAF/kg**, aérien 2500 KMF/kg → **3333.3333 XAF/kg**, autorité `fx-authority` via EUR, legs documentés dans les deux fichiers JSON de preuve.
- Coûts de corridors indépendants : CM 1500 XAF/kg, CG 1700 XAF/kg. Les tarifs RECETTE ne valent ni décision de rentabilité ni prix partenaire. AIR_EXPRESS demeure non commercialisé.

**PRs intégrées :**
- [#3488](https://github.com/SamyrFateh/komerce-backend/pull/3488) : tarif de vente admin gouverné avec traçabilité/versionnement, script FX et workflow staging.
- [#3489](https://github.com/SamyrFateh/komerce-backend/pull/3489) : réaffectation du relais E2E entre marchés uniquement avec membership déjà existant, et workflow `staging-market-full-certification.yml` (CM/CG, API/Chromium).

**Premier essai de certification complète CM, NON CERTIFIANT :**
- Run [42382197263](https://github.com/SamyrFateh/komerce-backend/actions/runs/42382197263), refus immédiat à `Fixture HTTP neuve` : `STAGING_RUN8_NOT_EXPLICITLY_APPROVED`.
- Cause : le harnais exige que chaque RUN8 généré soit exporté dans `HUB_V1_CERTIFICATION_RUN` en plus de `--run=RUN8`. Le workflow ne le faisait pas.
- La [PR #3493](https://github.com/SamyrFateh/komerce-backend/pull/3493) corrige les deux fixtures (API et Chromium) ; attendre son `Required verdict` vert et son merge. Le RUN8 `D06C3C89` a échoué avant les écritures, ne pas le reprendre.
- **Relancer CM via une NOUVELLE issue owner** au titre exact `[staging-op] full-cert-CM` (ou workflow_dispatch confirmé `RUN-FULL-CERT-CM`). Après un PASS réel sur CM, lancer CG avec le titre exact `[staging-op] full-cert-CG`. Chaque run doit produire les deux fixtures, les 53 PASS de chaîne physique et 36 CLICK_PASS, et une isolation `ISOLATION_PASS` ; tout BLOCKED ou FAIL est un non-GO.

La note opératoire complète du nouveau workflow est dans `docs/recette/FULL_CERT_CM_CG_AUTOMATION.md`. Les preuves vérifiées et les artefacts réussis doivent être ajoutés à `docs/recette/evidence/` à chaque run. Cette limitation historique du compte « Responsable pays » mutualisé est levée par le run #42385877161 (section 11).

## 10. Certification nominale CM et CG terminée le 2026-11-07 — état vérifié

Le correctif du garde RUN8 a été livré et mergé dans [#3493](https://github.com/SamyrFateh/komerce-backend/pull/3493) : il exporte `HUB_V1_CERTIFICATION_RUN` pour chaque fixture API/Chromium. Le premier essai en échec #42382197263 reste une preuve non certifiante historique, sans écriture.

**CM : [run GitHub 42382520838](https://github.com/SamyrFateh/komerce-backend/actions/runs/42382520838)** — workflow complet `success`, achats 35 PASS + 1 `SEAM_NOT_HTTP` par fixture, chaîne physique 53/53 PASS, Chromium **36/36 CLICK_PASS** (10 tests Playwright réussis), isolation `ISOLATION_PASS`. Fixtures API `40A162A6`, Chromium `2B13C104`. Artefact : `staging-full-cert-CM-42382520838` (id 13578446399). Le relais E2E CM lit CM (200), KM et CG refusent (403).

**CG : [run GitHub 42382886270](https://github.com/SamyrFateh/komerce-backend/actions/runs/42382886270)** — mêmes verdicts : achats 35 PASS + 1 seam par fixture ; physique 53/53 PASS ; Chromium **36/36 CLICK_PASS** (10 tests) ; isolation `ISOLATION_PASS`. Fixtures API `57030A02`, Chromium `5D6F90EC`. Artefact : `staging-full-cert-CG-42382886270` (id 13578726442). Le relais E2E CG lit CG (200), KM et CM refusent (403).

**Preuves versionnées sur `main` (vérifiées le 2026-11-07).** La [PR #3495](https://github.com/SamyrFateh/komerce-backend/pull/3495) contient les rapports d'application des tarifs RECETTE CM et CG. Les PR [#3502 — CM](https://github.com/SamyrFateh/komerce-backend/pull/3502) et [#3504 — CG](https://github.com/SamyrFateh/komerce-backend/pull/3504), mergées avec `Required verdict` vert, contiennent les rapports **JSON complets** des deux fixtures, deux chaînes achats, chaîne physique, 36 gestes Chromium, isolation et synthèse par marché. Index dans `docs/recette/evidence/README.md`. Les captures demeurent dans les artefacts des runs GitHub ; rien d'autre à télécharger pour reprendre les résultats structurés. Le workflow [#3498](https://github.com/SamyrFateh/komerce-backend/pull/3498) permet de répéter cet archivage pour les futurs runs réussis. Ne pas rejouer des fixtures consommées.

**Verdict exact :** *PASS nominal staging* pour KM, CM et CG sur les parcours actuels de la recette. Ce verdict ne vaut **pas** ouverture aux partenaires ni GO économique. Il reste :
- remplacer les prix de vente et coûts des corridors `RECETTE` par les valeurs réelles, contrôler marge et contribution ;
- isolation des vrais comptes opérateurs exclusifs CM et CG : **certifiée** (run #42385877161, section 11) ;
- couvrir les cas non nominaux (ruptures fournisseur, réceptions partielles, reliquats, retards, remboursements, incidents, annulations) ;
- **revoir le parcours LOCAL_STOCK** : les scripts nominaux historiques incluent encore un geste `local:ship` par le Hub, alors que la règle métier durable exige un circuit local sans Hub. Ne pas qualifier la couverture locale de conforme à cette règle sans recette spécifique distincte.

La procédure de certification relançable demeure `docs/recette/FULL_CERT_CM_CG_AUTOMATION.md` et le référentiel des preuves `docs/recette/evidence/README.md`.


## 11. Isolation CM/CG des responsables pays, rôles distincts — 2026-11-07

**Verdict : MARKET_OPERATOR_ISOLATION_PASS**, preuve réelle sur le staging, run officiel [42385877161](https://github.com/SamyrFateh/komerce-backend/actions/runs/42385877161), 18 sondes HTTP / 18 conformes, aucune fuite de données ni écriture métier.

Deux comptes `market_operator` E2E neufs, identifiants et mots de passe générés uniquement pendant le workflow, chacun avec **une seule membership active** (CM ou CG). Le provisionnement utilise les writers canoniques, et le garde du workflow refuse un environnement non staging, une empreinte DB incorrecte ou un SHA de déploiement différent. Aucun compte partenaire réel n'a été modifié.

La matrice, pour chaque acteur CM et CG, couvre `KM`, `CM`, `CG` :
- `GET /api/admin/workspaces/operations/market/:code` : `200` uniquement sur son propre marché ; `403` ailleurs ;
- `GET …/supply/trace?order_id=00000000-0000-4000-8000-000000000000` : `200` pour son marché, `403` ailleurs ; requête valide mais sur une commande inexistante ;
- `POST …/parcels/ISOLATION-PROBE-NONEXISTENT/ship` : `404` sur son marché (identifiant volontairement inexistant), `403` ailleurs. Aucune mutation de colis réel.

Rapport JSON original sans secrets : `docs/recette/evidence/isolation-20261107/staging-market-operator-isolation-42385877161.json`. Code et workflow : PR [#3508](https://github.com/SamyrFateh/komerce-backend/pull/3508) ; correction du paramètre de la sonde trace : PR [#3511](https://github.com/SamyrFateh/komerce-backend/pull/3511).

Les runs précédents [42385279726](https://github.com/SamyrFateh/komerce-backend/actions/runs/42385279726) (refus de SHA, avant toute écriture) et [42385392225](https://github.com/SamyrFateh/komerce-backend/actions/runs/42385392225) (12 refus croisés 403 mais 2 traces propres 400 dues à une requête sans clé) ne sont pas des GO.

**Point de reprise opérationnel suivant :** certifier les refus de franchissement de rôle (Relais → actions Hub ; Transitaire → achats et colis Hub), la chaîne locale sans Hub, puis les non-nominaux (incident fournisseur, manquant, reliquat, annulation, remboursement). Les prix et coûts provisoires `RECETTE` restent **non commercialisables**, aucune activation PSP réelle ni ouverture aux partenaires sans GO économique.

## 12. Certification négative des frontières Admin/Hub/Transitaire/Relais — 2026-11-07

**Verdict `ROLE_BOUNDARY_PASS`, 37/37 tests HTTP réels**, sans écriture métier, sur staging Railway :
- Run officiel réussi : [42391311145](https://github.com/SamyrFateh/komerce-backend/actions/runs/42391311145), après déploiement du correctif `3cce0badfb9c4b4be2a42b683751232817179c87` (PR [#3517](https://github.com/SamyrFateh/komerce-backend/pull/3517)).
- Rapport complet original, sans secrets : `docs/recette/evidence/isolation-20261107/staging-negative-role-boundaries-42391311145.json`.
- Acteurs vérifiés : sessions réelles E2E `admin`, `agent_hub`, `agent_transitaire` et `agent_relais`.
- `GET /api/hub-dash/dashboard`, `/queue`, `/api/hub/stats/week`, `/api/hub/board` : Hub/Admin autorisés, Transitaire refusé HTTP 403 ; Relais refusé sur les routes qui lui sont interdites.
- Actions préparation/backorder sur commande inexistante, expédition sur colis inexistant : 404 pour acteurs autorisés (sauf `execution.parcel.ship` qui refuse explicitement Admin 403), 403 pour rôles non autorisés. Aucun colis réel touché.
- Lecture du contrôle marché/tarifs réservée Admin ; PUT tarif de vente refusé 403 à Hub, Transitaire et Relais (aucun PUT émis en tant qu'Admin).
- Une ancienne délégation marché ne requalifie plus `agent_transitaire` en responsable pays via le bridge global ; la garde des postes Hub reste explicite et fail-closed.

**Historique du défaut :** run initial [42386763928](https://github.com/SamyrFateh/komerce-backend/actions/runs/42386763928), 27/31 seulement, avec deux lectures Hub du transitaire renvoyant 200. Il n'est pas certifiant. La PR #3517 corrige également les régressions CSS du mode Hub plein écran sans assouplissement de la règle `!important`.

**Verdict consolidé :** KM, CM et CG ont un PASS nominal staging ; responsables pays CM/CG isolés 18/18 ; frontières de rôles Hub/Relais/Transitaire/Admin certifiées 37/37. **Pas de GO commercial** : les tarifs de vente et les coûts de corridors CM/CG restent `RECETTE` ; les scénarios rupture/retard fournisseur, réceptions partielles, incidents, remboursements et annulations ne sont pas certifiés ; le circuit `LOCAL_STOCK` sans Hub doit faire l'objet d'une recette distincte.

**Point de reprise suivant :** bâtir des fixtures locales et fournisseur à effets externes désactivés, puis certifier sur vrai staging (API et Chromium à rôle réel) le circuit local sans Hub, les quantités partielles/reliquats et les incidents. Conserver des preuves JSON versionnées pour chaque verdict. Ne jamais transformer une ligne de prix `RECETTE` en tarif partenaire sans validation économique et références fournisseur réelles.

# Certification métier V1 multi-marché : note de reprise

Cette note sert à reprendre la certification exactement où elle s'est arrêtée, sans autre contexte : tout ce qu'il faut est ici.
État au 2026-11-07, fin d'après-midi (heure de Paris). Dernière mise à jour : CM et CG actifs, blocage tarif de transport de vente.

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
| CM | ACTIVE (activé le 2026-11-07, audit `MARKET_LIFECYCLE_CHANGED`) | À faire | À faire | BLOQUÉ : aucun tarif de transport de vente (`MARKET_TRANSPORT_TARIFF_MISSING`), décision métier à obtenir (voir section 7) |
| CG | ACTIVE (idem) | À faire | À faire | Même blocage attendu que CM (même cause, non rejouée) |
| YT | SUSPENDED | Hors périmètre | Hors périmètre | Ne pas rouvrir sans décision |
| DJ | PROVISIONING | Hors périmètre | Hors périmètre | Ne pas toucher |

Toutes les preuves staging réussies sont versionnées dans `docs/recette/evidence/` ; l'index se trouve dans `docs/recette/evidence/README.md`. Les captures restent dans les artefacts des runs.
L'audit économique du Hub, qui est un sujet connexe, se trouve dans `docs/audits/hub-economics-20261106/`.

Isolation croisée entre KM, CM et CG : JOUÉE le 2026-11-07, ISOLATION_PASS (run 42375312269, outil `staging-market-isolation` #3481, correctif de sonde #3484). L'agent relais, lié à un relais KM, obtient 200 sur KM et 403 sur CM et CG en lecture et en écriture ; l'admin lit les trois marchés. Preuve : `docs/recette/evidence/isolation-20261107/`. Limite : un seul rôle de terrain (agent relais) est croisé ; les rôles centraux (hub, transitaire, admin) ne sont pas cloisonnés par marché par conception, et le responsable pays E2E a des memberships dans les trois marchés, donc il ne peut pas servir à ce test.

Preuves CM et CG déjà versionnées : `docs/recette/evidence/cm-20261107/` et `docs/recette/evidence/cg-20261107/` (readiness avant activation, rapport d'activation, rapports des fixtures CM en échec). L'index de `docs/recette/evidence/README.md` ne liste que les runs réussis.

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

## 7. Prochaines actions, dans l'ordre

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

**Ne pas considérer la branche comme déployée ou la certification CM/CG comme PASS tant que la PR n'est pas mergée, que le SHA staging n'est pas aligné et que les workflows n'ont pas produit de preuves.**

Une fois le tarif CM réellement posé et relu, reprendre la procédure de la section 3 avec une fixture CM neuve (les précédentes sont inutilisables). Refaire sur CG, puis compléter les tests d'isolation avec comptes réellement cloisonnés. Ne pas ouvrir les comptes partenaires tant que les tarifs `RECETTE` subsistent. AIR_EXPRESS reste non commercialisé (registre logistics `INTERNAL/PENDING/DISABLED`) : poser le tarif ne l'expose pas.

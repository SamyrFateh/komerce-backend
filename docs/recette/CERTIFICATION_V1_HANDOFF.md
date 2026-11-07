# Certification métier V1 multi-marché : note de reprise

Cette note sert à reprendre la certification exactement où elle s'est arrêtée, sans autre contexte : tout ce qu'il faut est ici.
État au 2026-11-07, 13 h 30 (heure de Paris).

## 1. Objectif

Prouver sur le staging Railway (`https://komerce-backend-production.up.railway.app`, qui est le staging malgré son nom) que chaque marché V1 fonctionne de bout en bout :

- la chaîne achats (PO) ;
- la chaîne physique : réception Hub, sacs, KOM-BOX, expédition internationale, transitaire, douane, livraison locale, attestation relais, retrait client ;
- le circuit local : expédition Hub, réception relais, remise client.

Chaque chaîne est prouvée deux fois, d'abord par les routes HTTP réelles, puis par des clics réels dans Chromium. Chaque geste est joué par le vrai rôle.

Ensuite viendront un seed partenaires visible et des comptes partenaires cloisonnés par marché.

## 2. État par marché

| Marché | Statut | Preuve API | Preuve clics | Reste à faire |
|---|---|---|---|---|
| KM | ACTIVE | 53/53 PASS, fixture 71B671EB | 36/36 CLICK_PASS, fixture 2C2EB181, run 42369442085 | Rien pour le nominal |
| CM | Réouvert par la procédure officielle | À faire | À faire | La première fixture B13C6D97 a échoué à l'étape 1 : cause à établir |
| CG | Réouvert par la procédure officielle | À faire | À faire | Après CM |
| YT | SUSPENDED | Hors périmètre | Hors périmètre | Ne pas rouvrir sans décision |
| DJ | PROVISIONING | Hors périmètre | Hors périmètre | Ne pas toucher |

Les preuves JSON KM sont versionnées dans `docs/recette/evidence/km-20261107/` : la chaîne achats, la chaîne physique et les 36 clics. Les captures restent dans les artefacts des runs.
L'audit économique du Hub, qui est un sujet connexe, se trouve dans `docs/audits/hub-economics-20261106/`.

PR ouverte à finir : #3481, test d'isolation croisée entre KM, CM et CG. Un compte d'un marché ne doit ni voir ni modifier les données d'un autre marché.

## 3. Procédure : certifier un marché (KM, CM ou CG)

Tout passe par GitHub Actions en `workflow_dispatch`. Chaque écriture exige un mot de confirmation exact.

1. **Prérequis, en lecture seule.**
   - `staging-cert-prereq-readonly` vérifie la cible et la version servie.
   - `staging-market-readiness`, avec `markets=CM,CG`, lit le plan de contrôle du marché.
2. **Comptes de test et marqueurs.** `staging-e2e-provision` : `mode=dry-run`, puis `mode=execute` avec `extra_markets=CM,CG` et la confirmation `PROVISION-STAGING-E2E`. Ce workflow pose aussi les marqueurs dans `e2e_test_accounts`.
3. **Activation d'un marché de recette (CM ou CG).** `staging-market-activate` avec `market=<CODE>` et la confirmation `ACTIVATE-RECETTE-<CODE>`. Il exécute l'attestation puis `POST /api/admin/markets/:code/lifecycle` ACTIVE, audité par `MARKET_LIFECYCLE_CHANGED`.
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
- **Responsable opérationnel de recette pour CM et CG.** C'est le compte E2E `market_operator` (« Responsable pays »).
- **Corridors Dubaï → CM et Dubaï → CG.** Leurs valeurs sont provisoires et marquées « RECETTE » : transporteur, tarif en XAF, jours de transit, référence `RECETTE-PROVISOIRE-<marché>-<date>`. Elles doivent être remplacées par de vraies valeurs avant l'ouverture aux partenaires. Les transporteurs existants ne doivent pas être modifiés.
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

1. **CM.** Établir la cause de l'échec de l'étape 1 de la fixture B13C6D97 (run « fixture KM neuve » du 2026-11-07, 12 h 25 UTC). Lire `test-results/hub-v1-cert/hub-v1-certification-B13C6D97.json` dans l'artefact. Corriger la configuration ou le script, en PR séparée. S'il s'agit d'un choix métier, le remonter.
2. **CM, chaîne complète.** Fixture neuve, relais, `chain=po`, `chain=physical`, puis une autre fixture pour les clics. Ensuite, la même séquence pour CG.
3. **#3481.** La finir, la merger, puis la jouer avec KM, CM et CG actifs.
4. **Rapport par marché.** Readiness, tableau API, tableau Clic, valeurs provisoires posées et résultat de l'isolation.
5. **Ensuite.** Les cas limites, puis le seed partenaires visible avec plusieurs semaines d'historique par marché, puis les comptes partenaires par marché et par rôle.

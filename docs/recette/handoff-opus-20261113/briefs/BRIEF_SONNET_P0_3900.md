# Brief Sonnet ÉCO : finalisation P0 #3900 (version cadrée par Opus le 12/11/2026)

Mission d'origine : propriétaire, issue #3900, commentaire du 12/11 à 06:19. Ce brief la **confirme** et la **précise** à partir de l'état vérifié du dépôt. Objectif : **finir, pas reconstruire**.

## 0. État vérifié par Opus (ne pas re-vérifier)
- `main` = `0d438efee`. Le staging sert `a061001eb` : l'écart ne porte que sur un commit de test (#3916), donc il est **pertinent pour la certification**. Relis `/health/version` au début et à la fin.
- Déjà fusionnés et déployés :
  - **#3328** : mode manuel P11, `services/manual-scan-confirmation.js` ;
  - **#3902** : remise par code canonique de 8 caractères, saisie clavier, refus `PICKUP_CODE_REQUIRED` sur les anciens chemins, dépôt en sac `MANUAL` avec `evidence_ref`, `manual_entry` pour expédition, réception et transit ;
  - **#3901** : variantes ;
  - **#3897** : lot de corrections de la certification KM. Il apporte en particulier ce que tu dois **réutiliser** :
    - « Confirmer cette référence » quand le scan Hub renvoie `HUB_PHYSICAL_CODE_UNKNOWN` (route `/api/hub/physical-codes/confirm`) ;
    - la répartition **d'une seule commande** (bouton « Répartir » par ligne, writer `distributeOrder`) ;
    - le rattachement d'un agent à un relais depuis « Réseau local » ;
    - le droit `execution.cash.confirm` pour l'agent relais au provisioning.
- **ChatGPT exécute en ce moment la campagne G6** (#3754 ; PR #3907 à #3916 de cette nuit) sur le **même staging**.

## 1. Coexistence avec G6 (impératif)
- N'utilise **que** les comptes et objets de recette Claude :
  - identifiants : `/tmp/claude-0/-home-claude/011d1491-2f57-5b4d-98e0-a4b4e0b2f674/scratchpad/claude-par-keys/creds.json`, clés `market-operator`, `finance`, `sourcing`, `agent-hub`, `hub-director`, `agent-relais`, `agent-transitaire` et `admin`. Ne jamais afficher, journaliser ni committer un mot de passe ;
  - relais `CLAUDE-PAR Relais KM` (id `8f75adf3-…`, île Grande Comore), sur lequel notre agent relais est rattaché ;
  - marqueur `CLAUDE-PAR-20261111` sur tout ce que tu crées.
- N'agis jamais sur une commande, un colis, une PO, un sac, une KOM-BOX ou un dossier que tu n'as pas créé. Les écrans qui proposent par défaut des objets du marché (par exemple la création de dossier douane) exigent une sélection **explicite** des seuls objets à toi.
- Aucune purge, aucun reset, aucun nettoyage, aucune réaffectation d'objet existant.
- **Fusions** : le mandat du propriétaire autorise la fusion quand la CI est verte, mais **chaque fusion redéploie Railway et coupe G6**. Avant toute fusion, vérifie qu'aucun run staging de G6 n'est `in_progress` ni `queued`. Regroupe les PR prêtes dans **un seul créneau**. Après la fusion, attends que `/health/version` serve le SHA fusionné avant de certifier.
- Ne crée **aucun** stock local et n'ouvre aucun nouveau corridor pour débloquer un cas : marque-le BLOQUÉ (données).

## 2. Méthode d'exécution (leçons de #3868)
- **Chromium local** depuis le sandbox, qui joint le staging directement : `require('playwright')`, desktop en 1440 px, un contexte par rôle, `recordVideo`. Pas de boucle d'essais sur la CI. Valide d'abord les sélecteurs en lecture seule, puis fais **un seul** passage d'écriture.
- Tu peux réutiliser les scripts de la phase 2 KM : `…/scratchpad/parcours-km/lib.js` et `b2.js` (connexion par rôle, captures, utilitaires).
- Contrôles HTTP et PostgreSQL :
  - HTTP en GET avec la session du rôle ;
  - **PostgreSQL en lecture seule** via un workflow limité à ta branche, sur le modèle `.github/workflows/economic-engine-staging-readonly-census.yml` (`PGOPTIONS=default_transaction_read_only=on`, `BEGIN READ ONLY`, `target-guard`). Vérifie les états avant et après sur **tes** objets.
- Deux essais au maximum par blocage, puis note la cause exacte : données, droits, interface ou backend, avec le code HTTP.
- Aucun `route.fulfill`, aucun test `skipped`, aucun code ou preuve inventé.

## 3. P0-1 : remise client sans scanner (certification seulement, #3902 déployé)
- **Code réel** : prépare une commande de recette Claude jusqu'à « prête au retrait » au relais `CLAUDE-PAR Relais KM`, en réutilisant la chaîne prouvée sur KRJ7I90. Le code de 8 caractères s'obtient par le **parcours client réel**, avec la session du client de recette et le reveal one-shot prévu pour le client. Si la boutique n'expose pas ce geste, utilise la route de reveal **avec la session du client** et note « geste client sans écran ». N'invente jamais de code.
- Cas à prouver dans Chromium, avec relecture PostgreSQL :
  - bon code → `collected` ;
  - mauvais code → refus ;
  - 4 derniers caractères seuls → refus ;
  - code absent → refus ;
  - remise depuis un autre relais → refus. Pour avoir un second agent, utilise l'agent relais E2E d'une autre fixture **seulement en lecture**, ou rapporte BLOQUÉ si aucun agent Claude n'existe sur un autre relais. Ne réaffecte personne ;
  - seconde remise → refus ;
  - retrait partiel sur une commande à **plusieurs colis**, avec rotation du secret. Si la répartition ne produit qu'un colis pour ta commande, essaie une commande multi-lignes ; sinon BLOQUÉ (données), sans forcer ;
  - **timeout après commit** : laisse la requête atteindre le serveur, puis interromps la réponse côté client (`route.fetch()` puis `route.abort()`, ce qui n'est pas un mock du backend). Le rejeu doit se réconcilier sans double retrait, et l'interface ne doit jamais afficher un succès non confirmé ;
  - anciens chemins (`scanParcel('collect')`, V2 `event_type=collected`) → `PICKUP_CODE_REQUIRED`, prouvé en HTTP avec la session de l'agent.

## 4. P0-2 : mode manuel sur toute la chaîne (lacunes résiduelles identifiées)
Règle : **le scanner et la saisie manuelle passent par le même writer et les mêmes contrôles**. La provenance réelle (`SCAN` ou `MANUAL`/`manual_confirmation`) est conservée, et une saisie clavier n'est **jamais** enregistrée comme scan.

| Étape | État relevé dans le code | À faire |
|---|---|---|
| Réception fournisseur Hub | `evidence_code` exigé par ligne (`public/dashboards/canonical/js/operations-workspace.js` l.481 / l.491 / l.635). Référence inconnue couverte par #3897 | Vérifier qu'une **saisie clavier** est acceptée et que la provenance stockée n'est pas `SCAN`. Corriger si besoin |
| Dépôt en sac | `SCAN` / `MANUAL` + `evidence_ref` (l.1251, #3902) | Certifier seulement |
| **Sac → KOM-BOX** | `bag_reference_scan` / `box_reference_scan` sans mode (l.1330 ; `services/hub-bag-box-service.js` l.63-75 ; `routes/admin-operations-workspace.js` l.473) | **Lacune probable** : une saisie manuelle est stockée comme « scan ». Ajouter la provenance avec le même writer. Si une colonne est nécessaire, migration **additive** minimale, conforme à AGENTS.md |
| Remise transitaire, transit, douane | `manual_entry` « Saisie manuelle volontaire » (l.2062, #3902) | Certifier : référence, rôle, justificatif, transition |
| Réception relais | Identification du sac par un champ « Scanner » | Vérifier la saisie clavier, les quantités, l'attestation et la provenance |
| Retours / SAV | Reprise physique idempotente, déjà prouvée sur KRJ7I90 (#3868) | Certifier le mode manuel et la justification |
| Panne réseau | — | Même méthode que le timeout P0-1, au moins sur un geste Hub |

Refus à prouver à chaque étape corrigée : autre marché, autre relais, mauvaise référence, quantité incorrecte, double opération.

## 5. Livraison
- Une PR par domaine (Hub sac → KOM-BOX ; réception ; relais ; etc.), avec un correctif minimal et des tests ciblés. `pr:preflight` et « Required verdict » doivent être verts sur la tête exacte. Fusion selon le §1.
- Contraintes de mécanique du dépôt :
  - `gh pr` et `gh pr merge` passent par GraphQL, qui est bloqué : utilise `gh api` REST, et vérifie `merged: true` ;
  - corps de PR avec `## Pourquoi`, `## Quoi`, `## Tests`, `## Reprise` ;
  - la règle du dépôt exige « Required verdict » sur une tête **à jour avec main** : après chaque fusion, les autres PR doivent être rebasées. Préfère une PR d'intégration si tu en as plusieurs.
- Commits terminés par :
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi
- PR et commentaires terminés par :
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi

## 6. Clôture
- Commente l'issue #3900 avec la matrice `Étape | Scanner | Manuel | HTTP | PostgreSQL | Chromium | Verdict`. Une étape n'est PASS que si les preuves existent réellement : run, artefact, vidéo, SHA.
- Si toutes les étapes sont PASS, clôture #3900 et reporte le GO dans G6 #3754. Sinon, laisse #3900 ouverte et liste les seuls blocages restants.
- Escalade vers Opus uniquement pour une contradiction métier ou un blocage d'architecture. Avant de t'arrêter, quelle qu'en soit la raison, pousse tout et mets à jour les sections `## Reprise`.
- Compte rendu final, dans ce format uniquement : PR créées ou fusionnées, contrôles verts et rouges, étapes certifiées, blocages résiduels, verdict GO / NO GO.

## 7. Passe de certification (ajout Opus, 12/11 à 12h)
- Le correctif P0-2 est fusionné (#3923) et déployé : le staging sert `8419b6685`. **Rien d'autre à coder**, sauf un défaut nouveau révélé par la passe : PR séparée, sans fusion, et rapport à Opus.
- Cette passe sert **aussi de recertification KM** (#3868) : chaîne complète sur une **commande neuve** Claude, du produit publié à la remise, puis retour et SAV.
- Réutilise :
  - les scripts `…/scratchpad/parcours-km/lib.js` et `b2.js` (connexion par rôle, captures) ;
  - le déroulé prouvé sur KRJ7I90 (issue #3868, commentaire 6801930033) ;
  - les nouveaux gestes en place : « Confirmer cette référence », « Répartir » par ligne.
- **Code de retrait** : le geste client réel (reveal one-shot avec la session du client) a la priorité. À défaut, la méthode de #3920 : émission par le service canonique `ensureSecretGenerated` sur **notre** commande, via un workflow limité à ta branche, masqué, jamais journalisé.
- **PostgreSQL en lecture seule** : crée le workflow sur ta branche, sur le modèle de `economic-engine-staging-readonly-census.yml`, en ne lisant que nos objets (référence de commande, sac, KOM-BOX, provenance `SCAN`/`MANUAL`, scans de collecte, `pickup_secret`, SAV).
- Mode manuel : **chaque geste physique est fait en mode MANUAL dans l'interface**, avec une justification. Les contrôles relisent ensuite la provenance stockée.
- Budget : 120 minutes. Pousse, puis commente #3900 et #3868 avant de t'arrêter.

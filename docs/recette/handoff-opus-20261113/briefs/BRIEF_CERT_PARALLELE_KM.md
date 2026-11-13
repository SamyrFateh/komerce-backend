# Brief commun — certification Chromium parallèle Claude (KM d'abord)

Propriétaire : SamyrFateh. Consigne du 11/11/2026. Coordinateur : Opus. Exécutants : Sonnet, en mode ÉCO strict.

## Objet
Certification **indépendante et parallèle** de celle de ChatGPT. On rejoue tout, de bout en bout, avec **nos propres commandes et fixtures**, sans s'appuyer sur ses runs verts. Une CI verte ou un test API seul ne vaut **pas** certification : seule compte la preuve Chromium, complétée par des relectures API et PostgreSQL.

## Cible
- Staging : `https://komerce-backend-production.up.railway.app`. Il est joignable depuis le sandbox. Vérifie `/health/version` au début et à la fin de chaque campagne, et note le commit testé : `c16b28a7b` au lancement.
- **Les écritures de recette sur le staging sont autorisées.** Les comptes, secrets et URL de base de données ne sont accessibles que dans **GitHub Actions**. Toute écriture ou session de rôle passe donc par un workflow, jamais par une base locale.

## Coexistence avec ChatGPT (règles strictes)
1. **Identifier ses campagnes avant chaque déclenchement** : runs `in_progress` et `queued` (`gh api repos/SamyrFateh/komerce-backend/actions/runs?status=in_progress`), issues ouvertes `[staging-op] …`. Au lancement, sa campagne G6 est en cours : commande `KUYIYUK`, workflows G6 et issues #3856 à #3867.
2. **Ne jamais agir sur un objet que nous n'avons pas créé** : commande, fixture, PO, colis, KOM-BOX, retour. Tout ce que nous créons porte le marqueur de campagne `CLAUDE-PAR-20261111` (ou `CLPAR`, selon le champ autorisé), noté dans le rapport.
3. **Concurrence** : avant tout `workflow_dispatch`, lis le bloc `concurrency` du workflow. S'il a `cancel-in-progress: true` et qu'un run de GPT tourne dans le même groupe, **attends**, car tu annulerais son run. S'il a `false`, ton run passe en file d'attente, et c'est acceptable.
4. **Interdits** : aucune purge, aucun reset, aucun workflow de nettoyage ou de retrait (`*cleanup*`, `*retire*`, `*reset*`), et aucun `mode=execute` de `staging-e2e-provision` qui réécrirait des comptes existants sans vérification préalable en dry-run.
5. **Déploiement** : un merge sur `main` redéploie Railway et peut interrompre les tests de GPT. **Ne merge rien sur `main`.** Les correctifs se font dans une branche dédiée, en PR ouverte. Si un correctif doit être déployé pour débloquer un scénario, **arrête-toi et rapporte à Opus**, qui coordonnera.
6. Ne modifie jamais directement la base pour contourner un blocage métier.

## Méthode
- Lis d'abord les preuves et la documentation existantes : `docs/recette/CERTIFICATION_V1_HANDOFF.md`, `docs/recette/FULL_CERT_CM_CG_AUTOMATION.md`, `docs/recette/evidence/` (README, `STAGING_G234_20261110.md`, `LOCAL_STOCK_DIRECT_RELAIS_KM_CM_CG_20261107.md`), et les workflows `staging-market-full-certification.yml`, `hub-v1-clicks-staging.yml`, `staging-relay-local-native-clicks.yml`, `staging-e2e-provision.yml`. **Réutilise les harnais existants** en les relançant sur des fixtures neuves. N'écris de nouvelles specs que pour les étapes non couvertes.
- Navigateur : Chromium et Playwright desktop, une session distincte par rôle, actions métier faites **dans l'interface**. Une préparation par API canonique est permise.
- Preuves par scénario :
  - vidéo continue et captures utiles ;
  - identifiants des commandes ;
  - assertions sur les lignes, quantités, montants, statuts et historiques à chaque passage d'un rôle à l'autre ;
  - relecture complémentaire API et PostgreSQL, en lecture seule.

  Toutes ces preuves vont en artefacts GitHub Actions.
- Pour un nouveau harnais, crée un workflow `push` sur ta branche dédiée, uniquement ta branche (`branches: [<ta-branche>]`) et uniquement tes fichiers (`paths`). C'est le modèle de `.github/workflows/economic-engine-staging-readonly-census.yml`. Utilise les secrets existants que le workflow modèle référence, sans jamais les afficher.
- **Moteur de revient** : relève la configuration et les anomalies, sans rien changer à la doctrine économique pour faire passer un test.
- **Fonction absente** : signale-la telle quelle, sans inventer son fonctionnement.
- Pour chaque blocage, donne sa cause précise : données, droits, interface ou backend.

## Mécanique du dépôt
- `gh pr` passe par GraphQL, qui est bloqué. Utilise l'API REST (`gh api …`), y compris pour `workflow_dispatch` : `gh api -X POST repos/SamyrFateh/komerce-backend/actions/workflows/<file>/dispatches -f ref=<branche> -f inputs[…]=…`.
- Le hook de pre-push exige `npm run pr:preflight`. Ne contourne jamais un hook.
- Pour les PR : sections `## Pourquoi`, `## Quoi`, `## Tests` et `## Reprise` obligatoires.
- Commits terminés par :
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi
- Corps de PR et d'issue terminés par :
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi
- Ne lis, n'affiche et ne persiste jamais de token ni de secret.

## Rendu
- Une issue de suivi commune, **« Certification Chromium parallèle Claude — KM »**. Le premier agent qui démarre la crée ; l'autre la retrouve par son titre et la commente.
- Pour chaque scénario : PASS, FAIL ou BLOQUÉ, commit testé, commandes, lien du run, lien de l'artefact, contrôles complémentaires et défauts restants.
- **Ne passe pas à CM ni à CG** : c'est Opus qui valide KM d'abord.
- Avant de t'arrêter, quelle qu'en soit la raison, pousse tout et commente l'issue (état, dernière action, prochaine action).

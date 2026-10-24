# STAGING-CANON — cycle de recette et nettoyage sélectif

## Décision
Staging est l'unique environnement de recette opérationnelle. Ne jamais doubler les règles métier, services, KPI ni le checkout. Le mode RCT1 dans les dashboards ne constitue pas une preuve P1–P7.

## Injection existante (aucun nouvel injecteur)
Point d'entrée existant : `scripts/recette/rct1/cli.js`.
Phases : `plan`, `dry-run`, `apply`, `verify`, `replay`, `report`.
Le moteur `scripts/recette/rct1/engine.js` utilise des étapes déclaratives et le garde de cible `scripts/recette/target-guard.js`; le checkout commande fait appel à `runOrderCheckout` avec `internalSimulation.scope='RCT1'`.

Avant toute écriture :
1. Confirmer l'environnement Railway staging **et l'empreinte effective de la base** contre `STAGING_BASE_URL/health`.
2. Exécuter `node scripts/recette/rct1/cli.js inventory`, puis `plan` et `dry-run`.
3. Vérifier les prérequis de toutes les étapes et les effets externes possibles. La recette n'autorise aucun paiement réel, message externe ou engagement fournisseur réel.
4. `apply` ne peut être autorisé qu'après revue des écarts et du périmètre d'écriture (à ne pas exécuter implicitement par CI).
5. `verify`, `replay` et `report` produisent des preuves, puis comparer chaque dashboard canonique aux mêmes données.

## Inventaire de nettoyage (nouveau contrôle)
`node scripts/recette/staging-campaign-audit.js` : lecture seule stricte ; compare les marqueurs **exacts** des commandes, produits, utilisateurs et relais du manifeste RCT1, expose les FKs entrantes et refuse toute suppression.

Le rapport est volontairement **bloquant** pour la suppression tant qu'il manque la preuve ligne par ligne que chaque enregistrement dépendant appartient intégralement à la campagne ; l'inventaire des FKs seul ne suffit pas pour déduire les lignes à effacer. Une relation externe/non attribuable doit provoquer HOLD. Ne jamais utiliser `TRUNCATE CASCADE` ni suppression par simple motif `LIKE 'RCT1%'` pour prétendre nettoyer toutes les données.

## Outils hérités — ne pas confondre les usages
- `cleanup-e2e-staging.js` cible les utilisateurs `e2e%@komerce.test` et des dépendances spécifiques. Il n'est **pas** un nettoyeur RCT1.
- `controlled-business-purge.js` purge des familles métier entières : **interdit** pour effacer seulement RCT1.
- `staging-clean-room-reset.js` vide catalogue/sourcing : **hors périmètre**.
- `staging-central-authority-cleanup.js` gère les habilitations centrales : **hors périmètre**.

## Conditions d'acceptation du futur nettoyeur sélectif
- Cible staging vérifiée, dry-run transactionnel, identifiants exacts, inventaire complet de descendants FK et relations non-FK.
- Aucune ligne fondamentale (marchés, change, référentiel, règles, utilisateurs non créés par la campagne, configuration, preuves de certification) supprimée ni modifiée.
- Tableaux de nombres attendus/observés avant et après ; opérations atomiques, arrêt au moindre écart.
- Test sur **base jetable avec migrations réelles**, injection → vérification dashboard → nettoyage → vérification invariants/fondation et rejouabilité.
- Suppression réelle du staging seulement après revue explicite du rapport de suppression, et après validation de la campagne. Ce lot ne contient aucune opération de suppression.

## Statut du lot
L'inventaire de provenance et des FKs et ses tests unitaires sont implémentés ; l'exécution sur staging, la classification de toutes les dépendances et la suppression transactionnelle restent **non certifiées**. Cette limitation est volontaire : ne pas confondre tests unitaires/mocks avec preuve d'intégrité SQL réelle.

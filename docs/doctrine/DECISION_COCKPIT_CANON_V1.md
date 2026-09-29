# Canon Decision Cockpit V1

## Intention

Un dashboard Canonical sert à **piloter**. Il ne reproduit ni un journal technique, ni un workspace, ni une table exhaustive.

La hiérarchie obligatoire est :

1. **Situation** — où en est le domaine ?
2. **Décisions ouvertes** — quelles actions humaines sont réellement attendues ?
3. **Exceptions** — qu'est-ce qui bloque ou sort du parcours normal ?
4. **Drill-down** — pourquoi ? avec les données suffisantes pour décider.
5. **Raw / technique** — uniquement sur demande explicite.

## Règle de densité

Une information automatique et saine ne mérite pas une carte au niveau 1.

Exemples :
- une Raffinerie verte n'est pas un KPI de cockpit ;
- une certification réussie n'est pas une action ;
- une taxonomie déjà résolue n'est pas une alerte ;
- un détail fournisseur n'est pas visible tant qu'il ne modifie aucune décision.

Le niveau 1 doit pouvoir être lu en quelques secondes.

## Une carte = une question = une page

Chaque carte décisionnelle doit :
- représenter une vérité serveur ;
- porter un nombre ou un état directement actionnable ;
- être entièrement cliquable ;
- ouvrir une page complète filtrée sur cette question ;
- ne jamais enfermer une mini-application scrollable dans la carte.

## Vérité serveur

Le navigateur ne recalcule jamais :
- readiness ;
- clôture ;
- sévérité ;
- décision finale ;
- exposition réelle ;
- santé métier.

Les agrégats sont projetés côté serveur depuis les autorités canoniques.

UNKNOWN reste UNKNOWN. Une donnée absente ne devient jamais zéro.

## Cockpit Import — référence initiale

Le KIR est le registre de provenance et de décision.

Un lot est **CLOS** seulement si :
- l'import est terminé ;
- aucune exception ouverte ne subsiste ;
- chaque produit transmis au Catalogue a une décision terminale.

Décisions terminales :
- **APPROVED_FOR_SALE** : exposition marché ENABLED + prix local LOCAL_ACTIVE sur au moins un marché ;
- **NOT_RETAINED** : rejet Catalogue explicite ou décision DISABLED sur tous les marchés actifs.

Les rejets/différés amont restent traçables dans le lot mais ne polluent pas le Catalogue commercial.

## Frontières

- **Cockpit Import** : point d’entrée du parcours Sourcing → Catalogue. Il montre le registre KIR, les actions ouvertes, la clôture et un **contrôle compact ON/OFF de l’autopilot des sources**. Il ne réplique jamais les capacités détaillées Discovery/Sync/Import/Production : celles-ci restent dans le Workspace Sourcing.
- **Sourcing Workspace** : configuration détaillée des sources, fournisseurs, candidats, corrections, capacités provider et déclenchements manuels. Il ne duplique pas l'historique KIR ; la santé d'architecture n'apparaît qu'en diagnostic explicite.
- **Catalogue Workspace** : curation Catalogue et **Catalogue global commercial**. Il ne réaffiche ni Raffinerie, ni sources LIVE, ni pipeline d'import.
- **Marché / Prêts à vendre** : décision commerciale locale, corridor et prix.

Le **Catalogue global commercial** est la somme dédupliquée des produits ayant reçu une décision positive de vente dans un KIR clos. Une simple ligne `products.is_active`, une publication globale ou une exposition sans prix local actif ne suffisent pas.

Une même information n'est pas reproduite dans plusieurs surfaces au même niveau.

## Catalogue global commercial

La cible de lecture métier est l'assortiment approuvé issu des lots clos. Le référentiel technique peut conserver des drafts, candidats et historiques ; ils ne doivent pas être confondus avec l'assortiment commercial.

La projection commerciale doit donc rester distincte de la simple table `products`.

## Application aux autres domaines

Pour chaque dashboard :
- supprimer les métriques sans décision associée ;
- regrouper les actions par question métier ;
- rendre les cartes entièrement navigables ;
- déplacer l'exhaustivité vers les pages de drill-down ;
- masquer la technique saine ;
- conserver les exceptions explicites ;
- préférer 3 à 5 décisions fiables à 12 KPI décoratifs.

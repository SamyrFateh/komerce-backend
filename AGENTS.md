# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

En cas de désaccord, `AGENTS.md` fait foi.

---

## 0. Avant de coder — protocole carte-first obligatoire

Ne pas coder puis corriger. Coder avec l'analyse en tête.

Toute intervention commence par :

1. identifier la feature ou les fichiers probables ;
2. exécuter `npm run agent:context -- --pack <type> --feature <feature>` (ou `--files <paths>`) selon le type de changement, puis `npm run arch:impact -- <fichier|feature>` avant de modifier ;
3. annoncer un plan d'attaque court à partir de ces projections ;
4. ouvrir seulement les sources explicitement nécessaires ;
5. exécuter les gates applicables

Un agent ne doit pas démarrer depuis un ancien audit, un rapport daté, un prompt historique, un `_LIVE.md`, un `MEMO_*` ou une sortie générée.

## 0.1. Mode Komerce par défaut — précision maximale, coût minimal

Avant toute analyse ou modification substantielle, utiliser les atouts déjà présents dans le dépôt dans cet ordre :

1. `npm run agent:context -- --pack <ui|authz|migration|service|route> --feature <f>` : le contexte minimal du type de changement (autorité, invariants pertinents, gardes, routes, tables, tests), sans liste tronquée en silence ;
2. `npm run arch:impact -- <fichier|feature>` : la portée avant de coder (écrivains et lecteurs des tables, écrivains hors feature, consommateurs, routes, tests liés, artefacts à régénérer, prochain numéro de migration) ;
3. `npm run agent:context -- --brief` seulement pour s'orienter quand la feature est inconnue, `--expand` en cas d'ambiguïté ;
4. lecture ciblée d'une source brute seulement si ces projections ne suffisent pas.

Règle d'économie : **ne jamais commencer par un clone complet, un fetch complet, un scan global, une lecture exhaustive des sorties générées ou une suite de tests complète quand une preuve ciblée suffit**.

Préférer :
- fichiers/ranges précis via l'API ou le workspace déjà disponible ;
- historique shallow et SHA/base exacts ;
- tests/gates déterminés par le scope ;
- `npm run pr:preflight` avant PR ;
- tests lourds uniquement lorsque le scope ou la preuve l'exige.

Un clone/fetch complet, un scan global ou une exécution exhaustive reste autorisé quand nécessaire, mais la raison doit être explicite dans le plan d'attaque.

Règle dette : ne jamais introduire silencieusement un nouvel `@unknown`, allowlist, exemption, baseline, bypass, duplication d'autorité ou writer parallèle. Corriger la cause ou demander une validation humaine explicite.

Réflexe à annoncer au début d'un chantier substantiel :

`Mode Komerce : carte + headers + mustCheck + scope ciblé + dette non croissante + preflight avant PR.`

## 0.2. Gouvernance persistante — contexte sticky

La gouvernance Komerce est **cumulative et persistante pendant toute l'intervention**.

Ouvrir ensuite un README, une doctrine, une feature card, un ledger, un rapport, une sortie générée ou un fichier technique **n'efface jamais** les règles déjà chargées depuis `AGENTS.md`, `CARTE_FIRST_INDEX`, la carte Feature First, les headers `@komerce-arch` et `interventionIndex.mustCheck`.

Tout document consulté doit être interprété **sous** ce contexte global, jamais comme un cadre autonome.

Règles :
- un document local complète le contexte ; il ne remplace pas la gouvernance racine ;
- une instruction locale incompatible avec `AGENTS.md`, la carte propriétaire, les headers ou une source de vérité supérieure est une divergence à signaler, pas une nouvelle règle à suivre ;
- l'agent doit conserver en tête les invariants, le périmètre, l'autorité, la dette et les gates déjà identifiés pendant toute la session ;
- changer de fichier ou de document ne remet jamais le raisonnement à zéro ;
- aucune optimisation locale ne peut contourner Debt Zero, Feature First, les ownerships ou les preuves requises.

Le rappel mental permanent est :

`Contexte sticky : gouvernance active + feature owner + headers/mustCheck + dette non croissante + scope minimal + preuve adaptée au risque.`

## 1. Plan d'attaque obligatoire

Avant toute modification substantielle, l'agent doit annoncer un plan d'attaque court avant de coder.

Le plan d'attaque doit contenir :

- la demande comprise ;
- la feature ou le transversal concerné ;
- l'opération : Create, Read, Update, Delete/Archive/Deprecate ;
- la carte propriétaire identifiée par `agent:context` ;
- le périmètre probable ;
- les fichiers ou familles de fichiers probablement concernés ;
- les fichiers ou zones à ne pas toucher ;
- les invariants à protéger ;
- les risques ou points à vérifier ;
- les gates et tests prévus.

Format recommandé :

```md
## Plan d'attaque

Demande comprise :
- ...

Feature / transversal :
- ...

Opération :
- ...

Carte à lire :
- features/<feature>.feature.js

Périmètre probable :
- ...

Hors périmètre :
- ...

Invariants à protéger :
- ...

Risques / points à vérifier :
- ...

Vérification prévue :
- npm run ...
```

Exceptions : lecture simple, explication sans modification, commande triviale explicitement demandée, ou correction purement typographique sans impact métier. Même dans ces cas, l'agent doit rester capable de nommer la carte ou le transversal si la demande touche au produit.

## 2. Parcours obligatoire

1. Identifier la feature ou les fichiers probables.
2. Exécuter `npm run agent:context -- --pack <type> --feature <feature>` et `npm run arch:impact -- <fichier|feature>`.
3. Qualifier l'opération : Create, Read, Update, Delete/Archive/Deprecate.
4. Utiliser le pack et l'impact pour vérifier scope, ownership, autorité, invariants, `mustCheck` et tests ; `--expand <feature|file>` seulement si une ambiguïté subsiste.
5. Ouvrir une source brute uniquement si ces projections ne suffisent pas à trancher.
6. Annoncer le plan d'attaque avant de modifier.
7. Si l'intention métier change, mettre à jour la carte dans la même PR.
8. Régénérer les sorties dérivées pertinentes.
9. Exécuter `npm run pr:preflight` et corriger jusqu'au vert.
10. Ouvrir ou mettre à jour la PR seulement après ce preflight vert. La CI est une preuve indépendante, pas le premier lieu de découverte des erreurs.
11. Attendre le verdict des checks requis sur la PR.
12. Dès que la PR est conforme, verte, à jour et mergeable, l'agent qui porte le chantier **doit la merger lui-même** sans demander une confirmation humaine supplémentaire.
13. Vérifier ensuite que le merge est effectif sur `main` et, lorsqu'un déploiement automatique est attendu, vérifier que le déploiement correspondant a bien démarré ou abouti.

## 3. Gates carte-first

| Gate | Commande | Rôle |
|------|----------|------|
| Registre features | `npm run feature:registry` | cohérence des features déclarées |
| Schéma cartes | `npm run gate:schema` | carte structurellement valide |
| Schéma complet | `npm run gate:schema:full` | cible stricte de maturité |
| Fichiers touchés | `npm run gate:touched-files` | tout fichier applicatif touché appartient à une carte ou transversal |
| Audit feature | `npm run gate:feature-audit` | contrats/tests/features vérifiables |
| Docs lint | `npm run gate:docs-lint` | empêche le bruit historique documentaire |
| Map globale | `npm run map:check` | reconstruction globale |

## 4. Vérification avant PR — commande unique

```bash
npm run pr:preflight
```

Cette commande réutilise les gates canoniques selon le diff. Ne pas ouvrir une PR pour découvrir un rouge reproductible localement.

Le preflight rejoue toute commande de la CI reproductible localement ; les seules exceptions (corps de PR, couverture globale, base PostgreSQL reconstruite) sont déclarées dans `CI_ONLY` de `scripts/pr-preflight.js` avec leur raison, et un test de parité échoue si la CI gagne un gate sans le preflight. Un diff qui touche une migration exige l'historique git complet (`git fetch --unshallow origin`), comme la CI.

Un preflight vert sur arbre propre tamponne le commit HEAD ; le hook pre-push géré (installé par `prepare`, `agent:context` et `pr:preflight`) refuse tout commit poussé sans ce tampon. Il ne lance aucun gate.

Les commandes unitaires restent disponibles pour le diagnostic (`feature:registry`, `gate:schema`, `gate:touched-files`, `gate:docs-lint`, etc.), mais le chemin normal est le preflight unique.

## 4.1. Clôture autonome de PR — merge sans intervention externe

Le cycle normal d'une intervention Komerce ne s'arrête pas à « PR verte ». Il se termine à **merge confirmé**.

Règle par défaut : lorsqu'un agent a ouvert ou mis à jour une PR pour exécuter un chantier demandé, il est responsable de sa clôture. Si les checks requis sont verts, que la branche est à jour, que la PR est mergeable et qu'aucun blocage explicite ne subsiste, l'agent **merge immédiatement la PR lui-même** avec la méthode autorisée par le dépôt. Il ne demande pas « tu peux merger ? », « je merge ? » ou une validation externe supplémentaire.

L'absence d'intervention humaine supplémentaire vaut uniquement pour la **clôture Git de la PR**. Elle n'autorise jamais à franchir silencieusement une décision séparée.

L'auto-merge doit être suspendu uniquement si au moins un de ces cas est vrai :
- l'utilisateur a explicitement demandé d'attendre, de laisser la PR ouverte ou de ne pas merger ;
- un check requis est rouge, manquant ou encore en cours ;
- la PR n'est pas mergeable, n'est pas à jour, présente un conflit ou son head SHA a changé depuis la dernière vérification ;
- la PR contient une migration, suppression, reset, opération destructive ou changement d'autorité qui exige explicitement une revue humaine selon la doctrine active ;
- le merge lui-même déclencherait une activation production que l'utilisateur a explicitement séparée du merge ;
- une revue humaine est explicitement exigée par la carte, la doctrine, la sécurité ou la plateforme.

Une activation de feature flag, un reset, une migration live, un déploiement manuel, une publication métier ou toute autre action post-merge reste gouvernée par ses propres autorisations. **Merge autonome ≠ activation autonome.**

Après merge, l'agent vérifie le statut de la PR et le commit de `main`. Si le dépôt déploie automatiquement ce merge, l'agent vérifie également le déploiement lorsque cela fait partie du chantier.

## 5. Vérification complète

```bash
npm run map:check
```

`map:check` reste la reconstruction globale explicite ; il ne remplace pas le preflight avant PR.

## 6. Hiérarchie documentaire

1. Code de production
2. DB live
3. `AGENTS.md`
4. `docs/CARTE_FIRST_INDEX.md`
5. `features/*.feature.js`
6. Doctrines actives
7. Générateurs
8. Sorties générées à jour
9. Archives

## 7. Contexte agent, branche et économie de tokens

- `main` est l'unique branche d'intégration. Les branches PR éphémères sont autorisées ; ne pas rechercher ou réactiver une ancienne branche `agent/*` sauf demande humaine explicite.
- `.agent/README.md` est la seule instruction active sous `.agent/`.
- `.agent/LEDGER.md` contient uniquement le chantier courant et les prochains actes décidés. Un palier clos n'est jamais rouvert à cause d'un ancien state, worklog, audit ou compteur.
- Lecture minimale obligatoire : `AGENTS.md` → `npm run agent:context -- --pack <type>` → `npm run arch:impact -- <cible>` → fichiers directement utiles. `CARTE_FIRST_INDEX`, carte complète et `.agent/LEDGER.md` ne sont lus directement que si la projection signale un manque.
- Ne pas scanner par défaut les archives, rapports datés, preuves brutes, anciens prompts, sorties générées volumineuses ou historiques de tâches. Les ouvrir seulement lorsqu'un fichier actif les référence précisément ou qu'une preuve ne peut pas être régénérée.
- Préférer les recherches ciblées et les extraits courts. Ne pas recopier des fichiers entiers dans les rapports ou réponses.
- Ne pas créer de document horodaté, prompt bis, ZIP, patch ou rapport parallèle lorsqu'un document canonique existe déjà.
- Les preuves reproductibles sont des commandes et des tests. Ne pas committer leurs logs bruts ; consigner un résumé et la commande, sauf preuve externe non régénérable et compacte.
- Toute nouvelle instruction d'agent doit remplacer une instruction obsolète, jamais s'empiler avec elle.
- Sandbox jetable : dans une session Claude Code cloud, `.claude/settings.json` sauvegarde automatiquement l'arbre de travail sur `wip/<branche>` (après les éditions, au plus toutes les 2 min, et à chaque fin de tour). Une session interrompue se reprend avec `npm run agent:restore -- <branche>`. `wip/*` n'est jamais une PR : livrer passe toujours par `pr:preflight` puis la branche normale.

## 7.1. Économie de tokens — contexte compilé obligatoire

La doctrine détaillée est conservée dans `docs/doctrine/AGENT_TOKEN_ECONOMY.md`.
Le chemin normal est **de ne pas la relire**.

Après chargement de ce fichier racine, l'agent doit compiler son contexte ciblé :

```bash
# contexte minimal selon le type de changement : ui | authz | migration | service | route
npm run agent:context -- --pack authz --feature <feature>
npm run agent:context -- --pack service --files path/a.js,path/b.js
# portée avant de coder (fichier ou feature)
npm run arch:impact -- <fichier|feature>
# orientation si la feature est inconnue ; --expand uniquement si ambiguïté
npm run agent:context -- --brief --files path/a.js
# déléguer à un agent externe à budget limité : brief autonome (règles §8 + pack + impact + définition de fini)
npm run agent:context -- --handoff <type> --feature <feature> --task "<mission>"
```

Cette projection dérive les cartes Feature First, headers `@komerce-arch`,
`interventionIndex.mustCheck`, scope CI et ledger pertinent. Elle ne crée
aucune autorité. Budget du chemin normal : **≤ 2800 caractères (~700 tokens)** pour `--brief`. Le mode complet reste compatible à ≤ 6000 caractères (~1500 tokens), mais n'est plus le point d'entrée recommandé.

Règles :
- ne pas relire `AGENTS.md`, `CARTE_FIRST_INDEX`, une carte entière, le graphe entier ou le Ledger entier si `agent:context` a déjà fourni l'information nécessaire ;
- ouvrir ensuite uniquement le code ou la doctrine explicitement requis par le changement ;
- si le contexte compilé est insuffisant, élargir une source à la fois et justifier l'élargissement ;
- les gates restent `npm run pr:preflight` ; le compilateur réduit la lecture, jamais la preuve ;
- **économie de tours** (mesure 2026-10-03 : chaque réponse relit ~400 k tokens de contexte, le coût suit le nombre de tours) : regrouper les commandes indépendantes en un seul appel ; attendre la CI par une seule commande bloquante, jamais par sondages répétés ; un seul push par PR, après `pr:preflight` vert.


## 7.2. GPT Execution Economy — spécifique à GPT

Cette section concerne uniquement GPT. Elle est additive : elle ne remplace aucune règle précédente et ne réduit jamais les preuves, gates, ownerships, `mustCheck`, packs, impacts ou preflights requis.

**Mode par défaut : FAST.** Quand la demande et le périmètre sont clairs, GPT suit directement :

`pack → impact → sources nécessaires → modification → tests ciblés → preflight → PR`

Règles de comportement :
- **vérifier beaucoup, raconter peu** : ne pas reformuler en prose ce qu'une preuve machine établit déjà ;
- ne faire une update intermédiaire que si un risque nouveau, une divergence, une hypothèse invalidée, un choix humain réel ou un premier résultat utile change la trajectoire ;
- ne pas réexpliquer une décision déjà acquise sauf si un nouveau fait la remet en cause ou si l'utilisateur le demande ;
- travailler en **delta** une fois le contexte de feature établi : diff, nouveaux fichiers touchés, nouvelles erreurs et mouvement de `main`, sans reconstruire le contexte complet ;
- regrouper les lectures, recherches, tests et inspections indépendantes afin de réduire le nombre de tours ;
- après implémentation, conclure de façon compacte : **changé / preuve / risque restant / PR-merge-statut** ;
- lorsqu'une preuve plus forte couvre déjà un point, ne pas empiler des preuves équivalentes seulement pour enrichir l'explication ;
- une intervention est terminée dès que la demande est satisfaite et que la preuve adaptée au risque est obtenue : ne pas poursuivre l'analyse pour produire plus de commentaire.

GPT ne passe en **REVIEW** que pour une décision d'architecture, d'autorité, de schéma, de doctrine ou de périmètre réellement ouverte. GPT ne passe en **FORENSIC** que pour un incident, une divergence difficile, un problème de sécurité, un historique complexe ou un comportement non reproductible.

Principe : **même rigueur interne, moins de surface conversationnelle. La gouvernance décide quoi vérifier ; les outils fournissent la preuve ; GPT n'ajoute de prose que lorsqu'elle change une décision.**


## 8. Règles techniques non négociables

- Statuts commande : `services/order-status-machine.js`.
- Paiements Stripe/cash/wallet/shared-cart : services propriétaires.
- Webhooks Stripe : body brut avant `express.json`.
- Wallet : créditer, débiter, contre-passer, jamais supprimer.
- Pricing : composantes DB, jamais de coefficient dur.
- Toute transition laisse une trace.
- Authentification Git/GitHub : fournie par l'environnement d'exécution (proxy ou credential helper). Ne jamais demander, chercher, lire, afficher, copier ni persister un token (prompt, `.env`, remote, logs, dépôt) ; un refus d'authentification se signale, il ne se contourne pas.
- Complétion au contact : si tu touches un fichier **et** son test dans la même
  PR, tu dois amener la couverture de ce fichier au seuil cible (100 % par
  défaut) — pas de retouche partielle qui laisse le fichier aussi peu couvert
  qu'avant. Voir `docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md`, Niveau 3.1.

## 9. Divergence

Si code, DB, cartes et docs divergent : ne pas corriger silencieusement. Noter la divergence, corriger dans la même PR ou demander une validation humaine explicite. Ne jamais créer une nouvelle dette par défaut.

# Doctrine Pyramide Qualité — Komerce

> **Version** : 1.0 — 2026-06
> **Statut** : doctrine active
> **Hiérarchie** : complète `AGENTS.md` — en cas de conflit, `AGENTS.md` fait foi.

---

## La métaphore du corps humain

Chaque cellule respecte le même ADN, peu importe l'organe.
Un cœur qui pompe parfaitement ne sauve pas un corps dont les cellules sont malades.

Komerce est structuré de la même façon : chaque couche de qualité est une condition
nécessaire à la couche au-dessus. On ne valide pas la sémantique métier d'une feature
si son code ne respecte pas les conventions de base du projet.

---

## La pyramide — du sommet métier au sol technique

```
         ╔══════════════════════════════╗
 Niveau 0 ║    FEATURE DOCTRINE          ║  La feature existe, est unique, a un périmètre
         ║    (docs/doctrine/FEATURE_DOCTRINE.md — sommet, gouverne tout en dessous)
         ╠══════════════════════════════╣
 Niveau 5 ║    FEATURE SLICE GUARD       ║  Périmètre complet, montage/démontage propre
         ╠══════════════════════════════╣
 Niveau 4 ║    ARCHITECTURE GATES        ║  Graphe, drift DB, contrats, conformance
         ╠══════════════════════════════╣
 Niveau 3 ║    TESTS (Jest)              ║  Comportement : unit + intégration + schemathesis
         ╠══════════════════════════════╣
 Niveau 2 ║    CODE QUALITY GATE         ║  ESLint + 'use strict' + patterns Komerce
         ╠══════════════════════════════╣
 Niveau 1 ║    SÉCURITÉ DÉPENDANCES      ║  npm audit (high/critical bloquant)
         ╚══════════════════════════════╝
```

Chaque niveau est une **porte** : si elle est fermée, les niveaux au-dessus sont inaccessibles.
Un PR ne merge pas s'il y a une violation à n'importe quel niveau.

Le niveau 0 n'est pas un niveau technique comme les autres : c'est la question posée
**avant** d'écrire la première ligne — *à quelle feature métier reconnue ce code
appartient-il ?* Sans réponse positive à cette question, les niveaux 1 à 5 valident un
code qui ne devrait pas exister à cet endroit. Voir `docs/doctrine/FEATURE_DOCTRINE.md`
pour la doctrine complète et `docs/doctrine/APP_FEATURE_REGISTRY.md` pour le registre.

---

## Niveau 0 — Feature Doctrine (sommet)

**Script** : `scripts/feature-registry-check.js`
**Commande** : `npm run feature:registry`
**CI** : job `unit` (step 1 — avant même l'audit dépendances)
**Doctrine** : `docs/doctrine/FEATURE_DOCTRINE.md`
**Registre** : `docs/doctrine/APP_FEATURE_REGISTRY.md`

Ce que ça vérifie : que toute feature déclarée dans `features/*.feature.js` porte ses
propriétés métier obligatoires (service rendu, périmètre `in`/`out`, autorité,
invariants, contrat), que ses fichiers déclarés existent réellement, et signale (en
avertissement) les fichiers source non couverts par un manifest.

C'est la seule porte qui précède le niveau 1 : on ne vérifie pas la sécurité des
dépendances d'un code dont on ignore encore à quelle feature il appartient.

---

## Niveau 1 — Sécurité dépendances

**Script** : `scripts/npm-audit-gate.js`
**Commande** : `npm run audit:gate`
**CI** : job `unit` (step 2)

Ce que ça vérifie : vulnérabilités `high` ou `critical` dans les dépendances npm.
Déjà en place et bloquant. Ne rien changer.

Étendu à `public/boutique` (dépendances isolées : `stylelint`, `@playwright/test`,
jamais couvertes par l'audit racine) : `public/boutique/package.json#audit:gate`
réutilise le même script via `--cwd=.` (pas de duplication). CI : job
`boutique-quality`.

---

## Niveau 2 — Code Quality Gate

**Script** : `scripts/code-quality-gate.js`
**Commande** : `npm run quality:gate` / `npm run quality:gate:fix`
**CI** : job `unit` (step 3 — avant les tests)

Ce que ça vérifie dans **tous les fichiers** `services/`, `routes/`, `middleware/`, `utils/`, `validators/`, `core/` :

### 2.1 Règles universelles (bloquantes)

| Règle | Exemple violation | Pourquoi |
|---|---|---|
| `'use strict'` présent | fichier sans la directive | Mode sloppy = comportements silencieux |
| Pas de `var` | `var x = 1` | Hoisting imprévisible, remplacé par `const`/`let` |
| `const` si jamais réassigné | `let x = 1; return x` sans réassignation | Signale l'intention |
| Pas de `console.log` | `console.log('debug')` | Noise logs prod — utiliser `logger` |
| Pas de `eval` / `new Function` | `eval(userInput)` | Injection garantie |
| Pas de variable non déclarée | `x = 1` sans `const/let` | Globale implicite |
| Pas de doublon de déclaration | `const x = 1; const x = 2` | Erreur silencieuse en sloppy |
| Pas de code mort après `return`/`throw` | instructions après `return` | Confusion intention |

### 2.2 Règles Komerce (bloquantes)

| Règle | Détail |
|---|---|
| `logger` pas `console` | Importer `utils/logger` — pas `console.log/info/debug` |
| SQL paramétré | Pas de concaténation directe dans une query DB |
| `try/catch` sur routes | Toute route async doit être wrappée |
| Pas de secret en dur | Patterns `/sk_live_/`, `password =`, `secret =` avec valeur littérale |

### 2.3 Règles async (avertissements — non bloquantes en draft, bloquantes en production)

| Règle | Détail |
|---|---|
| `await` dans boucle | `for (...) { await }` — perf, souvent un bug |
| Promise non gérée | `.then()` sans `.catch()` |

---

## Niveau 3 — Tests

**Commandes** : `npm test` (unit + intégration) + Schemathesis (conformance)
**CI** : jobs `unit`, `integration`, `conformance`

Déjà en place. Ce niveau s'appuie sur le niveau 2 : des tests sur du code `var`-infesté
sans `'use strict'` donnent des faux positifs difficiles à déboguer.

### 3.1 Règle de complétion au contact

**Script** : `scripts/touched-tests-gate.js --strict`
**Commande** : `npm run gate:touched-tests` (mode strict en CI)
**Config** : `governance/coverage-thresholds.json`

Constat qui motive cette règle : un audit de couverture (`AUDIT_TEST_COVERAGE_GLOBAL_2026-07-03.md`)
a montré qu'une quinzaine de fichiers `services/`/`routes/` tournent en couverture
partielle stable (58 % à 85 % stmts) depuis plusieurs cycles — ni à 0 % (donc jamais
signalés comme trou critique), ni complets. Ces fichiers ont un test qui existe et
qui a été retouché au fil des évolutions, sans jamais être amené à complétion : la
présence d'un test masque l'incomplétude.

Le gate `touched-tests-gate.js` vérifie d'abord la **présence** d'un signal test
(Preuve A/B/C — voir en-tête du script). La règle de complétion au contact ajoute un
cliquet de non-régression uniquement lorsqu'une baseline de couverture réelle est
explicitement enregistrée :

> Quand un fichier applicatif **et** son fichier de test correspondant sont tous
> les deux touchés dans la même diff (Preuve A), et que le fichier possède une
> entrée explicite dans `governance/coverage-thresholds.json`, la couverture stmts
> + branch doit maintenir ou dépasser ce cliquet mesuré. **Aucun 100 % / 100 %
> implicite n'est appliqué aux fichiers sans baseline explicite.**

Ce que ça change concrètement : la couverture devient un **ratchet**, pas un objectif
absolu imposé au commit. Une zone déjà mesurée ne peut pas régresser silencieusement ;
un fichier sans baseline ne se voit pas inventer un seuil arbitraire. Lorsqu'une
mesure fiable est établie, elle peut être ajoutée comme cliquet, puis relevée à mesure
que les tests progressent.

Ce que la règle ne fait PAS :
- Elle ne force pas une remédiation rétroactive de tous les fichiers en couverture
  partielle non touchés par la PR en cours.
- Elle ne transforme pas l'absence de baseline en obligation de 100 %.
- Elle ne s'applique pas si le fichier source est touché **sans** que son test le
  soit (dans ce cas, c'est la Preuve B/C — exemption ou justification PR — qui
  s'applique, comme avant).
- Elle n'autorise pas à baisser silencieusement un cliquet existant : toute baisse
  doit être justifiée par une mesure et une raison technique explicite.

Coût accepté : lorsqu'un cliquet explicite doit être vérifié, ce check peut spawn un
process Jest isolé pour mesurer la couverture réelle du fichier concerné. C'est pour
cette raison que cette mesure reste une certification ciblée et non une taxe globale
sur chaque commit.

---

## Niveau 4 — Architecture Gates

**Scripts** : `arch:gate`, `arch:drift`, `arch:doctrine`, `contract-check.js`, `arch-reconcile.js`
**CI** : job `governance`

Déjà en place. Graphe, drift DB, contrats OpenAPI, sanitize. Ce niveau s'appuie sur
le niveau 2 : un fichier sans header correct et sans `'use strict'` ne passe pas le niveau 2,
donc on ne perd pas de temps à débugger le graphe sur du code de base incorrect.

---

## Niveau 5 — Feature Slice Guard

**Script** : `scripts/feature-guard.js`
**Commande** : `npm run feature:check`
**CI** : job `unit` (step final)
**Doctrine** : `docs/doctrine/FEATURE_SLICE_DOCTRINE.md`

Le sommet. Une feature est prête à merger quand :
- son code passe les niveaux 1–4,
- son slice est déclaré et cohérent,
- ses fichiers, migrations et tests sont tous déclarés,
- le guard passe en `--strict`.

---

## Ordre d'exécution en CI

```
Job unit (séquentiel dans le step) :
  1. npm run feature:registry    ← N0 — la feature existe et est complète
  2. npm run audit:gate         ← N1 — dépendances
  3. npm run quality:gate       ← N2 — code quality
  4. npm run backend:audit      ← N4 partiel — invariants backend
  5. jest (unit + coverage)     ← N3 partiel
  6. npm run feature:check      ← N5

Job governance :
  1. arch:gate                  ← N4 — graphe + drift + headers SQL
  2. arch:reconcile:check       ← N4 — budget réconcilié
  3. arch-schema-drift-check    ← N4 — drift DB live
  4. arch-doctrine-sanitize     ← N4 — sanitize_before_render

Job integration :
  1. schema freshness           ← N4 partiel
  2. ci-migrate                 ← migrations
  3. jest integration           ← N3

Job conformance :
  1. Schemathesis               ← N3 — OpenAPI conformance
```

---

## Règle de mise à jour de cette doctrine

Toute nouvelle règle ajoutée au `code-quality-gate.js` doit être documentée ici dans sa couche.
Tout nouveau gate CI doit s'inscrire dans la pyramide à son niveau.

Cette doctrine vieillit avec le code. Jamais séparément.

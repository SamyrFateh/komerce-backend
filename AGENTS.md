# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

> **Source de vérité unique** : [`.cursorrules`](./.cursorrules) redirige vers ce fichier.
> En cas de désaccord, `AGENTS.md` fait foi.

---

## 0. AVANT DE CODER — la pyramide de gouvernance

**Ne pas coder puis corriger. Coder avec l'analyse en tête.**

Avant d'ouvrir un fichier source, traverser la pyramide de haut en bas :

```
 ╔═══════════════════════════════════════════════════════════════════════╗
 ║  PYRAMIDE DE GOUVERNANCE KOMERCE                                     ║
 ║  Ordre de lecture = ordre d'exécution = ordre de vérification        ║
 ╠═══════════════════════════════════════════════════════════════════════╣
 ║                                                                       ║
 ║  N0  FEATURE ──── De quelle feature s'agit-il ?                      ║
 ║      features/<feature>.feature.js → service, périmètre, autorité    ║
 ║      🔒 npm run feature:registry                                     ║
 ║                                                                       ║
 ║  N5  SLICE ────── Le découpage technique est-il cohérent ?           ║
 ║      🔒 npm run feature:check                                        ║
 ║                                                                       ║
 ║  N4  ARCHI ────── Headers @komerce-arch à jour ? Graphe régénéré ?   ║
 ║      🔒 npm run arch:gate                                            ║
 ║                                                                       ║
 ║  N3  DB ───────── Schéma DB aligné ?                                 ║
 ║      🔒 npm run arch:drift                                           ║
 ║                                                                       ║
 ║  N2  QUALITÉ ──── use strict, const/let, pas de SQL concat, etc.     ║
 ║      🔒 npm run quality:gate                                         ║
 ║                                                                       ║
 ║  N1  DEPS+TESTS ─ npm audit, jest                                    ║
 ║      🔒 npm run audit:gate + npm test                                ║
 ║                                                                       ║
 ║  CSS BOUTIQUE ─── 0 conflit CSS (baseline verrouillé)                ║
 ║      🔒 npm run css:guard (câblé dans le build Railway)              ║
 ╚═══════════════════════════════════════════════════════════════════════╝
```

Chaque 🔒 est un gate automatisé. Le CI les exécute dans cet ordre.
Un gate rouge **bloque le merge** — pas de contournement silencieux.

---

## 0-bis. PROTOCOLE D'ENTRÉE OBLIGATOIRE — avant toute modification

> Ce protocole est **non négociable**. Il s'applique à tout agent IA et à tout
> développeur. Il rend mécanique ce qui était de l'intention.

### Étape 1 — Lire l'index

```bash
cat docs/README.md
```

Identifier les documents vivants actifs. Ne pas lire l'historique.

### Étape 2 — Identifier la feature ou le transversal

Toute modification appartient à **exactement une** des 16 features déclarées,
ou à un périmètre transversal déclaré dans `governance/transversal-paths.json`.

```bash
cat docs/doctrine/APP_FEATURE_REGISTRY.md   # liste des 16 features
```

Si aucune feature ne couvre la modification → **s'arrêter** et renégocier
dans le registre avant de toucher le code.

### Étape 3 — Ouvrir la carte de la feature

```bash
cat features/<feature>.feature.js
```

Lire obligatoirement :
- `service` : qu'est-ce que cette feature **fait** ?
- `perimeter.in` : ce qui est **dans** le périmètre
- `perimeter.out` : ce qui est **hors** périmètre (ne pas toucher)
- `authority` : qui doit valider les changements structurels
- `invariants` : ce qui ne doit jamais être cassé
- `files` : les fichiers déclarés (ne modifier que ceux-là)

### Étape 4 — Qualifier l'opération CRUD

| Opération | Signification | Conséquence sur la carte |
|-----------|---------------|--------------------------|
| **Create** | Nouveau fichier, nouvelle route, nouveau comportement | Déclarer le fichier dans `files`, vérifier que l'intention couvre ce nouveau cas |
| **Read** | Lecture seule, refactoring interne sans changement d'interface | Aucune mise à jour de carte nécessaire |
| **Update** | Modification de comportement existant | Mettre à jour la carte si l'intention change |
| **Delete / Archive / Deprecate** | Suppression ou dépréciation | Retirer de `files`, marquer `status: deprecated` si la feature disparaît |

### Étape 5 — Vérifier avant de toucher

Avant d'écrire la première ligne :

```bash
# La modification sort-elle du périmètre déclaré ?
# Si oui → s'arrêter, renégocier le périmètre dans la carte d'abord.

# Les fichiers que je vais toucher sont-ils déclarés dans la carte ?
# Si non → les ajouter à la carte dans la même PR.
```

### Étape 6 — Modifier dans le périmètre autorisé

Modifier uniquement les fichiers listés dans `files` de la carte.

Si un fichier hors `files` doit être touché :
- soit il appartient à une autre feature → ouvrir sa carte et vérifier les invariants
- soit il est transversal → vérifier `governance/transversal-paths.json`
- soit c'est une extension du périmètre → mettre à jour la carte avant de toucher le fichier

### Étape 7 — Mettre à jour la carte si l'intention change

> **Règle** : la carte porte l'INTENTION, jamais le dérivé.
>
> Mettre à jour la carte si et seulement si le **service rendu, le périmètre,
> les invariants ou l'autorité** changent.
>
> Ne jamais recopier dans la carte des listes de fonctions, sélecteurs CSS,
> routes réelles ou métriques — ce sont des dérivés, ils appartiennent aux
> générateurs.

**Checkpoint humain 1 — L'intention a-t-elle changé ?**

```
[ ] Non — la carte n'est pas modifiée
[ ] Oui — carte mise à jour dans cette PR
[ ] Incertain — revue humaine obligatoire avant merge
```

### Étape 8 — Régénérer les sorties dérivées

Après modification, régénérer les sorties que la feature impacte :

```bash
npm run arch:gen                  # graphe d'architecture (N4)
npm run dashboards:360            # si dashboards touchés
npm run boutique:360              # si boutique touchée
npm run meta:graph                # si structure globale change
```

Règle absolue : **jamais éditer un fichier généré à la main**.
Si une sortie générée semble fausse → corriger la source (carte ou générateur),
puis régénérer.

### Étape 9 — Lancer les tests de la feature

```bash
# Tests unitaires
npx jest --testPathPatterns="tests/unit"

# Si la feature a des tests d'intégration
npx jest --testPathPatterns="tests/integration/<feature>"

# Audit positif de la feature (contrats déclarés)
node scripts/feature-audit.js --feature <nom> --strict
```

### Étape 10 — Lancer map:check

```bash
npm run map:check
```

Si `map:check` est vert, l'invariant de gouvernance est satisfait.
Si un step échoue → corriger avant de committer.

---

## 1. Pipeline CI — ce qui tourne automatiquement sur chaque PR

| Job | Step | Gate | Bloquant |
|-----|------|------|----------|
| unit | 1 | `npm run feature:registry` — Registre N0 | ✅ oui |
| unit | 2 | `npm run quality:gate` — Pyramide N2 | ✅ oui |
| unit | 3 | `npm run backend:audit` — Architecture N4 | ✅ oui |
| unit | 4 | `npm run audit:gate` — npm audit | ✅ oui |
| unit | 5 | `npx jest tests/unit` — Tests unitaires | ✅ oui |
| unit | 6 | `npm run feature:check` — Feature slice N5 | ✅ oui |
| integration | 1 | `npm run arch:drift` — Schema drift N3 | ✅ oui |
| integration | 2 | `npx jest tests/integration` | ✅ oui |
| governance | - | `npm run arch:gate` — Headers + graph | ✅ oui |
| **governance** | - | **`npm run map:check`** — **Gouvernance exécutable** | ✅ **oui** |
| **deploy** | build | `npm run css:guard` — CSS 0 conflit | ✅ oui |

Si un seul gate échoue, le merge ou le deploy est bloqué.

---

## 2. Feature (N0) — toujours en premier

Avant de toucher la moindre logique métier :

1. Trouver la feature dans `docs/doctrine/APP_FEATURE_REGISTRY.md`.
2. Lire son manifest `features/<feature>.feature.js` : `service`, `perimeter.in`, `perimeter.out`.
3. Si la modification sort du périmètre → **s'arrêter**, renégocier dans le registre.
4. Tout fichier ajouté → le déclarer dans le manifest (même PR).
5. Tout header `@domain` doit correspondre au manifest de sa feature.

Gate : `node scripts/feature-registry-check.js --strict`

---

## 3. Feature Slice (N5)

Le manifest porte le détail technique : fichiers, contrat, migrations, tests.

Doctrine : `docs/doctrine/FEATURE_SLICE_DOCTRINE.md`
Gate : `node scripts/feature-guard.js --strict`

---

## 4. Architecture (N4)

Tout fichier source naît avec un header `@komerce-arch`.
Après modification : `node scripts/generate-komerce-arch-graph.js && npm run arch:gate`

⚠️ Fichier avec shebang (`#!/usr/bin/env node`) : ordre obligatoire = shebang en ligne 1 → header `@komerce-arch` → `'use strict'` → reste. Tout code avant le shebang casse la detection du header (gate le signale comme "Header mal placé", distinct de "Sans header" — voir `docs/KOMERCE_ARCHITECTURE_HEADERS.md#header-placement-files-with-a-shebang`).

Doctrine : `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`

---

## 5. DB (N3)

Toute migration met à jour `docs/SCHEMA.md` et les headers `@db-read/@db-write/@db-txn`.

Doctrine : `docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`

---

## 6. Code Quality (N2)

Conventions vérifiées automatiquement par `scripts/code-quality-gate.js` :
- `'use strict'` en première ligne effective
- `const`/`let` (jamais `var`)
- Pas de SQL concaténé avec input utilisateur
- Pas de secrets en dur

Auto-fix : `node scripts/code-quality-gate.js --fix`
Gate : `npm run quality:gate`

---

## 7. CSS Boutique

Baseline verrouillé à **0 conflit**. Scanner : `public/boutique/scripts/css-guard.js`.
Gate : `npm run css:guard` (câblé dans le build Railway).

---

## 8. Règles techniques non négociables

- Statuts commande : `services/order-status-machine.js`.
- Paiements Stripe/cash/wallet/shared-cart : services propriétaires.
- Webhooks Stripe : body brut avant `express.json`.
- Wallet : créditer, débiter, contre-passer (jamais supprimer).
- Pricing : composantes DB, jamais de coefficient dur.
- Toute transition laisse une trace.

---

## 9. Règle Boutique

Si la modification touche `public/boutique/**` :
- Lire `public/boutique/README.md`.
- Ne pas éditer `css/dist/*.css` directement.
- Ne pas casser le hero fixed + `#k-page-scroll`.
- Ne pas mélanger panier perso et panier partagé.

---

## 10. Fin de session

Avant commit, lancer la vérification complète :

```bash
npm run map:check
```

Si map:check est vert, tout est cohérent. Si un step échoue, corriger avant de committer.

Vérification minimale alternative (hors CI) :
```bash
npm run feature:registry && npm run quality:gate
```

---

## 11. Deux checkpoints humains non automatisables

Ces deux cas **ne peuvent pas être détectés automatiquement**. Ils sont arrêtés
par le PR template, pas par un script.

### Checkpoint A — L'intention a-t-elle changé ?

Un script ne peut pas savoir si l'intention métier a évolué.
Le PR template force une réponse humaine explicite.
→ Voir section `### Checklist gouvernance carte-first` dans le PR template.

### Checkpoint B — Un doc historique porte-t-il encore de l'info vivante ?

Lors d'un archivage ou d'un nettoyage documentaire :
- Jamais d'archivage automatique d'un cas ambigu.
- Classer `À REVOIR` dans `docs/chantier/STATUS.md` et poser la question.
- Validation humaine avant déplacement vers `docs/_archive/`.

---

## 12. Hiérarchie documentaire

```
1. Code de production
2. DB live
3. AGENTS.md (ce fichier)
4. docs/README.md
5. Documents actifs listés dans docs/README.md
6. Archives / audits  (docs/_archive/)
```

---

## 13. Divergence

Si code, DB et docs divergent : ne pas corriger silencieusement.
Noter dans `docs/chantier/STATUS.md`, corriger dans la même PR ou créer une dette explicite.

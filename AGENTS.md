# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

> **Source de vérité unique** : [`.cursorrules`](./.cursorrules) redirige vers ce fichier.
> En cas de désaccord, `AGENTS.md` fait foi.

---

## 0. AVANT DE CODER — protocole carte-first obligatoire

**Ne pas coder puis corriger. Coder avec l'analyse en tête.**

Toute intervention commence par `docs/INDEX.md`, puis par la carte d'identité de la feature ou du transversal concerné.

Ordre obligatoire :

1. Lire `docs/INDEX.md`.
2. Identifier la feature métier ou le transversal concerné.
3. Ouvrir `features/<feature>.feature.js`.
4. Qualifier l'opération : `Create`, `Read`, `Update`, `Delete/Archive/Deprecate`.
5. Vérifier `service`, `perimeter.in`, `perimeter.out`, `authority`, `contract`, `invariants`, `tests` ou `verification`.
6. Vérifier que chaque fichier touché appartient à la carte ou à un transversal déclaré.
7. Si l'intention métier change, mettre à jour la carte dans la même PR.
8. Régénérer les sorties dérivées pertinentes.
9. Lancer les gates applicables, puis `npm run map:check` quand disponible.

Un agent ne doit pas démarrer depuis un ancien audit, un prompt historique, un rapport daté, un `_LIVE.md`, un `MEMO_*` ou une sortie générée. Ces fichiers peuvent informer, mais ne sont pas porte d'entrée.

---

## 1. Pyramide de gouvernance

```
 ╔═══════════════════════════════════════════════════════════════════════╗
 ║  PYRAMIDE DE GOUVERNANCE KOMERCE                                     ║
 ║  Ordre de lecture = ordre d'exécution = ordre de vérification        ║
 ╠═══════════════════════════════════════════════════════════════════════╣
 ║                                                                       ║
 ║  N0  FEATURE ──── De quelle feature s'agit-il ?                      ║
 ║      docs/INDEX.md                                                     ║
 ║      docs/doctrine/FEATURE_DOCTRINE.md                                ║
 ║      docs/doctrine/APP_FEATURE_REGISTRY.md                            ║
 ║      features/<feature>.feature.js → service, périmètre, autorité    ║
 ║      🔒 npm run feature:registry                                     ║
 ║                                                                       ║
 ║  N5  SLICE ────── Le découpage technique est-il cohérent ?           ║
 ║      docs/doctrine/FEATURE_SLICE_DOCTRINE.md                          ║
 ║      🔒 npm run feature:check                                        ║
 ║                                                                       ║
 ║  N4  ARCHI ────── Headers @komerce-arch à jour ? Graphe régénéré ?   ║
 ║      docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md                              ║
 ║      🔒 npm run arch:gate                                            ║
 ║                                                                       ║
 ║  N3  DB ───────── Schéma DB aligné ?                                 ║
 ║      docs/KOMERCE_DB_SCHEMA_DOCTRINE.md                               ║
 ║      🔒 npm run arch:drift                                           ║
 ║                                                                       ║
 ║  N2  QUALITÉ ──── use strict, const/let, pas de SQL concat, etc.     ║
 ║      docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md                        ║
 ║      🔒 npm run quality:gate                                         ║
 ║                                                                       ║
 ║  N1  DEPS+TESTS ─ npm audit, jest                                    ║
 ║      🔒 npm run audit:gate + npm test                                ║
 ║                                                                       ║
 ║  CSS BOUTIQUE ─── 0 conflit CSS (baseline verrouillé)                ║
 ║      🔒 npm run css:guard                                            ║
 ╚═══════════════════════════════════════════════════════════════════════╝
```

Chaque 🔒 est un gate automatisé. Un gate rouge bloque le merge — pas de contournement silencieux.

---

## 2. Pipeline CI — ce qui tourne automatiquement sur chaque PR

| Job | Step | Gate | Bloquant |
|-----|------|------|----------|
| unit | 1 | `npm run feature:registry` — Registre N0 | ✅ oui |
| unit | 2 | `npm run quality:gate` — Pyramide N2 | ✅ oui |
| unit | 3 | `npm run backend:audit` — Architecture N4 | ✅ oui |
| unit | 4 | `npm run audit:gate` — npm audit | ✅ oui |
| unit | 5 | `npx jest tests/unit` — Tests unitaires | ✅ oui |
| unit | 6 | `npm run feature:check` — Feature Slice Guard | ✅ oui |
| integration | 1 | `npm run arch:drift` — Schema drift N3 | ✅ oui |
| integration | 2 | `npx jest tests/integration` | ✅ oui |
| governance | - | `npm run arch:gate` — Headers + graph | ✅ oui |
| deploy | build | `npm run css:guard` — CSS 0 conflit | ✅ oui |

---

## 3. Feature (N0) — toujours en premier

Avant de toucher la moindre logique métier :

1. Trouver la feature dans `docs/INDEX.md` puis `docs/doctrine/APP_FEATURE_REGISTRY.md`.
2. Lire son manifest `features/<feature>.feature.js` : `service`, `perimeter.in`, `perimeter.out`, `authority`, `contract`, `invariants`.
3. Si la modification sort du périmètre → s'arrêter et renégocier dans le registre.
4. Tout fichier ajouté → le déclarer dans le manifest ou dans un transversal dans la même PR.
5. Tout header `@domain` doit correspondre au manifest de sa feature.

Gate : `node scripts/feature-registry-check.js --strict`

---

## 4. Feature Slice (N5)

Le manifest porte le détail technique : fichiers, contrat, migrations, tests.

Doctrine : `docs/doctrine/FEATURE_SLICE_DOCTRINE.md`
Gate : `node scripts/feature-guard.js --strict`

---

## 5. Architecture (N4)

Tout fichier source naît avec un header `@komerce-arch`.
Après modification : `node scripts/generate-komerce-arch-graph.js && npm run arch:gate`

Fichier avec shebang (`#!/usr/bin/env node`) : ordre obligatoire = shebang ligne 1 → header `@komerce-arch` → `'use strict'` → reste.

Doctrine : `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`

---

## 6. DB (N3)

Toute migration met à jour `docs/SCHEMA.md` et les headers `@db-read/@db-write/@db-txn`.

Doctrine : `docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`

---

## 7. Code Quality (N2)

Conventions vérifiées automatiquement par `scripts/code-quality-gate.js` :

- `'use strict'` en première ligne effective
- `const`/`let` (jamais `var`)
- Pas de SQL concaténé avec input utilisateur
- Pas de secrets en dur

Gate : `npm run quality:gate`

---

## 8. CSS Boutique

Baseline verrouillé à **0 conflit**. Scanner : `public/boutique/scripts/css-guard.js`.
Gate : `npm run css:guard`.

---

## 9. Règles techniques non négociables

- Statuts commande : `services/order-status-machine.js`.
- Paiements Stripe/cash/wallet/shared-cart : services propriétaires.
- Webhooks Stripe : body brut avant `express.json`.
- Wallet : créditer, débiter, contre-passer (jamais supprimer).
- Pricing : composantes DB, jamais de coefficient dur.
- Toute transition laisse une trace.

---

## 10. Règle Boutique

Si la modification touche `public/boutique/**` :

- lire `public/boutique/README.md` ;
- lire la carte de feature parente ;
- ne pas éditer `css/dist/*.css` directement ;
- ne pas casser le hero fixed + `#k-page-scroll` ;
- ne pas mélanger panier perso et panier partagé.

---

## 11. Fin de session

Avant commit : mettre à jour headers `@komerce-arch`, manifest `features/`, `SCHEMA.md`, `STATUS.md` selon ce qui a changé.

Vérification minimale :

```bash
npm run feature:registry && npm run quality:gate
```

Vérification cible carte-first :

```bash
npm run map:check
```

---

## 12. Hiérarchie documentaire

```
1. Code de production
2. DB live
3. AGENTS.md
4. docs/INDEX.md
5. features/*.feature.js
6. docs/doctrine/* actifs
7. générateurs
8. sorties générées à jour
9. archive/* pour historique
```

---

## 13. Divergence

Si code, DB, cartes et docs divergent : ne pas corriger silencieusement.
Noter la divergence, corriger dans la même PR ou créer une dette explicite.

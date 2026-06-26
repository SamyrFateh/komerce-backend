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
 ║      docs/doctrine/FEATURE_DOCTRINE.md                                ║
 ║      docs/doctrine/APP_FEATURE_REGISTRY.md (14 métier + 2 transv.)   ║
 ║      features/<feature>.feature.js → service, périmètre, autorité    ║
 ║      🔒 npm run feature:registry                                     ║
 ║                                                                       ║
 ║  N5  SLICE ────── Le découpage technique est-il cohérent ?           ║
 ║      docs/doctrine/FEATURE_SLICE_DOCTRINE.md                          ║
 ║      🔒 npm run feature:guard (→ node scripts/feature-guard.js)      ║
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
 ║      🔒 npm run css:guard (câblé dans le build Railway)              ║
 ╚═══════════════════════════════════════════════════════════════════════╝
```

Chaque 🔒 est un gate automatisé. Le CI les exécute dans cet ordre.
Un gate rouge **bloque le merge** — pas de contournement silencieux.

---

## 1. Pipeline CI — ce qui tourne automatiquement sur chaque PR

| Job | Step | Gate | Bloquant |
|-----|------|------|----------|
| unit | 1 | `npm run feature:registry` — Registre N0 | ✅ oui |
| unit | 2 | `npm run quality:gate` — Pyramide N2 | ✅ oui |
| unit | 3 | `npm run backend:audit` — Architecture N4 | ✅ oui |
| unit | 4 | `npm run audit:gate` — npm audit | ✅ oui |
| unit | 5 | `npx jest tests/unit` — Tests unitaires | ✅ oui |
| integration | 1 | `npm run arch:drift` — Schema drift N3 | ✅ oui |
| integration | 2 | `npx jest tests/integration` | ✅ oui |
| governance | - | `npm run arch:gate` — Headers + graph | ✅ oui |
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

Avant commit : mettre à jour headers `@komerce-arch`, manifest `features/`, `SCHEMA.md`, `STATUS.md` selon ce qui a changé.

Vérification minimale :
```bash
npm run feature:registry && npm run quality:gate
```

---

## 11. Hiérarchie documentaire

```
1. Code de production
2. DB live
3. AGENTS.md (ce fichier)
4. docs/README.md
5. Documents actifs listés dans docs/README.md
6. Archives / audits
```

---

## 12. Divergence

Si code, DB et docs divergent : ne pas corriger silencieusement.
Noter dans `docs/chantier/STATUS.md`, corriger dans la même PR ou créer une dette explicite.

# Consolidation — doctrine token budget `modal-product` (boutique)

_2026-07-07_

## Problème

`features/modal-product.feature.js` déclare `contracts.doctrine = { scope: 'boutique', max: 21 }`
(budget de `rgba(...)` non-tokenisés toléré, sous cliquet — cf. commentaire dans le manifeste :
« les 4 rgba du fix ont été retokenisés → cliquet bas attendu. Une hausse bloque. »).

`scripts/feature-guard.js` lisait bien ce champ, mais ne faisait que poser un **warning texte** :
« Doctrine token budget declare (max: 21) — verifier via css-guard ». `scripts/css-guard.js` ne
vérifie que les conflits de cascade CSS — rien à voir avec un comptage de `rgba(...)`. Le budget
était donc **déclaré mais jamais contrôlé par aucun script réel** : quelqu'un pouvait dépasser 21
sans qu'aucun gate ne le voie, ni en local ni en CI.

## Correctif

`scripts/feature-guard.js`, section 5 (« Doctrine token budget ») : remplace le warning factice par
un comptage réel.

- Résout `slice.files[doctrine.scope]` (ici `files.boutique` → `modal-shell.css`,
  `modal-product.css`, `modal-product-lot4-hybrid.css`) ;
- Compte les occurrences de `rgba(` par fichier, commentaires CSS exclus (même logique que
  `check-important.js`) ;
- Si `count > max` → **erreur bloquante** (`[DOCTRINE] Budget rgba depasse...`), `exit(1)` en
  `--strict` — donc au pre-commit (`feature:guard:strict` y est déjà câblé, aucun câblage
  supplémentaire nécessaire) et en CI (`check:all`) ;
- Si `scope` ne correspond à aucun groupe de `files.*` déclaré → warning (budget non vérifiable,
  signalé au lieu de silencieusement ignoré).

Ajout aussi d'une section toujours affichée dans le rapport humain (« Budgets doctrine token »)
listant chaque budget déclaré avec son compte courant — visible même quand tout est dans les
clous, pas seulement au dépassement.

## État constaté

Comptage réel actuel : **21/21** — au plafond, zéro marge :
- `css/modal-shell.css` : 13
- `css/modal-product.css` : 8
- `css/modal-product-lot4-hybrid.css` : 0

Testé : ajout d'un `rgba(...)` de test dans `modal-product.css` → `22/21`, erreur bloquante,
`--strict` sort en `exit(1)`. Fichier restauré après test, `feature-guard.js --strict` revient à
son état initial (une seule erreur pré-existante et sans rapport : `checkout` référence un fichier
de test manquant, `../../../tests/unit/b-checkout-pure.test.js` — n'existe nulle part dans ce zip,
probablement une dette connue côté `checkout`, non traitée ici car hors périmètre de la demande).

## Fichier livré

`scripts/feature-guard.js` (mis à jour) — à remplacer directement dans le checkout réel, puis
`npm run feature:guard:strict` pour vérifier.

# Corrections appliquées — Patch modal desktop (2026-06-27)

> Suite de session précédente (transcript interrompu en milieu de patch).
> Périmètre : `css/modal-shell.css`, `css/dist/components.css`, `index.html`, `.cache-buster-state.json`.

---

## ✅ BUG-1 — `display: grid` manquant sur `.k-modal-product-zone` (desktop)
**Fichier** : `css/modal-shell.css` (@media min-width: 900px)
La normalisation CSS avait supprimé ~105 lignes de blocs `@media` entiers : le `display: grid` du conteneur produit, le bloc complet `.k-modal-img-wrap` initial, et le bloc complet `.k-modal-details` initial. Résultat : la modal produit en desktop n'affichait que la colonne droite (prix/paiement), l'image disparaissait.
**Fix** : restauration des blocs depuis l'architecture de référence (`bout`), avec les 4 valeurs `rgba(...)` reconverties en tokens (`var(--surface-sand-97)`, `var(--ocean-bg-08)`, `var(--surface-white-98)`, `var(--border-text-10)`) pour rester conforme à la doctrine tokens du projet.

---

## ✅ BUG-2 — Bloc CSS mort : `body.modal-has-cart #k-modal.k-modal { margin-right: 336px; }`
**Fichier** : `css/modal-shell.css`
Bloc déjà écrasé par un FIX plus bas dans le même fichier (cascade), repéré et retiré dans la session précédente — confirmé absent dans le patch final.

---

## ✅ BUG-3 — Doublons de cascade intra-fichier (`position`, `padding-bottom`)
**Fichier** : `css/modal-shell.css`
`.k-modal-actions { position: relative; z-index: 30; }` (écrasé par `position: fixed` plus bas) et `.k-modal-scroll { padding-bottom: 0; }` (écrasé par un `calc()` plus bas) — valeurs mortes retirées dans la session précédente, confirmées absentes.

---

## ✅ BUG-4 — Conflit d'ownership : `#k-modal-suggestions.k-modal-suggestions--desktop-list` (background/padding)
**Fichier** : `css/modal-shell.css`
`modal-shell.css` et `modal-product-lot4-hybrid.css` définissaient tous les deux `background`/`padding` pour le même sélecteur (lot4-hybrid gagnait silencieusement). Séparation faite : `modal-shell.css` garde le layout commun (`border-top`, `margin-top`, `display: block`...), `modal-product-lot4-hybrid.css` devient seul propriétaire du visuel `--desktop-list` via un sélecteur `:not(.k-modal-suggestions--desktop-list)` côté modal-shell.

---

## ✅ BUG-5 — 8 conflits de cascade révélés par la restauration de BUG-1
**Fichiers** : `css/modal-shell.css`
En restaurant les blocs supprimés par BUG-1, `css-guard --strict` a fait remonter **8 conflits hors baseline**. Diagnostic : pas des régressions du patch — des doublons déjà présents dans l'architecture de référence `bout`, invisibles jusqu'ici parce que la normalisation avait supprimé une moitié de chaque paire.

| Sélecteur | Propriété | Doublon retiré (côté modal-shell) | Source de vérité conservée |
|---|---|---|---|
| `.k-modal-product-zone` | `background` | base (`var(--white)`) | `modal-product-lot4-hybrid.css` |
| `.k-modal-product-zone` | `grid-template-columns` | bloc FIX (`43%/57%`) | `modal-product-lot4-hybrid.css` (`48%/52%`) |
| `.k-modal-img-wrap` | `background` | base | `modal-product-lot4-hybrid.css` |
| `.k-modal-img-wrap` | `height` + `overflow` | base (doublon intra-fichier) | bloc FIX (même fichier) |
| `.k-modal-details` | `padding` | base + bloc FIX (doublon triple) | `modal-product-lot4-hybrid.css` |
| `.k-modal-details` | `overflow-y`/`overflow-x` | base (doublon intra-fichier, valeurs identiques) | bloc FIX (même fichier) |
| `.k-sug-grid` / `--same` / `--other` | `grid-template-columns` + `gap` | modal-shell | `modal-product-lot4-hybrid.css` |

**Fix** : retrait des déclarations mortes côté `modal-shell.css`, commentaires d'ownership ajoutés. Aucun changement de rendu (le gagnant de cascade ne change pas) — uniquement fin des sources concurrentes.

**Effet de bord détecté** : le parseur de `css-guard.js` ne capte un sélecteur multi-lignes (`A,\nB,\nC {`) que via sa dernière ligne — `.k-sug-grid` et `.k-sug-grid--same` étaient invisibles au scan, seul `--other` apparaissait. Angle mort à corriger dans `scripts/css-guard.js` (hors urgence, backlog `STATUS.md`).

---

## Preuves d'exécution (gates réels, pas de relecture)

```
css-guard --strict         ✔ Aucun conflit de cascade.
check-important            ✔ 9/9 — stable vs baseline
check-breakpoints          ✔ 3/3 — composition identique à la baseline
audit-boutique-arch        ✔ Aucune violation
gen-boutique-arch-live     ✔ généré
check-css-dist-only        ✔ ok
check-cache (deploy --dry) ✔ dist identique, sync
quality-gate (N2)          ✔ 91 fichiers, 0 violation
check-html-balance         ✔ ok (2 fichiers)
check-js-imports           ✔ ok (35 exports non consommés — informatif, pré-existant)
check-body-classes         ⚠ 4 avertissements pré-existants — non bloquants
check-no-css-injection     ✔ ok
check-group-wording        ✔ ok
```

`test:e2e` (Playwright) non exécuté — pas de binaires navigateur dans l'environnement de vérification.

`.css-guard-baseline.json` : aucune modification nécessaire (déjà à 0, on y revient réellement — aucun doublon figé).

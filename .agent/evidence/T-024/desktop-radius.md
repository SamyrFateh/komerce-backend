# T-024 — D12 — Radius modal desktop

## Constat initial (contradiction spec vs réalité)

L'énoncé de la tâche indiquait "radius desktop actuel = 26px". Analyse de la
cascade réelle sur `#k-modal.k-modal` (id+classe, `@media (min-width: 900px)`)
dans le bundle `components.css` :

- `modal-shell.css:441` `#k-modal.k-modal { border-radius: 20px }` — écrasé
- `modal-shell.css:768` `#k-modal.k-modal { border-radius: 0 }` — **gagnant réel**
  (même spécificité que la règle ci-dessus, déclarée plus tard dans le fichier)
- `modal-shell.css:890` `.k-modal { border-radius: 26px }` — mort par
  spécificité (classe seule < id+classe), jamais appliqué

Vérifié : aucune règle ultérieure dans le bundle (modal-media, modal-product,
modal-product-lot4-hybrid, modal-mobile-canonical, modal-enriched-content,
boutique-desktop.css chargé en dernier) ne cible `#k-modal.k-modal` ou
`.k-modal` pour `border-radius`.

Radius réellement rendu avant correction : **0px**, pas 26px.

## Correction appliquée

- `modal-shell.css:768` : `border-radius: 0` → `border-radius: 12px`
  (owner réel, désormais annoté [D12]).
- `modal-shell.css:890` : suppression de la déclaration `border-radius: 26px`
  (règle morte) + du commentaire obsolète qui la documentait comme active.
  `box-shadow` conservé (toujours actif, hors périmètre D12).

## Note visuelle

Le shell desktop reste en mode plein écran (`width:100vw; height:100dvh;
sans carte flottante`, commentaire d'origine et header de section §6
confirmant ce choix comme "source de vérité unique pour le layout desktop").
Un radius de 12px sur un élément bord-à-bord ne produira qu'un léger
arrondi aux quatre coins de l'écran, pas un effet "carte flottante". Si
l'objectif produit est un effet carte flottante plus prononcé, cela
dépasserait le périmètre D12 (changerait width/height/position, hors
fichiers autorisés pour cette tâche) et devrait faire l'objet d'une tâche
séparée.

## Gates

```
npm --prefix public/boutique run deploy:css        → PASS (bump components.css v154→v155)
npm --prefix public/boutique run check:cache        → PASS
npm --prefix public/boutique run check:breakpoints  → PASS (3 violations connues, stable vs baseline)
npm --prefix public/boutique run audit:ownership    → PASS
npm --prefix public/boutique run audit:gate         → PASS (0 vulnérabilité)
```

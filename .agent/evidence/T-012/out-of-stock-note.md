# T-012 — Note de clôture : bouton « Me prévenir » non implémenté

## Constat

Le bouton « Me prévenir » (CTA rupture de stock) n'existe pas dans le renderer
PDC actuel (`b-modal-mobile-product.js`). La fonction `renderActions()` désactive
les CTA existants (Ajouter/Acheter) en état OUT_OF_STOCK mais n'injecte aucun
bouton de notification.

La capture `mobile-rupture-stock.png` du livrable montrait un bouton vert « Me
prévenir » provenant du renderer **legacy** (`b-modal.js` chemin openModal) — ce
chemin est hors périmètre PDC et hors périmètre de ce chantier.

## Conséquence

Aucune bordure coral à purger dans le scope PDC pour T-012 : le bouton
n'existe pas.

En état OUT_OF_STOCK sur un produit PDC, les deux CTA (Ajouter + Acheter)
sont `disabled`. C'est le comportement fail-closed documenté dans
`DOCTRINE_PRODUCT_DETAIL_CONTRACT.md` (le chemin transactionnel reste verrouillé
si la sélection est incomplète ou impossible).

## Ce qui reste à faire (hors ce chantier)

Si Komerce veut implémenter le bouton « Me prévenir » sur le renderer PDC :
- Créer un composant `renderNotifyButton()` dans `b-modal-mobile-product.js`
  qui remplace les deux CTA en état OUT_OF_STOCK
- Appliquer les styles spec §6 (fond blanc, `border: 1.5px solid var(--text)`,
  pleine largeur)
- Ce serait une nouvelle tâche dans une lane dédiée LANE-NOTIFY

## Décision

T-012 est fermée sans modification de code : le périmètre « purger la bordure
coral du bouton Me prévenir » est sans objet dans le renderer PDC actuel.

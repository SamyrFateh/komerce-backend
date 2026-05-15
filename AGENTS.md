# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

Avant toute modification, lire :

1. `docs/README.md`
2. `docs/ZONE_IMPACT.md`
3. `docs/BOUTIQUE_ARCHITECTURE.md` si la modification touche la Boutique

## Règle Boutique obligatoire

Si une modification touche :

- `public/boutique/**`
- `public/Komerce_Boutique.html`
- `docs/*BOUTIQUE*`

alors il faut lire et respecter `docs/BOUTIQUE_ARCHITECTURE.md` avant d'écrire du code.

Toute PR Boutique doit indiquer :

- les fichiers Boutique touchés ;
- le composant owner concerné ;
- pourquoi le fichier modifié est le bon propriétaire ;
- comment le mobile pager et le desktop ont été préservés.

## Interdictions Boutique

- Ne pas créer une deuxième source de vérité.
- Ne pas déplacer du CSS dans un fichier non propriétaire.
- Ne pas casser le moteur mobile hero fixed + `#k-page-scroll` + `b-pager.js`.
- Ne pas corriger le desktop avec un hack mobile.
- Ne pas ajouter de règle `.k-chip`, `.k-cats`, `.k-cats-shell` hors fichier propriétaire.
- Ne pas dupliquer `.k-grid` ou `.k-card` hors `products.css`.

## Règle de statut commande

Toute modification de statut commande doit respecter `docs/ZONE_IMPACT.md` et passer par `services/order-status-machine.js`.

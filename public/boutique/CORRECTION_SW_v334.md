# Correction SW — re-déclenche le reset cache sur tous les appareils

## Pourquoi
Le fix modal était bien déployé (`components.css?v=129`, grid présent), mais les
appareils gardaient l'ancien rendu : le « Nuclear SW reset » est gated par
`localStorage['sw_reset_v333']`. Le CSS avait été bumpé (`?v=`) mais **pas** la
version SW (toujours v333) → un appareil ayant déjà la clé `sw_reset_v333` ne
re-déclenchait pas le reset et continuait de servir le cache `komerce-v333`
(ancien index.html + ancien CSS). Les numéros étaient en plus incohérents
(commentaire v302, log v326, gate réel v333).

## Ce qui change (index.html uniquement)
Tout aligné sur **v334** :
- `sw_reset_v333` → `sw_reset_v334`  (clé localStorage du gate, ×2)
- `komerce-v333`  → `komerce-v334`   (nom de cache conservé par le keeper)
- commentaire `v302` et log `v326`   → `v334` (cohérence, fini les faux numéros)

Le `?v=129` du CSS est **inchangé** (le CSS est correct, on ne re-bumpe pas).

## Effet
Au prochain chargement, chaque appareil voit une clé `sw_reset_v334` absente →
unregister de tous les SW + suppression de tous les caches + reload → CSS frais
avec la modal corrigée. Le reset ne tourne ensuite plus qu'une fois (clé posée).

## Application
Remplacer `public/boutique/index.html`, commit + push (déploiement Railway).
Test : ouvrir la prod, recharger une fois — un log `[RESET v334] ... Reloading`
doit apparaître, puis la modal s'affiche en grille.

## Doctrine (pour la prochaine fois)
À chaque livraison qui doit invalider le cache appareil : bumper la version SW en
même temps que le CSS. `node scripts/deploy-css.js --force --sw-bump` le fait des
deux côtés en une commande (le `--sw-bump` seul est sauté si aucun bundle n'a
changé — d'où le bump manuel ici, le CSS n'ayant pas bougé).

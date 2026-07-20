# Couverture boutique — dette réelle

Généré le 2026-07-20T10:32:23.517Z par `npm run test:coverage`.

Périmètre : `js/**/*.js`, hors `js/dist/**`, `*.test.js` et `__tests__/**`.

## Couverture globale corrigée

| Métrique | Couvert / total | Couverture |
|---|---:|---:|
| Statements | 8574 / 10186 | **84.17 %** |
| Branches | 4937 / 6880 | **71.76 %** |
| Functions | 1431 / 1695 | **84.42 %** |
| Lines | 7523 / 8614 | **87.33 %** |

## Fichiers sous 70 % de lignes

| Priorité | Fichier | Lines | Lignes manquantes | Zones non couvertes |
|---|---|---:|---:|---|
| P1 — couverture faible | `js/b-utils.js` | 48.24 % | 44 | 46-47, 57, 117, 125-129, 145-146, 151-154, 163-164, 166-167, 169, 181-189, 193-202, 219-220, 222, 272-273 |
| P2 — couverture moyenne | `js/b-group-view.js` | 57.55 % | 208 | 117-119, 124-125, 153, 158, 180-181, 185-186, 194-195, 235, 317-319, 323-324, 326-331, 333-335, 337-338, 340-341, … (+64 zones) |
| P2 — couverture moyenne | `js/b-pager.js` | 54.71 % | 125 | 46-48, 60-61, 67, 97-98, 138-141, 150-152, 166-167, 179, 204-205, 208, 211-212, 215-218, 233-240, 243-246, … (+26 zones) |
| P2 — couverture moyenne | `js/b-home-premium-v1.js` | 57.78 % | 19 | 46-49, 61-63, 89-90, 92, 94, 96-97, 105, 108-109, 111-113 |
| P2 — couverture moyenne | `js/b-store.js` | 55.26 % | 17 | 71, 218, 284-285, 288-289, 294-296, 299-302, 304-305, 307-308 |
| P2 — couverture moyenne | `js/b-desktop-upgrade.js` | 69.70 % | 10 | 92-94, 96-101, 108 |

## Lecture

- **P0** : fichier jamais exercé ; vérifier d’abord s’il s’agit d’un bootstrap ou d’un module réellement actif.
- **P1** : tester les contrats publics et les branches métier actives avant les détails DOM.
- **P2** : compléter les erreurs, fallbacks, idempotence et variantes desktop/mobile.
- Le code volontairement désactivé ou mort doit être supprimé/isolé, pas artificiellement exécuté pour gonfler le chiffre.


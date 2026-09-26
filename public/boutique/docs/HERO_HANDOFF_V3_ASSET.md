# Hero handoff v3 — master à intégrer

Asset : `/public/images/komerce-hero-handoff-v3.webp`

- Dimensions : **2022 × 778 px**
- Format : **WebP**
- But : remplacer le master `komerce-hero-handoff-v2.webp` lorsque le cadrage final est validé.
- Différence essentielle : les deux coiffures sont entièrement contenues dans l'image, avec une marge claire au-dessus des têtes.
- Composition conservée : deux personnages historiques, téléphone, colis Komerce, décor relais sobre.
- Le fichier est volontairement ajouté **sans modifier le CSS de production** afin de permettre un test de cadrage propre avant bascule.

## Recommandation d'intégration

Commencer par remplacer uniquement la source d'image du Hero mobile par v3, sans masque/fondu latéral ni zoom artificiel. Tester d'abord avec `background-size: contain` ou un cadrage qui respecte le ratio natif, puis ajuster uniquement la position et l'espace autour de la scène.

Objectif : préserver les têtes, le téléphone, le colis et les mains sans réintroduire de coupe.

## Intégration (mobile)

- Le fichier v3 initialement mergé (#1769) était **tronqué** (7 530 octets présents sur 64 190 déclarés, indécodable par les navigateurs). Il est remplacé par le master complet (116 480 octets, 2022 × 778).
- Dérivé mobile : `komerce-hero-handoff-v3-mobile.webp`, **1011 × 389**, ~32 Ko (couvre une scène de ~337 px CSS en 3x), utilisé par `css/hero-ultra-mobile.css`.
- Ratio natif `2022 / 778` respecté, `background-size: contain`, **aucun zoom ni fondu latéral**.
- Seule la marge haute vide du master (0–11 %, les cheveux commencent à 13,5 %) est fondue pour glisser sous le slogan sans bord dur. Mesuré 360/390/412 px : 6 à 8 px entre la 2e ligne du slogan et le haut des cheveux, barre de recherche ouverte ou fermée.
- Le test `tests/unit/hero-ultra-mobile.test.js` vérifie que chaque WebP est complet (taille réelle = taille RIFF déclarée).

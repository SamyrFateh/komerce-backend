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

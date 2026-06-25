# Hero desktop cassée — diagnostic + fix

## Constat (capture d'écran)
Sur `komerce-backend-production.up.railway.app`, le hero (≥900px) affiche une image cassée (icône broken-image), alors que le texte "La lune, vous pouvez l'attraper." s'affiche correctement.

## Cause racine (preuve outillée, pas une supposition)
Fichier en cause : `images/komerce_hero_desktop_1600x320.webp`
(référencé dans `bout/index.html` lignes 67 et 185 — preload + `<source media="(min-width:900px)">`)

```
$ webpinfo komerce_hero_desktop_1600x320.webp
RIFF HEADER: File size: 14826
Errors detected.

$ dwebp komerce_hero_desktop_1600x320.webp -o out.png
Decoding of komerce_hero_desktop_1600x320.webp failed.
Status: 7(NOT_ENOUGH_DATA)
```

Le fichier sur disque fait **14 825 octets**, mais son propre header RIFF déclare une taille totale de **14 826 octets** — il manque exactement 1 octet en fin de flux. Le fichier est **tronqué/corrompu**, ce qui explique le rendu cassé sur tous les navigateurs ≥900px. Les deux autres webp du hero (`komerce_hero_final_1080x260.webp`, `komerce_hero_mobile_1080x220.webp`) décodent sans erreur — seul le fichier desktop est touché.

Le dossier `bout.zip` (boutique) n'embarque lui-même aucun dossier `images/` : tous les chemins `/images/*` (favicons, avatars, panier, hero…) pointent vers le dossier `images/` partagé qui vit dans `dashboards.zip` (= racine `public/` servie par Express, avec `public/boutique/` = `bout.zip`). C'est cohérent avec le doc `CARTOGRAPHY_360_BOUTIQUE.md` (`public/boutique/...`). Donc le bug n'est pas un problème de chemin/montage statique, juste ce fichier précis qui est corrompu sur la racine partagée.

## Fix appliqué
Reconstruction du crop desktop à partir de la **source canonique confirmée** : `images/Komerce_Hero_Desktop.png` (1774×887).

Preuve que c'est la bonne source : template-matching (OpenCV, corrélation normalisée) entre `Komerce_Hero_Desktop.png` et le webp mobile **fonctionnel** `komerce_hero_final_1080x260.webp` → score **0.996**, crop = largeur pleine (1774px), hauteur 427px, **centré verticalement** (y=230→657, soit exactement le centre vertical de l'image source à 887px). `Komerce_Kero_Desktop_2.png` (l'autre image dispo) n'a pas été utilisée : ce n'est pas la source des assets déjà en prod.

→ Même logique appliquée pour le format desktop manquant (ratio 5.0 au lieu de 4.15) :
- Largeur pleine 1774px, hauteur 355px, crop centré verticalement (y=266→621)
- Resize → 1600×320 (dimensions exactes attendues par le code)
- Encodage `cwebp -q 82` → 38 138 octets, **décodage vérifié sans erreur** (`webpinfo` : *No error detected*)

## Contenu de cette livraison
- `images/komerce_hero_desktop_1600x320.webp` → fichier corrigé, à déposer à la place de l'actuel sur le serveur (même chemin, même nom)
- `komerce_hero_desktop_1600x320_CORROMPU_ORIGINAL.webp` → l'original cassé, conservé comme pièce à conviction / pour audit avant écrasement

## Dette non liée à cet incident (déjà absente avant, pas une régression du fix)
Toujours absents de `images/` (référencés dans le code mais jamais fournis dans les deux zips) :
- `images/placeholder-product.png`
- `images/og-cover.jpg`
- `images/hero_banner.png` (référencé seulement dans `shop-schema.js`, JSON-LD — pas le hero visuel réel)

Pas traité ici, signalé pour visibilité.

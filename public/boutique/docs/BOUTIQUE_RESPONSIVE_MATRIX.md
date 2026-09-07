# Boutique — matrice responsive canonique

**Statut :** contrat de production  
**Owner :** feature `catalog`  
**Breakpoint fonctionnel :** mobile `< 900 CSS px`, desktop `>= 900 CSS px`

## Principe

Komerce répond à la **taille CSS réellement disponible**, jamais au nombre de pouces physiques de l'écran. Le zoom navigateur et la mise à l'échelle Windows/macOS sont donc naturellement couverts par la même matrice.

Le breakpoint fonctionnel mobile/desktop reste unique à `900px`. Au-dessus, la composition desktop change seulement de **densité** : aucun second parcours, aucune logique métier parallèle.

Le repo conserve ses deux seuils canoniques de largeur (`900` et `1200`). Au-delà de `1200`, le nombre de colonnes n'est plus lié à une série de breakpoints artificiels : CSS Grid l'adapte à la **largeur réellement restante**, notamment quand le side-cart est ouvert.

## Matrice de largeur

| Largeur CSS | Profil | Grille catalogue | Side-cart |
|---:|---|---|---:|
| `< 900` | Mobile / tablette portrait | contrat mobile existant | contrat mobile |
| `900–1199` | Desktop compact / tablette paysage / laptop zoomé | 3 colonnes | `208–224px` adaptatifs |
| `>= 1200` | Laptop / desktop / grand desktop | `auto-fit`, cartes `>=260px` : 3/4/5+ colonnes selon largeur utile | `260→296px` fluide puis plafonné |

Ainsi un grand écran sans panier peut exploiter davantage de colonnes, tandis que le même écran avec un panier ouvert réduit naturellement le nombre de colonnes avant de réduire la largeur des cartes.

## Matrice de hauteur

La largeur ne suffit pas : un `1366×768` peut être plus contraint verticalement qu'un `1024×1180`.

- Desktop `<= 800px` de haut : l'étagère catégories et la navigation contextuelle sont compactées.
- Desktop compact `<= 720px` de haut : compression renforcée des objets de catégorie.
- Le hero conserve son owner et sa géométrie canonique ; la matrice responsive n'ajoute aucun `!important` pour le forcer.
- Aucun contenu métier n'est supprimé ; seule la densité change.

## Viewports de référence

Les contrôles Playwright couvrent notamment :

- `900×600`, `900×800`
- `1024×600`, `1024×768`
- `1180×820`
- `1280×720`, `1280×800`
- `1366×768`
- `1440×900`, `1536×864`
- `1600×900`, `1920×1080`, `2560×1440`

Cette série couvre aussi indirectement les cas fréquents de zoom OS : par exemple un écran physique `1366px` à 125 % se comporte comme un viewport CSS beaucoup plus étroit et tombe automatiquement dans le profil desktop compact.

## Invariants

1. Aucun scroll horizontal du document.
2. En desktop compact, aucune carte catalogue utile sous `180px` ; à partir de `1200px`, les tracks fluides visent `260px` minimum.
3. Le catalogue et le header ne passent jamais sous le side-cart réservé.
4. La largeur réservée au side-cart est exactement sa largeur rendue.
5. L'étagère des huit catégories ne déborde pas horizontalement sur desktop.
6. Les écrans bas compactent la navigation sans changer le parcours utilisateur ni forcer le hero hors de son owner.
7. Les seuls seuils de largeur du responsive Boutique restent les seuils canoniques `900/1200`; le grand desktop s'adapte sans multiplication des breakpoints.
8. Mobile, modal, checkout et Discovery conservent leurs contrats propres ; la matrice ne les remplace pas.
9. La matrice responsive reste à dette `!important` nulle.

## Owners

- Owners sémantiques : `layout.css`, `products.css`, `boutique-desktop.css`, `category-cutout-navigation-desktop.css`, `hero.css`.
- Adaptation responsive tardive : `responsive-desktop-matrix.css`.
- Les sélecteurs critiques touchés par cette adaptation sont déclarés explicitement dans `scripts/critical-selector-ownership.js`.
- Le fichier est chargé **en dernier** dans `desktop.css` pour adapter la densité sans dupliquer le moteur métier.

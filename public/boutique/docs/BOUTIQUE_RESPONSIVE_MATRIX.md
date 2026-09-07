# Boutique — matrice responsive canonique

**Statut :** contrat de production  
**Owner :** feature `catalog`  
**Breakpoint fonctionnel :** mobile `< 900 CSS px`, desktop `>= 900 CSS px`

## Principe

Komerce répond à la **taille CSS réellement disponible**, jamais au nombre de pouces physiques de l'écran. Le zoom navigateur et la mise à l'échelle Windows/macOS sont donc naturellement couverts par la même matrice.

Le breakpoint fonctionnel mobile/desktop reste unique à `900px`. Au-dessus, la composition desktop change seulement de **densité** : aucun second parcours, aucune logique métier parallèle.

## Matrice de largeur

| Largeur CSS | Profil | Grille catalogue | Side-cart |
|---:|---|---:|---:|
| `< 900` | Mobile / tablette portrait | contrat mobile existant | contrat mobile |
| `900–1199` | Desktop compact / tablette paysage / laptop zoomé | 3 colonnes | `208–224px` adaptatifs |
| `1200–1439` | Laptop standard | 4 colonnes | `260–276px` adaptatifs |
| `1440–1599` | Desktop | 4 colonnes | coque canonique `296px` |
| `>= 1600` | Grand desktop | 5 colonnes | coque canonique `296px` |

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
2. Aucune carte catalogue desktop utile sous `180px` de large dans la matrice de référence.
3. Le catalogue et le header ne passent jamais sous le side-cart réservé.
4. La largeur réservée au side-cart est exactement sa largeur rendue.
5. L'étagère des huit catégories ne déborde pas horizontalement sur desktop.
6. Les écrans bas compactent la navigation sans changer le parcours utilisateur ni forcer le hero hors de son owner.
7. Le breakpoint fonctionnel `900px` reste unique : les profils desktop sont des adaptations CSS, pas de nouveaux moteurs JS.
8. Mobile, modal, checkout et Discovery conservent leurs contrats propres ; la matrice ne les remplace pas.
9. La matrice responsive reste à dette `!important` nulle.

## Owners

- Owners sémantiques : `layout.css`, `products.css`, `boutique-desktop.css`, `category-cutout-navigation-desktop.css`, `hero.css`.
- Adaptation responsive tardive : `responsive-desktop-matrix.css`.
- Les sélecteurs critiques touchés par cette adaptation sont déclarés explicitement dans `scripts/critical-selector-ownership.js`.
- Le fichier est chargé **en dernier** dans `desktop.css` pour adapter la densité sans dupliquer le moteur métier.

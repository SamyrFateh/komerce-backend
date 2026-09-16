# Komerce Canonical — Style Contract V1

> Statut : **contrat visuel bloquant**
> Références : mocks validés `Catalogue Control Tower` et `Atelier économique`.
> Objectif : transformer la direction visuelle des mocks en règles mesurables, réutilisables et testables.

## 1. Principe

Les mocks ne sont pas une inspiration. Ils définissent le **langage visuel Canonical**.

Une surface Canonical ne peut pas choisir librement :

- sa palette ;
- son chrome ;
- ses rayons ;
- sa densité ;
- sa navigation ;
- ses espacements ;
- ses états actifs ;
- son style de carte/tableau/action.

Les différences entre dashboards viennent du contenu métier, pas du système visuel.

## 2. Tokens d'autorité

### Couleurs

- application background : `#f8fbff`
- card : `#ffffff`
- navy / ink : `#102143`
- text : `#26385a`
- muted : `#7685a2`
- line : `#dfe7f2`
- line strong : `#cfd9e8`
- primary indigo : `#4f67ff`
- primary soft : `#eef2ff`
- positive : `#18b86a`
- warning : `#fb7a24`
- pink accent : `#df3f86`
- violet accent : `#7b61ff`
- yellow accent : `#f0b427`
- critical : `#d94b53`

Une couleur sémantique ne peut jamais être réaffectée à un autre sens métier localement.

### Géométrie

- sidebar desktop : `176px`
- topbar cible : `52px`
- rayon principal : `8px`
- rayon contrôles : `7px`
- ombre carte : `0 1px 2px rgb(16 33 67 / 0.025)`
- ombre hover maximale : `0 4px 14px rgb(16 33 67 / 0.07)`
- bordure standard : `1px solid #dfe7f2`

### Densité

- contenu compact, sans grands hero décoratifs ;
- sections : `12–14px` de padding nominal ;
- gap standard : `8–10px` ;
- cartes KPI : hauteur nominale proche de `86px` ;
- lignes de tableau : `9–10px` vertical ;
- titres de page : `25–34px`, très peu de marge autour ;
- sous-titres : `12px` environ.

## 3. Shell Canonical

### Sidebar

- navy `#102143` ;
- logo/wordmark blanc ;
- liens N1 compacts ;
- actif : fond indigo/bleu très léger + texte blanc + marqueur visuel fin ;
- utilitaires bas séparés visuellement du métier ;
- aucune sidebar locale par dashboard.

### Topbar

- fond blanc ;
- bordure basse ou carte très légère ;
- recherche globale dominante mais visuellement discrète ;
- Market ID, notifications et compte à droite ;
- aucune rubrique métier N1 dans la topbar.

### N2

- onglets horizontaux sur fond blanc/translucide ;
- actif : texte indigo + underline 2px ;
- inactif : muted ;
- hover discret ;
- pas de pills massifs.

## 4. Hiérarchie de page

Chaque dashboard suit :

1. shell global ;
2. topbar ;
3. titre + sous-titre ;
4. N2 si le domaine en possède ;
5. métriques / résumé ;
6. zones opérationnelles ;
7. tables / événements / détails.

Le titre n'est pas enfermé dans une grosse carte.

## 5. Cartes

- fond blanc ;
- bordure fine ;
- rayon 8px ;
- ombre quasi invisible ;
- accent sémantique local autorisé seulement si porteur de sens ;
- pas de gradients lourds ;
- pas d'ombres profondes ;
- pas de radius > 12px hors avatar/pill.

## 6. Tableaux

- headers `#f8fbff` ;
- texte compact ;
- séparation fine ;
- hover léger ;
- pas de zebra agressif ;
- actions de ligne discrètes ;
- état vide dans la même grammaire visuelle.

## 7. Contrôles et actions

- primaire : indigo `#4f67ff`, texte blanc ;
- secondaire : blanc + bordure indigo-soft ;
- danger : rouge uniquement pour action destructive ;
- hauteur compacte ;
- rayon 7px ;
- aucun bouton géant si une action compacte suffit.

## 8. Style sémantique

- vert = positif / validé / disponible ;
- orange = attention / en cours / risque ;
- rouge = critique / erreur / blocage ;
- violet = calcul / transformation / raffinerie selon contexte ;
- rose = signal secondaire / curation si utilisé ;
- jaune = attente / décision non bloquante.

Les statuts doivent rester compréhensibles sans dépendre uniquement de la couleur.

## 9. Conformité aux mocks

Le rendu final doit conserver les caractéristiques communes validées :

- beaucoup d'air blanc, mais densité opérationnelle élevée ;
- couleurs franches uniquement pour signaler ;
- navigation sobre ;
- tableaux et cartes alignés sur une grille ;
- aucune décoration gratuite ;
- hiérarchie nette : titre → métriques → flux → détail ;
- impression de cockpit vivant, pas de formulaire administratif historique.

## 10. Interdits

Sont non conformes :

- nouveau thème local ;
- sidebar locale dans une surface ;
- top navigation N1 parallèle ;
- couleurs hardcodées divergentes pour les primitives partagées ;
- cartes surdimensionnées sans nécessité métier ;
- gros hero marketing ;
- shadows/gradients décoratifs ;
- radius incohérents ;
- tableau legacy dense et gris sans reprise Theme V2 ;
- navigation grisée pour un droit absent.

## 11. Tests de contrat

Les tests doivent figer au minimum :

- présence des tokens ci-dessus ;
- sidebar N1 `176px` ;
- topbar `52px` ;
- N2 horizontal ;
- absence de top-nav N1 comme autorité ;
- absence de sidebar locale Catalogue visible ;
- chargement du même shell CSS/JS sur toutes les entrées Canonical ;
- respect de la palette et des rayons partagés.
